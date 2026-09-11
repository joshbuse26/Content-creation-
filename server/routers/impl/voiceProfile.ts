import { TRPCError } from "@trpc/server";
import type { VoiceProfile } from "@/lib/types/entities";
import { getEngineDeps } from "@/pipelines/script/deps";
import type { HandlerOpts } from "./_shared";
import type { z } from "zod";
import type { voiceProfileContracts } from "@/lib/types/api";

type ListInput = z.output<typeof voiceProfileContracts.list.input>;
type RenameInput = z.output<typeof voiceProfileContracts.rename.input>;
type RemoveInput = z.output<typeof voiceProfileContracts.remove.input>;

/**
 * voiceProfile router — lists and manages voice profiles (the editor's
 * per-section voice picker + WAVE-D-PLAN §2c trained-card management).
 * Workspace-scoped: every store read/write filters on workspace_id, so no
 * cross-tenant profile is ever returned or mutated. No credits — this is
 * configuration data.
 */
export const voiceProfileImpl = {
  async list({ ctx }: HandlerOpts<ListInput>): Promise<VoiceProfile[]> {
    const deps = await getEngineDeps();
    return deps.store.listVoiceProfiles(ctx.workspaceId);
  },

  async rename({ ctx, input }: HandlerOpts<RenameInput>): Promise<VoiceProfile> {
    const deps = await getEngineDeps();
    const updated = await deps.store.renameVoiceProfile(
      ctx.workspaceId,
      input.voiceProfileId,
      input.name,
    );
    if (updated === null) {
      throw new TRPCError({ code: "NOT_FOUND", message: "voice profile not found" });
    }
    return updated;
  },

  async remove({ ctx, input }: HandlerOpts<RemoveInput>): Promise<{ deleted: boolean }> {
    const deps = await getEngineDeps();
    const deleted = await deps.store.deleteVoiceProfile(ctx.workspaceId, input.voiceProfileId);
    if (!deleted) {
      throw new TRPCError({ code: "NOT_FOUND", message: "voice profile not found" });
    }
    return { deleted: true };
  },
};
