import type { z } from "zod";
import type { voiceContracts } from "@/lib/types/api";
import { trainStyleCardFromChannel } from "@/server/voice/train";
import type { HandlerOpts } from "./_shared";

type TrainInput = z.output<typeof voiceContracts.trainFromChannel.input>;

/**
 * voice router (Wave D) — train_on_my_channel derivation entrypoint
 * (WAVE-D-PLAN §2c). D2: delegates to the real consent-gated derivation
 * (`trainStyleCardFromChannel`): transcripts (Supadata) → LLM StyleCard →
 * a persisted source="trained" voice profile, charged trainVoice credits.
 * Tenancy is enforced by workspaceProcedure upstream AND re-checked
 * workspace-scoped inside the derivation (a foreign channel is NOT_FOUND).
 */
export const voiceImpl = {
  trainFromChannel({ ctx, input }: HandlerOpts<TrainInput>) {
    return trainStyleCardFromChannel(
      { workspaceId: ctx.workspaceId, actorUserId: ctx.userId },
      {
        channelId: input.channelId,
        sampleVideoIds: input.sampleVideoIds,
        remixFrom: input.remixFrom,
        name: input.name,
      },
    );
  },
};
