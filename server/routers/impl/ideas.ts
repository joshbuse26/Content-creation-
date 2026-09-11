import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { ideasContracts } from "@/lib/types/api";
import type { Idea, Project } from "@/lib/types/entities";
import { getIdeationDeps } from "@/pipelines/ideation/deps";
import { IDEA_BATCH_CREDIT_COST } from "@/pipelines/ideation/ideas";
import { processIdeationJob } from "@/pipelines/ideation/jobs";
import { dispatchPipelineJob } from "@/pipelines/script/execute";
import { exemptionFromCtx, isCtxCreditExempt, requireCredits } from "@/server/credits";
import { JOB_NAMES, QUEUE_NAMES } from "@/queue/queues";
import { badRequest, jobAccepted, notFound, preconditionFailed, type HandlerOpts } from "./_shared";

/**
 * ideas router implementation (§5.4 / §6) — the daily feed, save/dismiss,
 * promote→project, and the paid extra batch.
 *
 * Tenancy: workspaceProcedure has already authorized the caller for
 * ctx.workspaceId; every store read here ALSO filters on the denormalized
 * workspace_id, so an idea (or channel) from another workspace is
 * indistinguishable from a missing one (NOT_FOUND).
 */

type FeedInput = z.output<typeof ideasContracts.feed.input>;
type SaveInput = z.output<typeof ideasContracts.save.input>;
type DismissInput = z.output<typeof ideasContracts.dismiss.input>;
type PromoteInput = z.output<typeof ideasContracts.promote.input>;
type RequestBatchInput = z.output<typeof ideasContracts.requestBatch.input>;

async function ownedIdea(
  ctx: HandlerOpts<SaveInput>["ctx"],
  ideaId: SaveInput["ideaId"],
): Promise<Idea> {
  const deps = await getIdeationDeps();
  const idea = await deps.store.getIdea(ctx.workspaceId, ideaId);
  if (idea === null) notFound("idea");
  return idea;
}

export const ideasHandlers = {
  /** The daily feed for one channel, newest day first, best score first. */
  async feed({ ctx, input }: HandlerOpts<FeedInput>): Promise<Idea[]> {
    const deps = await getIdeationDeps();
    const channel = await deps.channelRepo.get(ctx.workspaceId, input.channelId);
    if (channel === null) notFound("channel");
    return deps.store.listIdeas(ctx.workspaceId, {
      channelId: input.channelId,
      ...(input.status !== undefined ? { status: input.status } : {}),
      limit: input.limit,
    });
  },

  async save({ ctx, input }: HandlerOpts<SaveInput>): Promise<Idea> {
    const idea = await ownedIdea(ctx, input.ideaId);
    if (idea.status === "promoted") {
      badRequest("this idea is already promoted to a project");
    }
    const deps = await getIdeationDeps();
    const updated = await deps.store.updateIdeaStatus(ctx.workspaceId, input.ideaId, "saved");
    if (updated === null) notFound("idea");
    return updated;
  },

  async dismiss({ ctx, input }: HandlerOpts<DismissInput>): Promise<Idea> {
    const idea = await ownedIdea(ctx, input.ideaId);
    if (idea.status === "promoted") {
      badRequest("this idea is already promoted to a project");
    }
    const deps = await getIdeationDeps();
    const updated = await deps.store.updateIdeaStatus(ctx.workspaceId, input.ideaId, "dismissed");
    if (updated === null) notFound("idea");
    return updated;
  },

  /** Promote: creates a project wired to the idea (ideaId, status "idea"). */
  async promote({
    ctx,
    input,
  }: HandlerOpts<PromoteInput>): Promise<{ idea: Idea; project: Project }> {
    const idea = await ownedIdea(ctx, input.ideaId);
    if (idea.status === "promoted") {
      badRequest("this idea was already promoted");
    }
    const deps = await getIdeationDeps();
    const channel = await deps.channelRepo.get(ctx.workspaceId, idea.channelId);
    if (channel === null) notFound("channel");
    const project = await deps.engineStore.createProject({
      workspaceId: ctx.workspaceId,
      channelId: idea.channelId,
      title: idea.title,
      ideaId: idea.id,
    });
    const updated = await deps.store.updateIdeaStatus(ctx.workspaceId, input.ideaId, "promoted");
    if (updated === null) notFound("idea");
    return { idea: updated, project };
  },

  /** Extra idea batch — 1 credit (spec §7), charged on completion. */
  async requestBatch({ ctx, input }: HandlerOpts<RequestBatchInput>) {
    await requireCredits(ctx.workspaceId, IDEA_BATCH_CREDIT_COST, exemptionFromCtx(ctx));
    const deps = await getIdeationDeps();
    const channel = await deps.channelRepo.get(ctx.workspaceId, input.channelId);
    if (channel === null) notFound("channel");
    if (channel.nicheKeywords.length === 0) {
      preconditionFailed(
        "This channel has no niche keywords yet — add them in the channel settings so we know where to look for ideas.",
      );
    }
    const payload = {
      workspaceId: input.workspaceId,
      channelId: input.channelId,
      chargeCredits: !isCtxCreditExempt(ctx),
      actorUserId: ctx.userId as string,
      // Each requested batch is its own run (and its own idempotent
      // 1-credit charge) even on the same day.
      batchNonce: randomUUID(),
    };
    await dispatchPipelineJob(QUEUE_NAMES.sync, JOB_NAMES.dailyIdeas, payload, () =>
      processIdeationJob({ name: JOB_NAMES.dailyIdeas, data: payload }, deps),
    );
    return jobAccepted();
  },
} as const;
