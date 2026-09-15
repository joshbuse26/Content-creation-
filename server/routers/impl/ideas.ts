import { createHash, randomUUID } from "node:crypto";
import type { z } from "zod";
import type { ideasContracts } from "@/lib/types/api";
import type {
  CompetitorCompareResult,
  DemandSignal,
  Frame,
  Idea,
  NicheVideo,
  Project,
  WhyItWorked,
} from "@/lib/types/entities";
import { compareKeyInput, runCompetitorCompare } from "@/pipelines/ideation/compete";
import { computeTopicDemand } from "@/pipelines/ideation/demand";
import { getIdeationDeps } from "@/pipelines/ideation/deps";
import { IDEA_BATCH_CREDIT_COST } from "@/pipelines/ideation/ideas";
import { processIdeationJob } from "@/pipelines/ideation/jobs";
import { normalizeKeyword } from "@/pipelines/ideation/similarity";
import { computeWhyItWorked } from "@/pipelines/ideation/why";
import { dispatchPipelineJob } from "@/pipelines/script/execute";
import { settleCharge } from "@/pipelines/script/settle-charge";
import { requireCreditsWithOverage } from "@/server/billing";
import {
  CREDIT_COSTS,
  exemptionFromCtx,
  isCtxCreditExempt,
  requireCredits,
} from "@/server/credits";
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
type OutliersInput = z.output<typeof ideasContracts.outliers.input>;
type SearchDemandInput = z.output<typeof ideasContracts.searchDemand.input>;
type UseIdeaInput = z.output<typeof ideasContracts.useIdea.input>;
type WhyItWorkedInput = z.output<typeof ideasContracts.whyItWorked.input>;
type CompetitorCompareInput = z.output<typeof ideasContracts.competitorCompare.input>;

/** Default seed-frame duration when the idea carries none (D3 use-this-idea). */
const SEED_FRAME_MINUTES = 8;

/** E3 dedup window for competitor-compare concept persistence. */
const COMPARE_DEDUP_DAYS = 7;

const MS_PER_DAY = 86_400_000;

/** Map the E3 `recency` filter band to a publishedAfter instant (null = all). */
function recencyPublishedAfter(recency: OutliersInput["recency"], now: Date): Date | undefined {
  if (recency === "week") return new Date(now.getTime() - 7 * MS_PER_DAY);
  if (recency === "month") return new Date(now.getTime() - 31 * MS_PER_DAY);
  return undefined;
}

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
      // Free while ideaBatch cost is 0; still skip charge for credit-exempt actors.
      chargeCredits: CREDIT_COSTS.ideaBatch > 0 && !isCtxCreditExempt(ctx),
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

  /**
   * The raw outlier index for the channel's niche (D3 discovery). niche_videos
   * is a GLOBAL index; the query is scoped to the channel's own niche keywords
   * (verified to belong to the caller's workspace), so no cross-tenant row can
   * leak through the keyword filter.
   */
  async outliers({ ctx, input }: HandlerOpts<OutliersInput>): Promise<NicheVideo[]> {
    const deps = await getIdeationDeps();
    const channel = await deps.channelRepo.get(ctx.workspaceId, input.channelId);
    if (channel === null) notFound("channel");
    const keywords =
      input.nicheKeyword !== null ? [normalizeKeyword(input.nicheKeyword)] : channel.nicheKeywords;
    if (keywords.length === 0) return [];
    const publishedAfter = recencyPublishedAfter(input.recency, deps.now());
    return deps.store.listOutliers({
      nicheKeywords: keywords,
      limit: input.limit,
      ...(publishedAfter !== undefined ? { publishedAfter } : {}),
      ...(input.minOutlierRatio !== null ? { minOutlierRatio: input.minOutlierRatio } : {}),
    });
  },

  /**
   * Search-demand signals for the discovery surface (D3). Reads through the
   * existing web SearchProvider seam (keyless + deterministic in fixture mode);
   * topics default to the channel's niche keywords. Never charges credits.
   */
  async searchDemand({ ctx, input }: HandlerOpts<SearchDemandInput>): Promise<DemandSignal[]> {
    const deps = await getIdeationDeps();
    const channel = await deps.channelRepo.get(ctx.workspaceId, input.channelId);
    if (channel === null) notFound("channel");
    const topics = input.topics.length > 0 ? input.topics : channel.nicheKeywords;
    if (topics.length === 0) return [];
    return computeTopicDemand(deps, topics);
  },

  /**
   * One-click "use this idea" (D3): promote the idea (or reload the project it
   * was already promoted into) and seed a CHOSEN frame carrying the idea's
   * angle so the steerable unique angle reaches framing/outline and
   * buildCoachContext. Idempotent on re-use: the same idea maps to one project
   * and its chosen frame's angle is re-steered, never duplicated.
   */
  async useIdea({
    ctx,
    input,
  }: HandlerOpts<UseIdeaInput>): Promise<{ idea: Idea; project: Project; frame: Frame }> {
    const deps = await getIdeationDeps();
    let idea = await ownedIdea(ctx, input.ideaId);
    const channel = await deps.channelRepo.get(ctx.workspaceId, idea.channelId);
    if (channel === null) notFound("channel");

    // Resolve (or create) the project this idea drives — one per idea.
    let project = await deps.engineStore.getProjectByIdea(ctx.workspaceId, idea.id);
    if (project === null) {
      project = await deps.engineStore.createProject({
        workspaceId: ctx.workspaceId,
        channelId: idea.channelId,
        title: idea.title,
        ideaId: idea.id,
      });
    }
    if (idea.status !== "promoted") {
      const promoted = await deps.engineStore.getProject(ctx.workspaceId, project.id);
      const updated = await deps.store.updateIdeaStatus(ctx.workspaceId, idea.id, "promoted");
      if (updated === null) notFound("idea");
      idea = updated;
      if (promoted !== null) project = promoted;
    }

    // Seed / re-steer the unique angle on a CHOSEN frame. buildCoachContext
    // and the outline path read uniqueAngle off the chosen frame's angle.
    const angle = (input.angle ?? idea.angle).trim() || idea.angle;
    const minutes = input.targetMinutes ?? SEED_FRAME_MINUTES;

    // E3 deepen: prefill the audience-avatar hint so framing lands more
    // complete. If the channel has a generated avatar, fold its sophistication
    // + top pain into the frame's audience segment; else fall back to the
    // first niche keyword (the prior behavior). Read-only + best-effort.
    const avatar = await deps.engineStore.getAvatarForChannel(idea.channelId);
    const audienceHint = avatarAudienceHint(avatar, channel.nicheKeywords[0] ?? "");

    const frames = await deps.engineStore.listFrames(ctx.workspaceId, project.id);
    const chosen = frames.find((f) => f.chosen) ?? null;

    let frame: Frame | null;
    if (chosen !== null) {
      // Re-steer the angle; fill the audience segment only when still empty
      // (never clobber a segment the user already set — keeps re-use idempotent).
      frame = await deps.engineStore.updateFrame(ctx.workspaceId, chosen.id, {
        angle,
        ...(chosen.audienceSegment.trim() === "" && audienceHint !== ""
          ? { audienceSegment: audienceHint }
          : {}),
      });
    } else {
      const [seeded] = await deps.engineStore.insertFrames([
        {
          workspaceId: ctx.workspaceId,
          projectId: project.id,
          chosen: true,
          angle,
          format: "essay",
          outcome: "watch_time",
          audienceSegment: audienceHint,
          tone: "conversational",
          targetMinutes: minutes,
          keywords: channel.nicheKeywords,
        },
      ]);
      frame = seeded ?? null;
    }
    if (frame === null) notFound("frame");

    return { idea, project, frame };
  },

  /**
   * E3 "why it worked": short cached Coach-tier blurbs per outlier for the
   * channel's niche. Read-only, zero-cost, scoped exactly like `outliers`.
   */
  async whyItWorked({ ctx, input }: HandlerOpts<WhyItWorkedInput>): Promise<WhyItWorked[]> {
    const deps = await getIdeationDeps();
    const channel = await deps.channelRepo.get(ctx.workspaceId, input.channelId);
    if (channel === null) notFound("channel");
    const keywords =
      input.nicheKeyword !== null ? [normalizeKeyword(input.nicheKeyword)] : channel.nicheKeywords;
    if (keywords.length === 0) return [];
    const videos = await deps.store.listOutliers({ nicheKeywords: keywords, limit: input.limit });
    return computeWhyItWorked(deps, videos);
  },

  /**
   * E3 competitor compare: 1-3 competitor channels → shared outlier THEMES →
   * ORIGINAL concepts persisted as ideas rows. Tenancy-scoped (a foreign own
   * channel is NOT_FOUND). Metered once via the requestBatch 1-credit pattern,
   * idempotent on the (channel + sorted handles) hash — reads are free and a
   * repeat compare of the same competitors neither double-charges nor
   * duplicates concepts. Never clones a named creator (seed-lint inside).
   */
  async competitorCompare({
    ctx,
    input,
  }: HandlerOpts<CompetitorCompareInput>): Promise<CompetitorCompareResult> {
    const deps = await getIdeationDeps();
    const channel = await deps.channelRepo.get(ctx.workspaceId, input.channelId);
    if (channel === null) notFound("channel");

    const chargeKey = `competitorCompare:${createHash("sha1")
      .update(compareKeyInput(input.channelId, input.channelHandles))
      .digest("hex")
      .slice(0, 32)}`;

    // Dispatch gate BEFORE the provider/LLM work (never work you can't pay for).
    const exemption = exemptionFromCtx(ctx);
    await requireCreditsWithOverage(ctx.workspaceId, CREDIT_COSTS.ideaBatch, {
      ...exemption,
      actorUserId: ctx.userId,
      idempotencyKey: chargeKey,
    });

    const now = deps.now();
    const since = new Date(now.getTime() - COMPARE_DEDUP_DAYS * MS_PER_DAY);
    const recentTitles = await deps.store.recentIdeaTitles(ctx.workspaceId, input.channelId, since);

    const { themes, ideas } = await runCompetitorCompare(deps, {
      workspaceId: ctx.workspaceId,
      channelId: input.channelId,
      channelTitle: channel.title,
      nicheKeywords: channel.nicheKeywords,
      channelHandles: input.channelHandles,
      recentTitles,
      generatedOn: now.toISOString().slice(0, 10),
    });

    // Completion charge — idempotent on the compare hash (a re-compare of the
    // same competitors is free). Exempt actors skip the debit entirely.
    await settleCharge(deps.engineStore, {
      workspaceId: ctx.workspaceId,
      delta: -CREDIT_COSTS.ideaBatch,
      reason: "idea_batch",
      actorUserId: ctx.userId,
      projectId: null,
      idempotencyKey: chargeKey,
      skipDebit: isCtxCreditExempt(ctx),
    });

    return { channelHandles: input.channelHandles, themes, ideas };
  },
} as const;

/**
 * A compact audience hint from a channel's avatar — "intermediate · over-spends
 * on gear and still gets sour shots" style. Falls back to the provided default
 * (the first niche keyword) when the channel has no avatar yet.
 */
function avatarAudienceHint(
  avatar: { sophistication: string | null; pains: { pain: string }[] } | null,
  fallback: string,
): string {
  if (avatar === null) return fallback;
  const parts: string[] = [];
  if (avatar.sophistication !== null) parts.push(avatar.sophistication);
  const topPain = avatar.pains[0]?.pain.trim();
  if (topPain !== undefined && topPain !== "") parts.push(topPain);
  const hint = parts.join(" · ").slice(0, 200);
  return hint !== "" ? hint : fallback;
}
