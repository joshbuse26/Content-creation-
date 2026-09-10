import { Queue, type JobsOptions } from "bullmq";
import { getRedisConnection } from "./connection";

/**
 * Queue definitions — FROZEN names. Three queues so a long script run never
 * starves channel syncs or packaging jobs (spec §5).
 */
export const QUEUE_NAMES = {
  script: "script",
  sync: "sync",
  packaging: "packaging",
} as const;
export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** Job names routed within each queue. */
export const JOB_NAMES = {
  // script queue
  generateScript: "generate-script",
  revisionPass: "revision-pass",
  research: "research",
  proposeFrames: "propose-frames",
  // sync queue
  channelSync: "channel-sync",
  avatarGenerate: "avatar-generate",
  outlierRefresh: "outlier-refresh",
  dailyIdeas: "daily-ideas",
  postPublishTracking: "post-publish-tracking",
  // packaging queue
  titles: "titles",
  thumbnails: "thumbnails",
  description: "description",
  tags: "tags",
  chapters: "chapters",
} as const;
export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];

/** Stage-level retries live in the PipelineRunner; BullMQ retries the whole
 *  job once more as a safety net for infra-level failures. */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 2,
  backoff: { type: "exponential", delay: 5_000 },
  removeOnComplete: { count: 500 },
  removeOnFail: { count: 1_000 },
};

const queues = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  const existing = queues.get(name);
  if (existing !== undefined) return existing;
  const queue = new Queue(name, {
    connection: getRedisConnection(),
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  queues.set(name, queue);
  return queue;
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
}
