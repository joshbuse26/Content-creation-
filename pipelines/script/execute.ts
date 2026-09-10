import { hasRedis } from "@/queue/connection";
import { getQueue } from "@/queue/queues";
import type { JobName, QueueName } from "@/queue/queues";

/**
 * Dispatch: with Redis configured the job goes to BullMQ (the worker service
 * runs it); without Redis (fixture mode / keyless dev) the pipeline runs
 * inline in-process — same code path, awaited, so zero-env mode is fully
 * functional and deterministic.
 */
export async function dispatchPipelineJob(
  queueName: QueueName,
  jobName: JobName,
  payload: Record<string, unknown>,
  inline: () => Promise<unknown>,
): Promise<void> {
  if (hasRedis()) {
    await getQueue(queueName).add(jobName, payload);
    return;
  }
  await inline();
}
