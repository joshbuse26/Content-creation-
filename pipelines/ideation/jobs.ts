import { z } from "zod";
import { logger } from "@/lib/logger";
import { ideasJobInputSchema, outlierJobInputSchema } from "@/lib/types/pipeline";
import { getQueue, JOB_NAMES, QUEUE_NAMES } from "@/queue/queues";
import { getIdeationDeps, type IdeationDeps } from "./deps";
import { runDailyIdeas } from "./ideas";
import { runOutlierRefresh } from "./outliers";
import { normalizeKeywordSet } from "./similarity";

/**
 * Ideation job processing — INTEGRATOR WIRING POINT (A0, see REQUESTS-B1.md).
 *
 * worker/index.ts's sync Worker should delegate its outlierRefresh and
 * dailyIdeas cases (currently v1.1 no-op acks) to processIdeationJob, and
 * the worker entrypoint should call registerIdeationSchedules() next to
 * registerSyncSchedules(). Both nightly jobs arrive as sweeps
 * ({sweep: true}) that fan out per niche keyword set / per channel;
 * fanned-out jobs carry the frozen per-run input schemas.
 */

const sweepSchema = z.object({ sweep: z.literal(true) });

export const outlierJobDataSchema = z.union([outlierJobInputSchema, sweepSchema]);

/** daily-ideas payload: the frozen input plus dispatch-only extras. */
export const dailyIdeasJobDataSchema = z.union([
  ideasJobInputSchema.extend({
    chargeCredits: z.boolean().optional(),
    actorUserId: z.string().nullable().optional(),
    batchNonce: z.string().optional(),
  }),
  sweepSchema,
]);

export const IDEATION_SCHEDULER_IDS = {
  nightlyOutlierRefresh: "nightly-outlier-refresh",
  dailyIdeaFeed: "daily-idea-feed",
} as const;

export const IDEATION_SCHEDULE_PATTERNS = {
  /** 04:10 UTC — after the 03:10 channel-sync sweep so medians are fresh. */
  nightlyOutlierRefresh: "10 4 * * *",
  /** 06:00 America/New_York (spec §5.4: cron 6am ET per channel). */
  dailyIdeaFeed: "0 6 * * *",
} as const;

export async function registerIdeationSchedules(): Promise<void> {
  const { hasRedis } = await import("@/queue/connection");
  if (!hasRedis()) {
    logger.warn("registerIdeationSchedules skipped — no REDIS_URL");
    return;
  }
  const queue = getQueue(QUEUE_NAMES.sync);
  await queue.upsertJobScheduler(
    IDEATION_SCHEDULER_IDS.nightlyOutlierRefresh,
    { pattern: IDEATION_SCHEDULE_PATTERNS.nightlyOutlierRefresh, tz: "UTC" },
    { name: JOB_NAMES.outlierRefresh, data: { sweep: true } },
  );
  await queue.upsertJobScheduler(
    IDEATION_SCHEDULER_IDS.dailyIdeaFeed,
    { pattern: IDEATION_SCHEDULE_PATTERNS.dailyIdeaFeed, tz: "America/New_York" },
    { name: JOB_NAMES.dailyIdeas, data: { sweep: true } },
  );
  logger.info(
    { schedulers: Object.values(IDEATION_SCHEDULER_IDS) },
    "ideation schedules registered",
  );
}

/** Enqueue with Redis, run inline without it — same code path either way. */
async function dispatch(
  jobName: (typeof JOB_NAMES)["outlierRefresh" | "dailyIdeas"],
  data: Record<string, unknown>,
  inline: () => Promise<unknown>,
): Promise<void> {
  const { hasRedis } = await import("@/queue/connection");
  if (hasRedis()) {
    await getQueue(QUEUE_NAMES.sync).add(jobName, data);
    return;
  }
  await inline();
}

/**
 * Sweep fan-out for the outlier refresh: one run per DISTINCT normalized
 * niche keyword set across all channels (spec §8 — channels in the same
 * niche share searches; the 24h search cache dedupes overlapping keywords
 * across differing sets too).
 */
export async function fanOutOutlierRefresh(deps: IdeationDeps): Promise<number> {
  const channels = await deps.channelRepo.listAllForSweep();
  const seen = new Set<string>();
  let dispatched = 0;
  for (const channel of channels) {
    const keywords = normalizeKeywordSet(channel.nicheKeywords).slice(0, 6);
    if (keywords.length === 0) continue;
    const setKey = keywords.join("|");
    if (seen.has(setKey)) continue;
    seen.add(setKey);
    const data = { nicheKeywords: keywords };
    await dispatch(JOB_NAMES.outlierRefresh, data, () => runOutlierRefresh(deps, data));
    dispatched += 1;
  }
  logger.info({ channels: channels.length, niches: dispatched }, "outlier sweep: fanned out");
  return dispatched;
}

/** Sweep fan-out for the daily feed: one free run per niche-having channel. */
export async function fanOutDailyIdeas(deps: IdeationDeps): Promise<number> {
  const channels = await deps.channelRepo.listAllForSweep();
  let dispatched = 0;
  for (const channel of channels) {
    if (channel.nicheKeywords.length === 0) continue;
    const data = { workspaceId: channel.workspaceId, channelId: channel.id };
    await dispatch(JOB_NAMES.dailyIdeas, data, () => runDailyIdeas(deps, { input: data }));
    dispatched += 1;
  }
  logger.info({ channels: channels.length, dispatched }, "daily ideas sweep: fanned out");
  return dispatched;
}

/**
 * Process one ideation job from the frozen `sync` queue. Throws on failure
 * so the worker surfaces it to BullMQ's job-level safety-net retry.
 */
export async function processIdeationJob(
  job: { name: string; data: unknown },
  depsOverride?: IdeationDeps,
): Promise<void> {
  const deps = depsOverride ?? (await getIdeationDeps());

  switch (job.name) {
    case JOB_NAMES.outlierRefresh: {
      const data = outlierJobDataSchema.parse(job.data);
      if ("sweep" in data) {
        await fanOutOutlierRefresh(deps);
        return;
      }
      await runOutlierRefresh(deps, data);
      return;
    }
    case JOB_NAMES.dailyIdeas: {
      const data = dailyIdeasJobDataSchema.parse(job.data);
      if ("sweep" in data) {
        await fanOutDailyIdeas(deps);
        return;
      }
      const { chargeCredits, actorUserId, batchNonce, ...input } = data;
      await runDailyIdeas(deps, {
        input,
        ...(chargeCredits !== undefined ? { chargeCredits } : {}),
        ...(actorUserId !== undefined ? { actorUserId } : {}),
        ...(batchNonce !== undefined ? { batchNonce } : {}),
      });
      return;
    }
    default:
      throw new Error(`processIdeationJob: unhandled job ${job.name}`);
  }
}
