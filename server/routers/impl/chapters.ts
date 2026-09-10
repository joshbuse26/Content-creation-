import type { z } from "zod";
import type { chaptersContracts } from "@/lib/types/api";
import type { ChapterSet } from "@/lib/types/entities";
import type { UserId, WorkspaceId } from "@/lib/types/ids";
import { deriveChapters } from "@/pipelines/packaging/chapters";
import { loadPackagingContext } from "@/pipelines/packaging/context";
import {
  insertChapterSet,
  latestChapterSet,
  updateChapterSetEntries,
} from "@/pipelines/packaging/persist";

/**
 * chapters router implementation — A4. Handlers keyed by procedure name,
 * matching the frozen chaptersContracts schemas. Derivation is pure code
 * (cumulative section est_seconds, first entry 0:00 — spec §5.11); the
 * result is stored and editable afterwards via `update`.
 *
 * Integrator: `.mutation(({ ctx, input }) => chaptersHandlers.derive({ ctx, input }))`
 * (and likewise for latest/update) in _contracts.ts.
 */

interface HandlerCtx {
  userId: UserId;
  workspaceId: WorkspaceId;
}

type DeriveInput = z.output<typeof chaptersContracts.derive.input>;
type LatestInput = z.output<typeof chaptersContracts.latest.input>;
type UpdateInput = z.output<typeof chaptersContracts.update.input>;

export const chaptersHandlers = {
  async derive(opts: { ctx: HandlerCtx; input: DeriveInput }): Promise<ChapterSet> {
    const { ctx, input } = opts;
    const packagingCtx = await loadPackagingContext(ctx.workspaceId, input.projectId);
    const entries = deriveChapters(packagingCtx.sections);
    return insertChapterSet({
      workspaceId: ctx.workspaceId,
      projectId: input.projectId,
      entries,
    });
  },

  async latest(opts: { ctx: HandlerCtx; input: LatestInput }): Promise<ChapterSet | null> {
    return latestChapterSet(opts.ctx.workspaceId, opts.input.projectId);
  },

  async update(opts: { ctx: HandlerCtx; input: UpdateInput }): Promise<ChapterSet> {
    return updateChapterSetEntries(opts.ctx.workspaceId, opts.input.chapterSetId, [
      ...opts.input.entries,
    ]);
  },
} as const;
