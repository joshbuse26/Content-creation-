import { z } from "zod";
import { getProviders } from "@/lib/providers";
import { thumbnailJobInputSchema } from "@/lib/types/pipeline";
import { getEngineDeps } from "@/pipelines/script/deps";
import { getObjectStorage } from "@/server/storage";
import { runThumbnailPipeline, type ThumbnailPipelineDeps } from "./pipeline";

/**
 * Thumbnails queue job handler — the frozen `thumbnails` job on the frozen
 * `packaging` queue.
 *
 * Integrator wiring (worker/index.ts, packaging queue switch — replaces the
 * current acknowledged no-op):
 *
 *   case JOB_NAMES.thumbnails:
 *     await handleThumbnailsJob(job.data);
 *     return;
 */

export const thumbnailsJobDataSchema = z.object({
  ...thumbnailJobInputSchema.shape,
  actorUserId: z.string().nullable().default(null),
});
export type ThumbnailsJobData = z.infer<typeof thumbnailsJobDataSchema>;

/** Default deps: shared run store + credit ledger, real providers/storage. */
export async function getThumbnailPipelineDeps(): Promise<ThumbnailPipelineDeps> {
  const [engine, providers] = await Promise.all([getEngineDeps(), getProviders()]);
  return {
    runs: engine.runs,
    image: providers.image,
    storage: getObjectStorage(),
    recordCredits: (record) => engine.store.recordCredits(record),
  };
}

export async function handleThumbnailsJob(data: unknown): Promise<void> {
  const parsed = thumbnailsJobDataSchema.parse(data);
  const { actorUserId, ...input } = parsed;
  const deps = await getThumbnailPipelineDeps();
  const { result } = await runThumbnailPipeline(deps, { input, actorUserId });
  if (result.status === "failed") {
    // Surface the failure to BullMQ so its job-level retry safety net and
    // the worker's failure reporting both see it.
    throw new Error(`thumbnail pipeline failed at ${result.stage}: ${result.error}`);
  }
}
