import type { z } from "zod";
import { getProviders } from "@/lib/providers";
import type { tagsContracts } from "@/lib/types/api";
import type { TagSet } from "@/lib/types/entities";
import type { UserId, WorkspaceId } from "@/lib/types/ids";
import { loadPackagingContext } from "@/pipelines/packaging/context";
import { insertTagSet, latestTagSet, updateTagSetTags } from "@/pipelines/packaging/persist";
import { generateTagList } from "@/pipelines/packaging/tags";

/**
 * tags router implementation — A4. Handlers keyed by procedure name, matching
 * the frozen tagsContracts schemas. Generation is Haiku (spec §2/§5.11) with
 * a deterministic fallback so fixture mode always yields 15-25 valid tags.
 *
 * Integrator: `.mutation(({ ctx, input }) => tagsHandlers.generate({ ctx, input }))`
 * (and likewise for latest/update) in _contracts.ts.
 */

interface HandlerCtx {
  userId: UserId;
  workspaceId: WorkspaceId;
}

type GenerateInput = z.output<typeof tagsContracts.generate.input>;
type LatestInput = z.output<typeof tagsContracts.latest.input>;
type UpdateInput = z.output<typeof tagsContracts.update.input>;

export const tagsHandlers = {
  async generate(opts: { ctx: HandlerCtx; input: GenerateInput }): Promise<TagSet> {
    const { ctx, input } = opts;
    const packagingCtx = await loadPackagingContext(ctx.workspaceId, input.projectId);
    const { llm } = await getProviders();
    const tags = await generateTagList(llm, packagingCtx);
    return insertTagSet({ workspaceId: ctx.workspaceId, projectId: input.projectId, tags });
  },

  async latest(opts: { ctx: HandlerCtx; input: LatestInput }): Promise<TagSet | null> {
    return latestTagSet(opts.ctx.workspaceId, opts.input.projectId);
  },

  async update(opts: { ctx: HandlerCtx; input: UpdateInput }): Promise<TagSet> {
    return updateTagSetTags(opts.ctx.workspaceId, opts.input.tagSetId, opts.input.tags);
  },
} as const;
