import type { VoiceProfile } from "@/lib/types/entities";
import { getEngineDeps } from "@/pipelines/script/deps";
import type { HandlerOpts } from "./_shared";
import type { z } from "zod";
import type { voiceProfileContracts } from "@/lib/types/api";

type ListInput = z.output<typeof voiceProfileContracts.list.input>;

/**
 * voiceProfile router — read-only. Powers the editor's per-section voice
 * picker (multi-voice, PRODUCT-CONTRACTS §7). Workspace-scoped: the store
 * read filters on workspace_id, so no cross-tenant profiles are ever
 * returned. No credits — this is configuration data.
 */
export const voiceProfileImpl = {
  async list({ ctx }: HandlerOpts<ListInput>): Promise<VoiceProfile[]> {
    const deps = await getEngineDeps();
    return deps.store.listVoiceProfiles(ctx.workspaceId);
  },
};
