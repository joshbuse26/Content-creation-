import { Worker, type Job } from "bullmq";
import { getConfig, PRODUCT_NAME } from "@/lib/config";
import { logger } from "@/lib/logger";
import { hasDb } from "@/db";
import { getRedisConnection, hasRedis } from "@/queue/connection";
import { JOB_NAMES, QUEUE_NAMES } from "@/queue/queues";
import {
  InMemoryPipelineRunStore,
  PipelineRunner,
  type PipelineDefinition,
  type PipelineRunStore,
} from "@/queue/pipeline-runner";
import { DrizzlePipelineRunStore } from "@/queue/store";
import {
  AVATAR_STAGES,
  IDEAS_STAGES,
  REVISION_STAGES,
  SCRIPT_STAGES,
  THUMBNAIL_STAGES,
  avatarJobInputSchema,
  ideasJobInputSchema,
  revisionJobInputSchema,
  scriptJobInputSchema,
  syncJobInputSchema,
  thumbnailJobInputSchema,
} from "@/lib/types/pipeline";
import type { PipelineKind } from "@/lib/types/enums";

/**
 * Worker entrypoint — `pnpm worker` / the Railway `worker` service.
 *
 * Day-1 skeleton: every stage body is a validated no-op so the queue plumbing,
 * pipeline_runs persistence, resume and retry behavior are real end-to-end.
 * Wave-2 agents (A1/A2/A4) replace stage bodies inside their own pipeline
 * directories — the wiring here does not change shape.
 */

function placeholderPipeline<TInput>(
  kind: PipelineKind,
  stages: readonly string[],
): PipelineDefinition<TInput> {
  return {
    kind,
    stages: stages.map((name) => ({
      name,
      run: (input: TInput) => {
        logger.info({ kind, stage: name, input }, "stage executed (skeleton no-op)");
        return Promise.resolve();
      },
    })),
  };
}

interface WorkspaceScopedJob {
  workspaceId: string;
  projectId?: string | null;
}

function makeStore(): PipelineRunStore {
  if (hasDb()) {
    return new DrizzlePipelineRunStore();
  }
  logger.warn("DATABASE_URL not set — pipeline runs persist in memory only");
  return new InMemoryPipelineRunStore();
}

function main(): void {
  const config = getConfig();
  logger.info(
    { product: PRODUCT_NAME, providers: config.PROVIDERS, node: process.version },
    "worker starting",
  );

  if (!hasRedis()) {
    logger.error("REDIS_URL is not set — worker cannot start. Set it and restart.");
    process.exitCode = 1;
    return;
  }

  const connection = getRedisConnection();
  const store = makeStore();
  const runner = new PipelineRunner(store);

  const runPipeline = async (
    kind: PipelineKind,
    stages: readonly string[],
    input: WorkspaceScopedJob,
  ) => {
    const result = await runner.execute(placeholderPipeline<WorkspaceScopedJob>(kind, stages), {
      workspaceId: input.workspaceId,
      projectId: input.projectId ?? null,
      input,
    });
    if (result.status === "failed") {
      // Surface to BullMQ so the job-level safety-net retry kicks in.
      throw new Error(`pipeline ${kind} failed at stage ${result.stage}: ${result.error}`);
    }
    logger.info({ kind, skipped: result.skippedStages }, "pipeline complete");
  };

  const scriptWorker = new Worker(
    QUEUE_NAMES.script,
    async (job: Job) => {
      switch (job.name) {
        case JOB_NAMES.generateScript: {
          const input = scriptJobInputSchema.parse(job.data);
          await runPipeline("script", SCRIPT_STAGES, input);
          return;
        }
        case JOB_NAMES.revisionPass: {
          const input = revisionJobInputSchema.parse(job.data);
          await runPipeline("revision", REVISION_STAGES, { ...input, projectId: null });
          return;
        }
        case JOB_NAMES.research:
        case JOB_NAMES.proposeFrames:
          // A2 wires these to real pipelines; skeleton acknowledges them.
          logger.info({ job: job.name }, "job acknowledged (skeleton no-op)");
          return;
        default:
          throw new Error(`unknown job ${job.name} on queue ${QUEUE_NAMES.script}`);
      }
    },
    { connection },
  );

  const syncWorker = new Worker(
    QUEUE_NAMES.sync,
    async (job: Job) => {
      switch (job.name) {
        case JOB_NAMES.channelSync: {
          const input = syncJobInputSchema.parse(job.data);
          logger.info({ input }, "channel sync acknowledged (skeleton no-op)");
          return;
        }
        case JOB_NAMES.avatarGenerate: {
          const input = avatarJobInputSchema.parse(job.data);
          await runPipeline("avatar", AVATAR_STAGES, { ...input, projectId: null });
          return;
        }
        case JOB_NAMES.dailyIdeas: {
          const input = ideasJobInputSchema.parse(job.data);
          await runPipeline("ideas", IDEAS_STAGES, { ...input, projectId: null });
          return;
        }
        case JOB_NAMES.outlierRefresh:
        case JOB_NAMES.postPublishTracking:
          logger.info({ job: job.name }, "job acknowledged (skeleton no-op)");
          return;
        default:
          throw new Error(`unknown job ${job.name} on queue ${QUEUE_NAMES.sync}`);
      }
    },
    { connection },
  );

  const packagingWorker = new Worker(
    QUEUE_NAMES.packaging,
    async (job: Job) => {
      switch (job.name) {
        case JOB_NAMES.thumbnails: {
          const input = thumbnailJobInputSchema.parse(job.data);
          await runPipeline("thumbnail", THUMBNAIL_STAGES, input);
          return;
        }
        case JOB_NAMES.titles:
        case JOB_NAMES.description:
        case JOB_NAMES.tags:
        case JOB_NAMES.chapters:
          logger.info({ job: job.name }, "job acknowledged (skeleton no-op)");
          return;
        default:
          throw new Error(`unknown job ${job.name} on queue ${QUEUE_NAMES.packaging}`);
      }
    },
    { connection },
  );

  const workers = [scriptWorker, syncWorker, packagingWorker];
  for (const worker of workers) {
    worker.on("failed", (job, err) => {
      logger.error({ queue: worker.name, job: job?.name, err: err.message }, "job failed");
    });
    worker.on("error", (err) => {
      logger.error({ queue: worker.name, err: err.message }, "worker error");
    });
  }

  logger.info({ queues: Object.values(QUEUE_NAMES) }, "worker ready");

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "worker shutting down");
    await Promise.all(workers.map((w) => w.close()));
    connection.disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
}

try {
  main();
} catch (err: unknown) {
  logger.fatal({ err }, "worker crashed on startup");
  process.exit(1);
}
