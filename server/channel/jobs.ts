import { randomUUID } from "node:crypto";
import { logger } from "@/lib/logger";
import type { AvatarJobInput, SyncJobInput } from "@/lib/types/pipeline";
import { hasRedis } from "@/queue/connection";
import { getQueue, JOB_NAMES, QUEUE_NAMES } from "@/queue/queues";
import { runAvatarGeneration } from "@/pipelines/avatar/pipeline";
import { runChannelSync } from "@/pipelines/sync/pipeline";
import { getChannelDomainDeps, type ChannelDomainDeps } from "./deps";
import { makeChannelYoutubeResolver } from "./oauth-token";

/**
 * Job enqueueing for the A1 channel domain. With Redis, jobs land on the
 * frozen `sync` queue (worker executes the pipelines). Without Redis
 * (keyless fixture mode), the pipelines run inline against fixture
 * providers so connect → sync → avatar still fully works with zero env.
 */

export interface SyncEnqueuer {
  /** Returns a job id usable as the contract's pipelineRunIds entry. */
  enqueueChannelSync(input: SyncJobInput): Promise<string>;
  enqueueAvatarGenerate(input: AvatarJobInput): Promise<string>;
}

export function createQueueSyncEnqueuer(): SyncEnqueuer {
  return {
    async enqueueChannelSync(input) {
      const job = await getQueue(QUEUE_NAMES.sync).add(JOB_NAMES.channelSync, input);
      return job.id ?? randomUUID();
    },
    async enqueueAvatarGenerate(input) {
      const job = await getQueue(QUEUE_NAMES.sync).add(JOB_NAMES.avatarGenerate, input);
      return job.id ?? randomUUID();
    },
  };
}

export function createInlineSyncEnqueuer(
  getDeps: () => Promise<ChannelDomainDeps> = getChannelDomainDeps,
): SyncEnqueuer {
  return {
    async enqueueChannelSync(input) {
      const id = `inline-sync-${randomUUID()}`;
      try {
        const deps = await getDeps();
        await runChannelSync(
          {
            channelRepo: deps.channelRepo,
            youtube: deps.providers.youtube,
            quota: deps.quota,
            resolveYoutube: makeChannelYoutubeResolver(deps),
          },
          input,
        );
      } catch (err) {
        // Job semantics: enqueueing never fails the request; the failure is
        // recorded on the channel (sync_status=failed) and logged.
        logger.error(
          { channelId: input.channelId, err: err instanceof Error ? err.message : String(err) },
          "inline channel sync failed",
        );
      }
      return id;
    },
    async enqueueAvatarGenerate(input) {
      const id = `inline-avatar-${randomUUID()}`;
      try {
        const deps = await getDeps();
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
      } catch (err) {
        logger.error(
          { channelId: input.channelId, err: err instanceof Error ? err.message : String(err) },
          "inline avatar generation failed",
        );
      }
      return id;
    },
  };
}

let defaultEnqueuer: SyncEnqueuer | undefined;

export function getDefaultSyncEnqueuer(): SyncEnqueuer {
  defaultEnqueuer ??= hasRedis() ? createQueueSyncEnqueuer() : createInlineSyncEnqueuer();
  return defaultEnqueuer;
}

/** Test hook. */
export function resetDefaultSyncEnqueuerForTests(): void {
  defaultEnqueuer = undefined;
}
