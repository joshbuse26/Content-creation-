import type { z } from "zod";
import { getProviders } from "@/lib/providers";
import type { descriptionContracts } from "@/lib/types/api";
import type { Description } from "@/lib/types/entities";
import type { UserId, WorkspaceId } from "@/lib/types/ids";
import { loadPackagingContext } from "@/pipelines/packaging/context";
import { generateDescriptionBody } from "@/pipelines/packaging/descriptions";
import {
  findDescriptionTemplate,
  insertDescription,
  listDescriptions,
  updateDescriptionBody,
} from "@/pipelines/packaging/persist";

/**
 * description router implementation — A4. Handlers are keyed by procedure
 * name and match the frozen descriptionContracts schemas exactly. The
 * integrator swaps the stub bodies in _contracts.ts for these:
 *
 *   .mutation(({ ctx, input }) => descriptionHandlers.generate({ ctx, input }))
 *
 * Fixture mode (no DATABASE_URL / PROVIDERS=fixture) works end-to-end with
 * zero env: context and persistence fall back to deterministic fixtures.
 */

interface HandlerCtx {
  userId: UserId;
  workspaceId: WorkspaceId;
}

type GenerateInput = z.output<typeof descriptionContracts.generate.input>;
type ListInput = z.output<typeof descriptionContracts.list.input>;
type UpdateInput = z.output<typeof descriptionContracts.update.input>;

export const descriptionHandlers = {
  /** Sonnet generation in one of three modes, optional {{slot}} template. */
  async generate(opts: { ctx: HandlerCtx; input: GenerateInput }): Promise<Description> {
    const { ctx, input } = opts;
    const packagingCtx = await loadPackagingContext(ctx.workspaceId, input.projectId);
    const template =
      input.templateId === null
        ? null
        : await findDescriptionTemplate(ctx.workspaceId, input.templateId);
    const { llm } = await getProviders();
    const body = await generateDescriptionBody(llm, packagingCtx, input.mode, template);
    return insertDescription({
      workspaceId: ctx.workspaceId,
      projectId: input.projectId,
      mode: input.mode,
      body,
      templateId: template === null ? null : input.templateId,
    });
  },

  async list(opts: { ctx: HandlerCtx; input: ListInput }): Promise<Description[]> {
    return listDescriptions(opts.ctx.workspaceId, opts.input.projectId);
  },

  async update(opts: { ctx: HandlerCtx; input: UpdateInput }): Promise<Description> {
    return updateDescriptionBody(opts.ctx.workspaceId, opts.input.descriptionId, opts.input.body);
  },
} as const;
