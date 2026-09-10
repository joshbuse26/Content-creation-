import type { z } from "zod";
import type { thumbnailsContracts } from "@/lib/types/api";
import type { ThumbnailConcept } from "@/lib/types/entities";
import { getEngineDeps } from "@/pipelines/script/deps";
import {
  chooseThumbnailConcept,
  handleThumbnailsJob,
  listThumbnailConcepts,
  THUMBNAIL_CREDIT_COST,
  type ThumbnailsJobData,
} from "@/pipelines/thumbnails";
import { requireCredits } from "@/server/credits";
import { dispatchPipelineJob } from "@/pipelines/script/execute";
import { JOB_NAMES, QUEUE_NAMES } from "@/queue/queues";
import { jobAccepted, notFound, type HandlerOpts } from "./_shared";

type GenerateInput = z.output<typeof thumbnailsContracts.generate.input>;
type ListInput = z.output<typeof thumbnailsContracts.list.input>;
type ChooseInput = z.output<typeof thumbnailsContracts.choose.input>;

/**
 * thumbnails router — spec §5.10 / §6. Generation is credit-gated at
 * dispatch (3 credits: 1 per image, spec §7) and charged idempotently on
 * completion inside the pipeline; list/choose read and update
 * thumbnail_concepts rows scoped by workspace.
 */
export const thumbnailsImpl = {
  /** Starts the 2-stage thumbnail pipeline; 3 credits charged on completion. */
  async generate({ ctx, input }: HandlerOpts<GenerateInput>) {
    await requireCredits(ctx.workspaceId, THUMBNAIL_CREDIT_COST);
    const deps = await getEngineDeps();
    const project = await deps.store.getProject(ctx.workspaceId, input.projectId);
    if (project === null) notFound("project");
    const payload: ThumbnailsJobData = {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      compositionPattern: input.compositionPattern,
      subjectDescription: input.subjectDescription,
      // Face photo upload is a follow-up slice — the frozen contract has no
      // face field, so the job always runs without a reference for now.
      faceImageKey: null,
      actorUserId: ctx.userId as string,
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
} as const;
