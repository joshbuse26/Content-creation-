import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { getConfig } from "@/lib/config";
import { getProviders } from "@/lib/providers";
import type { LlmProvider, TranscriptProvider, YoutubeProvider } from "@/lib/providers/types";
import { claimsSoundsLikeNamedCreator } from "@/lib/named-creator-claim";
import { containsRealCreatorName } from "@/lib/seed-lint";
import { demoOwnTranscripts } from "@/lib/fixtures/demo";
import type { TrainStyleCardInput, TrainStyleCardResult } from "@/lib/types/entities";
import type { ChannelId, UserId, WorkspaceId } from "@/lib/types/ids";
import { channelIdSchema } from "@/lib/types/ids";
import type { BillingStore } from "@/server/billing";
import { requireCreditsWithOverage } from "@/server/billing";
import { CREDIT_COSTS } from "@/server/credits";
import type { ChannelRepo } from "@/server/channel/repo";
import type { EngineMode } from "@/pipelines/script/llm-json";
import { settleCharge } from "@/pipelines/script/settle-charge";
import type { EngineStore } from "@/pipelines/script/store";
import { getStageDeps } from "@/pipelines/stages/deps";
import { deriveStyleCard, sanitizeDerivedCard } from "./derive";

/**
 * train_on_my_channel derivation (WAVE-D-PLAN §2c) — the real implementation
 * of the D0-frozen contract. Signature (ctx, input) is unchanged; an optional
 * third `deps` argument makes it fully injectable for tests (defaults resolve
 * the live/fixture providers + stores).
 *
 * Flow:
 *  1. Resolve the OWN channel workspace-scoped (cross-workspace → NOT_FOUND).
 *  2. Sample transcripts via the TranscriptProvider ONLY (Supadata; NEVER
 *     page/caption scraping): the given sampleVideoIds, else the channel's
 *     recent uploads (own) or the competitor channels' recent uploads (remix),
 *     capped at TRANSCRIPT_CAP.
 *  3. Derive a structured StyleCard via the LlmProvider seam (fixture-twin is
 *     deterministic + keyless).
 *  4. ORIGINALITY GUARD (trust rule, D2 P0-1): a source channel is
 *     PROVEN-OWNED only when its mode === "oauth" (the user authenticated it).
 *     ANY other training — a competitor remix, OR training on a merely-public
 *     (unverified) channel a user could connect without proving ownership — is
 *     treated as remix-equivalent and GUARDED: sanitizeDerivedCard scans every
 *     free-text field so none reproduces competitor wording (similarity guard)
 *     or carries a real-person name (seed-lint), and the card is named
 *     generically (never the source channel's real title). Verbatim own
 *     snippets and the real channel title are allowed ONLY for a proven-owned
 *     (oauth) own channel.
 *  5. Charge trainVoice credits — requireCreditsWithOverage at dispatch +
 *     idempotent completion charge keyed `trainVoice:<channel+sample hash>`
 *     (a re-train of the same sample is free and overwrites the same row).
 *  6. Persist a source="trained" voice_profiles row (workspace-scoped,
 *     trained_from_channel_id + trained_at recorded; consent = this call).
 */

const TRANSCRIPT_CAP = 8;

export interface TrainVoiceDeps {
  mode: EngineMode;
  llm: LlmProvider;
  youtube: YoutubeProvider;
  transcript: TranscriptProvider;
  store: EngineStore;
  channels: ChannelRepo;
  /** Billing store for the dispatch credit gate; defaults to the shared store. */
  billingStore?: BillingStore;
}

export interface TrainCtx {
  workspaceId: WorkspaceId;
  /** Ledger actor for the training charge; null for a system/unauthenticated caller. */
  actorUserId?: UserId | null;
}

async function resolveDeps(deps?: TrainVoiceDeps): Promise<TrainVoiceDeps> {
  if (deps !== undefined) return deps;
  const [stage, providers] = await Promise.all([getStageDeps(), getProviders()]);
  return {
    mode: stage.engine.mode,
    llm: stage.engine.llm,
    youtube: providers.youtube,
    transcript: stage.engine.transcript,
    store: stage.engine.store,
    channels: stage.channels,
  };
}

/** A stable, valid UUID marking a remix's competitor provenance (no owned row). */
function remixProvenanceId(remixFrom: readonly string[]): ChannelId {
  const digest = createHash("sha1")
    .update(
      `remix:${[...remixFrom]
        .map((s) => s.trim().toLowerCase())
        .sort()
        .join("|")}`,
    )
    .digest("hex");
  // Format the SHA-1 hex as a v5-shaped UUID (version/variant bits set).
  const uuid = [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `5${digest.slice(13, 16)}`,
    ((parseInt(digest.slice(16, 17), 16) & 0x3) | 0x8).toString(16) + digest.slice(17, 20),
    digest.slice(20, 32),
  ].join("-");
  return channelIdSchema.parse(uuid);
}

async function sampleTranscripts(
  deps: TrainVoiceDeps,
  sourceIdsOrHandles: readonly string[],
  explicitVideoIds: readonly string[] | null,
): Promise<{ videoIds: string[]; texts: string[] }> {
  let videoIds: string[];
  if (explicitVideoIds !== null && explicitVideoIds.length > 0) {
    videoIds = explicitVideoIds.slice(0, TRANSCRIPT_CAP);
  } else {
    const collected: string[] = [];
    const perSource = Math.max(1, Math.ceil(TRANSCRIPT_CAP / sourceIdsOrHandles.length));
    for (const source of sourceIdsOrHandles) {
      if (collected.length >= TRANSCRIPT_CAP) break;
      const channel = await deps.youtube.getChannel(source);
      const ids = await deps.youtube.listRecentVideoIds(channel.uploadsPlaylistId, perSource);
      collected.push(...ids);
    }
    videoIds = collected.slice(0, TRANSCRIPT_CAP);
  }
  const texts: string[] = [];
  for (const id of videoIds) {
    const transcript = await deps.transcript.getTranscript(id);
    if (transcript.fullText.trim().length > 0) texts.push(transcript.fullText);
  }
  return { videoIds, texts };
}

export async function trainStyleCardFromChannel(
  ctx: TrainCtx,
  input: TrainStyleCardInput,
  injectedDeps?: TrainVoiceDeps,
): Promise<TrainStyleCardResult> {
  const deps = await resolveDeps(injectedDeps);
  const workspaceId = ctx.workspaceId;

  // 1. Own channel, workspace-scoped — a foreign channel is NOT_FOUND.
  const channel = await deps.channels.get(workspaceId, input.channelId);
  if (channel === null) {
    throw new TRPCError({ code: "NOT_FOUND", message: "channel not found" });
  }

  const remix = input.remixFrom !== null && input.remixFrom.length > 0;
  const remixFrom = remix ? (input.remixFrom as string[]) : [];

  // Trust rule (D2 P0-1): a channel is PROVEN-OWNED only when the user
  // authenticated it (mode === "oauth"). A remix, OR training on any
  // unverified/public channel, is GUARDED — treated as remix-equivalent:
  // full originality guard, original card, generic name.
  //
  // A "demo" channel is proven-owned-equivalent: its data is entirely
  // synthetic (channel.connectDemo seeds it — no real person's channel), so
  // there is nothing to guard against reproducing. Allowing the own-path lets
  // the derived card carry the demo title + verbatim demo snippets, giving the
  // playtester the full, un-neutered trained-voice result. Safe by
  // construction and scoped to demo channels only.
  const isDemo = channel.mode === "demo";
  const provenOwned = channel.mode === "oauth" || isDemo;
  const guarded = remix || !provenOwned;

  // 2. Sample transcripts. A demo channel's own uploads are synthetic ids the
  //    real transcript provider cannot serve, so its own-channel training uses
  //    SEEDED transcripts directly — additive, demo-only, so it works with zero
  //    keys in BOTH fixture and live mode and never touches the real-channel
  //    path. Otherwise: TranscriptProvider only (competitors for a remix, else
  //    the own/connected channel).
  const { videoIds, texts } =
    isDemo && !remix
      ? demoOwnTranscripts(input.sampleVideoIds)
      : remix
        ? await sampleTranscripts(deps, remixFrom, null)
        : await sampleTranscripts(deps, [channel.youtubeChannelId], input.sampleVideoIds);

  if (texts.length === 0) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: remix
        ? "No transcripts were available for the competitor channel(s) to remix from."
        : "No transcripts were available for this channel yet — sync it or pick specific videos, then try again.",
    });
  }

  // Sampled-video hash — the shared idempotency base for BOTH the dispatch
  // overage gate and the completion charge, so a re-train of the identical
  // sample never re-meters overage (D2 P2-5) and never double-charges.
  const sampleHash = createHash("sha1")
    .update(`${input.channelId}|${remix ? "remix" : "own"}|${[...videoIds].sort().join(",")}`)
    .digest("hex")
    .slice(0, 32);
  const chargeKey = `trainVoice:${sampleHash}`;

  // 5a. Dispatch credit gate BEFORE the LLM derivation (never work you can't
  //     pay for). Keyed on the sample hash so a zero-balance paid user's
  //     re-train of the same sample dedupes against the completion charge's
  //     overage grant instead of metering a second time (D2 P2-5).
  await requireCreditsWithOverage(workspaceId, CREDIT_COSTS.trainVoice, {
    store: deps.billingStore,
    actorUserId: ctx.actorUserId ?? null,
    idempotencyKey: chargeKey,
  });

  // 3. Derive the structured StyleCard (LLM seam / deterministic fixture twin).
  //    A guarded card is derived as ORIGINAL (structural patterns, original
  //    snippets) and never leaks the real source title into the derivation.
  let styleCard = await deriveStyleCard({
    mode: deps.mode,
    llm: deps.llm,
    channelTitle: guarded ? "the source channel" : channel.title,
    transcripts: texts,
    remix: guarded,
  });

  // 4. Originality guard: scan EVERY free-text field so none reproduces the
  //    source's wording (similarity guard) or carries a real-person name
  //    (seed-lint). Own verbatim snippets survive only on the proven-owned path.
  if (guarded) {
    styleCard = sanitizeDerivedCard(
      styleCard,
      texts,
      getConfig().LICENSED_SIMILARITY_MAX_OVERLAP,
    ).card;
  }

  // Name: proven-owned own channels may carry the real channel title. A
  // guarded card gets a generic default and is rejected back to it if the
  // (user-supplied or derived) name names a real creator or claims to sound
  // like one (seed-lint + the shared named-creator-claim patterns).
  const fallbackName = guarded ? "Remixed voice" : `${channel.title} voice`;
  let name = (input.name ?? fallbackName).trim();
  if (name.length === 0) name = fallbackName;
  if (guarded && (containsRealCreatorName(name) || claimsSoundsLikeNamedCreator(name))) {
    name = "Remixed voice";
  }

  const trainedFromChannelId = remix ? remixProvenanceId(remixFrom) : input.channelId;
  const trainedAt = new Date();

  // 6. Persist (idempotent upsert on workspace+channel+provenance).
  const voiceProfile = await deps.store.upsertTrainedVoiceProfile({
    workspaceId,
    channelId: input.channelId,
    name,
    styleCard,
    trainedFromChannelId,
    trainedAt,
  });

  // 5b. Completion charge — idempotent on the channel + sampled-video hash so a
  //     re-train of the same sample is free (and overwrote the same row).
  await settleCharge(deps.store, {
    workspaceId,
    delta: -CREDIT_COSTS.trainVoice,
    reason: "train_voice",
    actorUserId: ctx.actorUserId ?? null,
    projectId: null,
    idempotencyKey: chargeKey,
  });

  return { voiceProfile, remix, sampledVideoIds: videoIds };
}
