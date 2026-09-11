import { fixtureTrainedVoiceProfile } from "@/lib/fixtures";
import { voiceProfileSchema } from "@/lib/types/entities";
import type { TrainStyleCardInput, TrainStyleCardResult } from "@/lib/types/entities";
import type { ChannelId, WorkspaceId } from "@/lib/types/ids";
import { channelIdSchema, workspaceIdSchema } from "@/lib/types/ids";

/**
 * train_on_my_channel derivation (WAVE-D-PLAN §2c) — the frozen signature +
 * IO contract, with a D0 STUB body. The real derivation ships in D2:
 *
 *   TODO(D2): pull transcripts via TranscriptProvider (Supadata; NEVER
 *   caption scraping) for the channel's uploads (or `remixFrom` competitor
 *   channels) → LLM derives a structured StyleCard (same frozen shape) →
 *   persist a source="trained" voice_profiles row (trained_from_channel_id +
 *   trained_at recorded; consent-gated, explicit user action). A `remixFrom`
 *   derivation must run through the same seed-lint / no-named-creator guard
 *   as archetypes so the output card carries no real person's name — this is
 *   distinct from the licensed-voice path (signed license + similarity guard).
 *
 * D0 returns a plausible, deterministic trained card so a chat screen and the
 * voice picker can be built against the stub keylessly. It does NOT touch
 * providers, the LLM, or persistence.
 */

export interface TrainStyleCardCtx {
  workspaceId: WorkspaceId;
  channelId: ChannelId;
}

export async function trainStyleCardFromChannel(
  ctx: { workspaceId: WorkspaceId },
  input: TrainStyleCardInput,
): Promise<TrainStyleCardResult> {
  // D0 stub: return the fixture trained profile bound to the caller's
  // workspace + requested channel. Async to match the D2 signature (which
  // awaits transcripts + the LLM); no work is done here.
  const voiceProfile = voiceProfileSchema.parse({
    ...fixtureTrainedVoiceProfile,
    workspaceId: workspaceIdSchema.parse(ctx.workspaceId),
    channelId: channelIdSchema.parse(input.channelId),
    trainedFromChannelId: channelIdSchema.parse(input.channelId),
    name: input.name ?? fixtureTrainedVoiceProfile.name,
  });
  return Promise.resolve({
    voiceProfile,
    remix: input.remixFrom !== null && input.remixFrom.length > 0,
    sampledVideoIds: input.sampleVideoIds ?? ["dQfixture001", "dQfixture002", "dQfixture003"],
  });
}
