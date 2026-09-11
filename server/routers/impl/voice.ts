import type { z } from "zod";
import type { voiceContracts } from "@/lib/types/api";
import { trainStyleCardFromChannel } from "@/server/voice/train";
import type { HandlerOpts } from "./_shared";

type TrainInput = z.output<typeof voiceContracts.trainFromChannel.input>;

/**
 * voice router (Wave D) — train_on_my_channel derivation entrypoint
 * (WAVE-D-PLAN §2c). D0 STUB: delegates to the frozen
 * `trainStyleCardFromChannel` contract, which returns a plausible trained
 * voice profile. Tenancy is enforced by workspaceProcedure upstream; the
 * real consent-gated derivation + persistence ships in D2.
 */
export const voiceImpl = {
  trainFromChannel({ ctx, input }: HandlerOpts<TrainInput>) {
    return trainStyleCardFromChannel(
      { workspaceId: ctx.workspaceId },
      {
        channelId: input.channelId,
        sampleVideoIds: input.sampleVideoIds,
        remixFrom: input.remixFrom,
        name: input.name,
      },
    );
  },
};
