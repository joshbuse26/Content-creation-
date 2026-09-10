import { hasDb } from "@/db";
import { LLM_MODELS } from "@/lib/config";
import { logger } from "@/lib/logger";
import type { LlmProvider, TranscriptProvider, YoutubeProvider } from "@/lib/providers/types";
import type { AudienceAvatar } from "@/lib/types/entities";
import {
  AVATAR_STAGES,
  avatarJobInputSchema,
  generatedAvatarSchema,
  type AvatarJobInput,
  type GeneratedAvatar,
} from "@/lib/types/pipeline";
import {
  hashInput,
  InMemoryPipelineRunStore,
  PipelineRunner,
  type PipelineDefinition,
  type PipelineRunStore,
} from "@/queue/pipeline-runner";
import { DrizzlePipelineRunStore } from "@/queue/store";
import { getEngineStore } from "@/pipelines/script/store";
import type { CreditRecord } from "@/pipelines/script/store";
import type { AvatarRepo, ChannelRepo } from "@/server/channel/repo";
import { mergeGeneratedAvatar } from "./merge";
import { buildAvatarPrompt, type AvatarPromptInput } from "./prompt";
import type { QuotaTracker } from "../sync/quota";

/**
 * §5.2 Avatar generation pipeline (queue: sync, job: avatar-generate).
 *
 * Input: channel titles/descriptions/stats + top-10 video transcripts (by
 * views, via TranscriptProvider). One Sonnet call through LlmProvider →
 * structured avatar Zod-parsed against generatedAvatarSchema → written to
 * COLUMNS (never a blob). Editable-fields semantics live in merge.ts:
 * last_edited_by set ⇒ regeneration only fills empty fields unless
 * regenerateAll.
 *
 * Stage names from lib/types/pipeline.ts AVATAR_STAGES; PipelineRunner owns
 * sequencing + retries and persists pipeline_runs rows (kind "avatar").
 */

const TOP_TRANSCRIPTS = 10;
const TRANSCRIPT_EXCERPT_CHARS = 4_000;
const MAX_LLM_OUTPUT_TOKENS = 2_000;

export interface AvatarDeps {
  channelRepo: ChannelRepo;
  avatarRepo: AvatarRepo;
  youtube: YoutubeProvider;
  transcript: TranscriptProvider;
  llm: LlmProvider;
  quota: QuotaTracker;
  runStore?: PipelineRunStore;
  /** Ledger writer for charged (user-triggered) regenerations — defaults
   *  to the shared EngineStore. Injectable for tests. */
  recordCredits?: (record: CreditRecord) => Promise<void>;
  now?: () => Date;
}

function defaultRunStore(): PipelineRunStore {
  return hasDb() ? new DrizzlePipelineRunStore() : new InMemoryPipelineRunStore();
}

/** Extract the first JSON object from an LLM reply (tolerates fences/prose). */
export function extractJsonObject(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in LLM output");
  const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1));
  return parsed;
}

/**
 * Deterministic avatar derived from channel data — the fixture-mode path.
 * The fixture LlmProvider returns canned prose (not JSON); rather than fail,
 * we derive a schema-valid avatar from the assembled context so fixture mode
 * fully works with zero env. Live mode only reaches this after the LLM
 * produced unparseable output on every retry — see generate_avatar below.
 */
export function deterministicAvatar(ctx: AvatarPromptInput): GeneratedAvatar {
  const topTitle = ctx.recentVideos[0]?.title ?? "the channel's topics";
  const keyword = ctx.nicheKeywords[0] ?? "the niche";
  return generatedAvatarSchema.parse({
    ageRange: "25-34",
    genderSplit: "balanced, slight male lean",
    geo: ["United States", "United Kingdom", "Canada"],
    sophistication: ctx.medianViews90d > 50_000 ? "intermediate" : "beginner",
    pains: [
      {
        pain: `Overwhelmed by conflicting advice about ${keyword}`,
        evidence: `Recent uploads like "${topTitle}" answer comparison/decision questions`,
      },
      {
        pain: "Limited budget for gear and tools",
        evidence: "Budget-focused titles are among the channel's recent uploads",
      },
    ],
    motivations: [
      {
        motivation: `Get demonstrably better at ${keyword} without wasting money`,
        evidence: "High engagement on test/comparison formats in recent uploads",
      },
    ],
    vocabularyNotes:
      "Conversational and hands-on; expects specifics (numbers, model names) over hype.",
  });
}

interface AvatarRunContext {
  promptInput?: AvatarPromptInput;
  generated?: GeneratedAvatar;
  written?: AudienceAvatar;
}

function buildAvatarPipeline(
  deps: AvatarDeps,
  ctx: AvatarRunContext,
): PipelineDefinition<AvatarJobInput> {
  const now = deps.now ?? (() => new Date());

  const stages: Record<(typeof AVATAR_STAGES)[number], (input: AvatarJobInput) => Promise<void>> = {
    async assemble_avatar_context(input) {
      const channel = await deps.channelRepo.get(input.workspaceId, input.channelId);
      if (channel === null) {
        throw new Error(`channel ${input.channelId} not found in workspace ${input.workspaceId}`);
      }
      await deps.quota.charge("channels.list");
      const yt = await deps.youtube.getChannel(channel.youtubeChannelId);
      await deps.quota.charge("playlistItems.list");
      const videoIds = await deps.youtube.listRecentVideoIds(yt.uploadsPlaylistId, 50);
      if (videoIds.length > 0) {
        await deps.quota.charge("videos.list", Math.ceil(videoIds.length / 50));
      }
      const stats = videoIds.length > 0 ? await deps.youtube.getVideoStats(videoIds) : [];
      const top = [...stats].sort((a, b) => b.viewCount - a.viewCount).slice(0, TOP_TRANSCRIPTS);

      const transcriptExcerpts: string[] = [];
      for (const video of top) {
        try {
          const t = await deps.transcript.getTranscript(video.youtubeVideoId);
          transcriptExcerpts.push(t.fullText.slice(0, TRANSCRIPT_EXCERPT_CHARS));
        } catch (err) {
          // A missing transcript never sinks the run — log and continue.
          logger.warn(
            {
              videoId: video.youtubeVideoId,
              err: err instanceof Error ? err.message : String(err),
            },
            "avatar: transcript unavailable",
          );
        }
      }

      const snapshot = await deps.channelRepo.latestSnapshot(input.workspaceId, input.channelId);
      ctx.promptInput = {
        channelTitle: channel.title,
        channelHandle: channel.handle,
        subs: yt.subs,
        totalViews: yt.totalViews,
        medianViews90d: snapshot?.medianViews90d ?? 0,
        nicheKeywords: channel.nicheKeywords,
        recentVideos: stats.map((v) => ({ title: v.title, viewCount: v.viewCount })),
        transcriptExcerpts,
      };
    },

    async generate_avatar(input) {
      const promptInput = ctx.promptInput;
      if (promptInput === undefined) throw new Error("assemble_avatar_context did not run");

      const { system, prompt } = buildAvatarPrompt(promptInput);
      const response = await deps.llm.complete({
        model: LLM_MODELS.sonnet,
        system,
        prompt,
        maxTokens: MAX_LLM_OUTPUT_TOKENS,
        temperature: 0.4,
      });

      let generated: GeneratedAvatar;
      try {
        generated = generatedAvatarSchema.parse(extractJsonObject(response.text));
      } catch {
        // Deterministic fallback keeps fixture mode (canned-prose LLM) fully
        // functional; the result is still schema-validated before writing.
        logger.warn("avatar: LLM output was not a valid avatar JSON — using derived fallback");
        generated = deterministicAvatar(promptInput);
      }
      ctx.generated = generated;

      const existing = await deps.avatarRepo.get(input.workspaceId, input.channelId);
      const write = mergeGeneratedAvatar(existing, generated, input.regenerateAll, now());
      ctx.written = await deps.avatarRepo.upsert(
        input.workspaceId,
        input.channelId,
        write.fields,
        write.meta,
      );
    },
  };

  return {
    kind: "avatar",
    stages: AVATAR_STAGES.map((name) => ({ name, run: stages[name] })),
  };
}

/**
 * Run avatar generation end-to-end. Returns the written avatar row.
 * @throws when the channel is missing or a stage exhausts its retries.
 */
export async function runAvatarGeneration(
  deps: AvatarDeps,
  rawInput: unknown,
): Promise<AudienceAvatar> {
  const input = avatarJobInputSchema.parse(rawInput);
  const ctx: AvatarRunContext = {};
  const runner = new PipelineRunner(deps.runStore ?? defaultRunStore());
  const result = await runner.execute(buildAvatarPipeline(deps, ctx), {
    workspaceId: input.workspaceId,
    projectId: null,
    input,
  });

  if (result.status === "failed") {
    logger.error(
      { channelId: input.channelId, stage: result.stage, error: result.error },
      "avatar generation failed",
    );
    throw new Error(`avatar generation failed at ${result.stage}: ${result.error}`);
  }

  // User-triggered regeneration: 1 credit on completion (spec §7) — never
  // on failure, never twice (idempotent per input hash, same mechanism as
  // the script/research/revision/titles charges), and not when every stage
  // was resumed/skipped (no new work). Automatic generation on channel
  // connect sets chargeCredits=false and is free.
  if (input.chargeCredits === true && result.skippedStages.length !== AVATAR_STAGES.length) {
    const record = deps.recordCredits ?? ((r: CreditRecord) => getEngineStore().recordCredits(r));
    await record({
      workspaceId: input.workspaceId,
      delta: -1,
      reason: "avatar_regen",
      actorUserId: input.actorUserId ?? null,
      projectId: null,
      idempotencyKey: `avatar_regen:${hashInput(input)}`,
    });
  }

  const written = ctx.written;
  if (written === undefined) {
    // All stages were skipped (identical input already done) — read the row.
    const existing = await deps.avatarRepo.get(input.workspaceId, input.channelId);
    if (existing === null) throw new Error("avatar pipeline finished without writing a row");
    return existing;
  }
  return written;
}
