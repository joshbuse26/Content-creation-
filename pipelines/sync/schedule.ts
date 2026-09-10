import { logger } from "@/lib/logger";
import { hasRedis } from "@/queue/connection";
import { getQueue, JOB_NAMES, QUEUE_NAMES } from "@/queue/queues";

/**
 * Nightly repeatable jobs on the frozen `sync` queue, registered as BullMQ
 * job schedulers (schedules live in code, never platform cron — spec §2.8).
 *
 * INTEGRATOR WIRING POINT (A0): call registerSyncSchedules() once from the
 * worker entrypoint after the workers are constructed (see REQUESTS-A1.md).
 * upsertJobScheduler is idempotent, so calling it on every boot is correct.
 *
 * - nightly-channel-sync   03:10 UTC — {sweep:true} fans out one channel-sync
 *                          job per connected channel (spec §5.1).
 * - nightly-post-publish   03:40 UTC — stats pull for projects with a
 *                          published_video_id (spec §5.12).
 * Quota: ~50 channels × ~4u + ~1u/published video ≈ well inside the budget
 * even before the 9k circuit breaker (spec §8).
 */

export const SYNC_SCHEDULER_IDS = {
  nightlyChannelSync: "nightly-channel-sync",
  nightlyPostPublishTracking: "nightly-post-publish-tracking",
} as const;

export const SYNC_SCHEDULE_PATTERNS = {
  /** 03:10 UTC daily. */
  nightlyChannelSync: "10 3 * * *",
  /** 03:40 UTC daily — after syncs so medians are fresh. */
  nightlyPostPublishTracking: "40 3 * * *",
} as const;

export async function registerSyncSchedules(): Promise<void> {
  if (!hasRedis()) {
    logger.warn("registerSyncSchedules skipped — no REDIS_URL");
    return;
  }
  const queue = getQueue(QUEUE_NAMES.sync);
  await queue.upsertJobScheduler(
    SYNC_SCHEDULER_IDS.nightlyChannelSync,
    { pattern: SYNC_SCHEDULE_PATTERNS.nightlyChannelSync, tz: "UTC" },
    { name: JOB_NAMES.channelSync, data: { sweep: true } },
  );
  await queue.upsertJobScheduler(
    SYNC_SCHEDULER_IDS.nightlyPostPublishTracking,
    { pattern: SYNC_SCHEDULE_PATTERNS.nightlyPostPublishTracking, tz: "UTC" },
    { name: JOB_NAMES.postPublishTracking, data: { sweep: true } },
  );
  logger.info(
    { schedulers: Object.values(SYNC_SCHEDULER_IDS) },
    "nightly sync schedules registered",
  );
}
