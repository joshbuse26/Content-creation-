import { TRPCError } from "@trpc/server";
import type { z } from "zod";
import type { thumbnailsContracts } from "@/lib/types/api";
import type { ThumbnailConcept } from "@/lib/types/entities";
import { getEngineDeps } from "@/pipelines/script/deps";
import {
  BOARD_PER_IMAGE_CREDIT,
  chooseThumbnailConcept,
  getThumbnailConcept,
  getThumbnailPipelineDeps,
  handleThumbnailsJob,
  listThumbnailBoards,
  listThumbnailConcepts,
  OverlayTextTooLongError,
  resolveCompositionPattern,
  resolveThumbnailPreset,
  runConceptTweak,
  runThumbnailBoard,
  setThumbnailConceptFavorited,
  THUMBNAIL_CREDIT_COST,
  type GeneratedBoard,
  type ThumbnailBoard,
  type ThumbnailsJobData,
} from "@/pipelines/thumbnails";
import { exemptionFromCtx, isCtxCreditExempt, requireCredits } from "@/server/credits";
import { dispatchPipelineJob } from "@/pipelines/script/execute";
import { JOB_NAMES, QUEUE_NAMES } from "@/queue/queues";
import { jobAccepted, notFound, type HandlerOpts } from "./_shared";

type GenerateInput = z.output<typeof thumbnailsContracts.generate.input>;
type ListInput = z.output<typeof thumbnailsContracts.list.input>;
type ChooseInput = z.output<typeof thumbnailsContracts.choose.input>;
type GenerateBoardInput = z.output<typeof thumbnailsContracts.generateBoard.input>;
type TweakConceptInput = z.output<typeof thumbnailsContracts.tweakConcept.input>;
type FavoriteInput = z.output<typeof thumbnailsContracts.favorite.input>;
type ChooseWinnerInput = z.output<typeof thumbnailsContracts.chooseWinner.input>;
type ListBoardInput = z.output<typeof thumbnailsContracts.listBoard.input>;

/** Overlay word-cap overflow → a clear BAD_REQUEST (never silent truncation). */
function asTRPCError(err: unknown): never {
  if (err instanceof OverlayTextTooLongError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
  }
  throw err;
}

/**
 * thumbnails router — spec §5.10 / §6 + PRODUCT-CONTRACTS §5, extended by the
 * Thumbnail Whiteboard Studio (WAVE-D / E2).
 *
 * One-shot path (generate/list/choose) is unchanged: generation is
 * credit-gated at dispatch (3 credits, 1 per image) and charged idempotently
 * on completion inside the queued pipeline.
 *
 * Whiteboard path (generateBoard/tweakConcept/favorite/unfavorite/
 * chooseWinner/listBoard) runs synchronously and returns the concept rows so
 * the board renders without polling. Metering is identical to the one-shot
 * contract — per image, idempotent, credit-exempt via exemptionFromCtx — just
 * metered per concept. favorite/unfavorite/chooseWinner/listBoard never
 * charge. Every read and write is workspace-scoped (cross-workspace →
 * NOT_FOUND).
 */
export const thumbnailsImpl = {
  /** Starts the 2-stage thumbnail pipeline; 3 credits charged on completion. */
  async generate({ ctx, input }: HandlerOpts<GenerateInput>) {
    await requireCredits(ctx.workspaceId, THUMBNAIL_CREDIT_COST, exemptionFromCtx(ctx));
    const deps = await getEngineDeps();
    const project = await deps.store.getProject(ctx.workspaceId, input.projectId);
    if (project === null) notFound("project");
    const preset = resolveThumbnailPreset(project);
    const { pattern } = resolveCompositionPattern(input.compositionPattern, preset);
    const payload: ThumbnailsJobData = {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      compositionPattern: pattern,
      subjectDescription: input.subjectDescription,
      // Face photo upload is a follow-up slice — the frozen contract has no
      // face field, so the job always runs without a reference for now.
      faceImageKey: null,
      actorUserId: ctx.userId,
      creditExempt: isCtxCreditExempt(ctx),
      presetArchetypeId: preset?.id ?? null,
      // Additive contract field (REQUESTS-C3 #1) — the pipeline enforces
      // the preset's maxOverlayWords cap (reject, never silent truncation).
      overlayText: input.overlayText,
    };
    await dispatchPipelineJob(QUEUE_NAMES.packaging, JOB_NAMES.thumbnails, payload, () =>
      handleThumbnailsJob(payload),
    );
    return jobAccepted();
  },

  async list({ ctx, input }: HandlerOpts<ListInput>): Promise<ThumbnailConcept[]> {
    return listThumbnailConcepts(ctx.workspaceId, input.projectId);
  },

  async choose({ ctx, input }: HandlerOpts<ChooseInput>): Promise<ThumbnailConcept> {
    const chosen = await chooseThumbnailConcept(ctx.workspaceId, input.thumbnailConceptId);
    if (chosen === null) notFound("thumbnail concept");
    return chosen;
  },

  // -- Whiteboard Studio -----------------------------------------------------

  /**
   * Generate a board of N concepts. Metered per image (N credits) at the
   * existing per-image rate, idempotent per concept. Credit-gated for the
   * whole batch at dispatch, then charged per concept on completion.
   */
  async generateBoard({ ctx, input }: HandlerOpts<GenerateBoardInput>): Promise<GeneratedBoard> {
    await requireCredits(
      ctx.workspaceId,
      input.count * BOARD_PER_IMAGE_CREDIT,
      exemptionFromCtx(ctx),
    );
    const engine = await getEngineDeps();
    const project = await engine.store.getProject(ctx.workspaceId, input.projectId);
    if (project === null) notFound("project");
    const deps = await getThumbnailPipelineDeps();
    try {
      return await runThumbnailBoard(deps, {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        count: input.count,
        project: {
          generationMode: project.generationMode,
          archetypeId: project.archetypeId,
          crossover: project.crossover,
        },
        actorUserId: ctx.userId,
        creditExempt: isCtxCreditExempt(ctx),
        overlayText: input.overlayText,
        presetId: input.preset,
        subjectMode: input.subject,
        colorMood: input.mood,
      });
    } catch (err) {
      asTRPCError(err);
    }
  },

  /** Regenerate one concept's image with tweaked params; 1 credit, idempotent. */
  async tweakConcept({ ctx, input }: HandlerOpts<TweakConceptInput>): Promise<ThumbnailConcept> {
    const concept = await getThumbnailConcept(ctx.workspaceId, input.conceptId);
    if (concept === null) notFound("thumbnail concept");
    await requireCredits(ctx.workspaceId, BOARD_PER_IMAGE_CREDIT, exemptionFromCtx(ctx));
    const deps = await getThumbnailPipelineDeps();
    let updated: ThumbnailConcept | null;
    try {
      updated = await runConceptTweak(deps, {
        workspaceId: input.workspaceId,
        concept,
        actorUserId: ctx.userId,
        creditExempt: isCtxCreditExempt(ctx),
        compositionPattern: input.compositionPattern,
        overlayText: input.overlayText,
        presetId: input.preset,
        subjectMode: input.subject,
        colorMood: input.mood,
      });
    } catch (err) {
      asTRPCError(err);
    }
    if (updated === null) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "thumbnail regeneration failed — no credits were charged",
      });
    }
    return updated;
  },

  async favorite({ ctx, input }: HandlerOpts<FavoriteInput>): Promise<ThumbnailConcept> {
    const updated = await setThumbnailConceptFavorited(ctx.workspaceId, input.conceptId, true);
    if (updated === null) notFound("thumbnail concept");
    return updated;
  },

  async unfavorite({ ctx, input }: HandlerOpts<FavoriteInput>): Promise<ThumbnailConcept> {
    const updated = await setThumbnailConceptFavorited(ctx.workspaceId, input.conceptId, false);
    if (updated === null) notFound("thumbnail concept");
    return updated;
  },

  /** Pick the winner: status=chosen + attach to packaging. No charge. */
  async chooseWinner({ ctx, input }: HandlerOpts<ChooseWinnerInput>): Promise<ThumbnailConcept> {
    const chosen = await chooseThumbnailConcept(ctx.workspaceId, input.conceptId);
    if (chosen === null) notFound("thumbnail concept");
    return chosen;
  },

  async listBoard({ ctx, input }: HandlerOpts<ListBoardInput>): Promise<ThumbnailBoard[]> {
    return listThumbnailBoards(ctx.workspaceId, input.projectId);
  },
} as const;
