import { z } from "zod";
import { logger } from "@/lib/logger";
import { avatarJobInputSchema, syncJobInputSchema } from "@/lib/types/pipeline";
import { JOB_NAMES } from "@/queue/queues";
import { getChannelDomainDeps, type ChannelDomainDeps } from "@/server/channel/deps";
import { createQueueSyncEnqueuer, type SyncEnqueuer } from "@/server/channel/jobs";
import { makeChannelYoutubeResolver } from "@/server/channel/oauth-token";
import { runAvatarGeneration } from "@/pipelines/avatar/pipeline";
import { runChannelSync } from "./pipeline";
import { runPostPublishTracking, trackingSweepInputSchema } from "./tracking";

/**
 * Sync-queue job processor — INTEGRATOR WIRING POINT (A0).
 *
 * worker/index.ts's sync Worker should delegate its channelSync,
 * avatarGenerate and postPublishTracking cases to processSyncQueueJob (see
 * REQUESTS-A1.md). Each nightly job arrives as a sweep ({sweep: true},
 * registered by registerSyncSchedules in schedule.ts) that fans out one
 * queued job per channel; per-channel jobs carry syncJobInputSchema data.
 */

/** channel-sync accepts a single channel or the nightly sweep sentinel. */
export const channelSyncJobDataSchema = z.union([syncJobInputSchema, trackingSweepInputSchema]);

export interface SyncProcessorDeps extends ChannelDomainDeps {
  enqueuer: SyncEnqueuer;
}

async function defaultProcessorDeps(): Promise<SyncProcessorDeps> {
  const deps = await getChannelDomainDeps();
  return { ...deps, enqueuer: createQueueSyncEnqueuer() };
}

export const A1_SYNC_JOB_NAMES: readonly string[] = [
  JOB_NAMES.channelSync,
  JOB_NAMES.avatarGenerate,
  JOB_NAMES.postPublishTracking,
];

/**
 * Process one job from the frozen `sync` queue. Throws on failure so the
 * worker surfaces it to BullMQ's job-level safety-net retry.
 */
export async function processSyncQueueJob(
  job: { name: string; data: unknown },
  depsOverride?: SyncProcessorDeps,
): Promise<void> {
  const deps = depsOverride ?? (await defaultProcessorDeps());

  switch (job.name) {
    case JOB_NAMES.channelSync: {
      const data = channelSyncJobDataSchema.parse(job.data);
      if ("sweep" in data) {
        const channels = await deps.channelRepo.listAllForSweep();
        logger.info({ channels: channels.length }, "nightly sync sweep: fanning out");
        for (const channel of channels) {
          await deps.enqueuer.enqueueChannelSync({
            workspaceId: channel.workspaceId,
            channelId: channel.id,
          });
        }
        return;
      }
      await runChannelSync(
        {
          channelRepo: deps.channelRepo,
          youtube: deps.providers.youtube,
          quota: deps.quota,
          resolveYoutube: makeChannelYoutubeResolver(deps),
        },
        data,
      );
      return;
    }
    case JOB_NAMES.avatarGenerate: {
      const input = avatarJobInputSchema.parse(job.data);
      await runAvatarGeneration(
        {
          channelRepo: deps.channelRepo,
          avatarRepo: deps.avatarRepo,
          youtube: deps.providers.youtube,
          transcript: deps.providers.transcript,
          llm: deps.providers.llm,
          quota: deps.quota,
        },
        input,
      );
      return;
    }
    case JOB_NAMES.postPublishTracking: {
      // Nightly sweep — data is {sweep: true} (or empty legacy payloads).
      await runPostPublishTracking({
        trackingRepo: deps.trackingRepo,
        channelRepo: deps.channelRepo,
        youtube: deps.providers.youtube,
        quota: deps.quota,
      });
      return;
    }
    default:
      throw new Error(`processSyncQueueJob: unhandled job ${job.name}`);
  }
}
