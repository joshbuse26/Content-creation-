import { createServer } from "node:http";
import { Worker, type Job } from "bullmq";
import { getConfig, PRODUCT_NAME } from "@/lib/config";
import { logger } from "@/lib/logger";
import { getRedisConnection, hasRedis } from "@/queue/connection";
import { getQueue, JOB_NAMES, QUEUE_NAMES } from "@/queue/queues";
import { processSyncQueueJob } from "@/pipelines/sync/processor";
import { registerSyncSchedules } from "@/pipelines/sync/schedule";
import {
  handleGenerateScriptJob,
  handleProposeFramesJob,
  handleResearchJob,
  handleRevisionPassJob,
  handleTitlesJob,
} from "@/pipelines/script/jobs";
import { handlePackagingJob } from "@/pipelines/packaging";
import { processIdeationJob, registerIdeationSchedules } from "@/pipelines/ideation";
import { handleThumbnailsJob } from "@/pipelines/thumbnails";
import { getErrorReporter, initErrorReporting, runCreditReconciliation } from "@/server/ops";
import { registerS3StorageClient } from "@/server/storage/register-s3";

/**
 * Worker entrypoint — `pnpm worker` / the Railway `worker` service.
 *
 * Integration wiring (sprint integration pass):
 *   script queue:    generate-script → A2 · revision-pass → A2 ·
 *                    research → A2 · propose-frames → A2
 *   sync queue:      channel-sync / avatar-generate / post-publish-tracking
 *                    → A1's processSyncQueueJob · credit-reconcile → A4 ·
 *                    daily-ideas / outlier-refresh → B1's processIdeationJob
 *   packaging queue: titles → A2 · description/tags/chapters → A4 ·
 *                    thumbnails → B4's handleThumbnailsJob
 */

/** Worker-local job + scheduler ids for the nightly credit reconciliation
 *  (spec §2.8 / §3 credit_ledger). Not part of the frozen JOB_NAMES set —
 *  the job never leaves this process's sync-queue registration. */
const CREDIT_RECONCILE_JOB = "credit-reconcile";
const CREDIT_RECONCILE_SCHEDULER_ID = "nightly-credit-reconcile";
/** 03:00 UTC nightly, before the sync sweeps. */
const CREDIT_RECONCILE_PATTERN = "0 3 * * *";

async function registerCreditReconciliationSchedule(): Promise<void> {
  const queue = getQueue(QUEUE_NAMES.sync);
  await queue.upsertJobScheduler(
    CREDIT_RECONCILE_SCHEDULER_ID,
    { pattern: CREDIT_RECONCILE_PATTERN, tz: "UTC" },
    { name: CREDIT_RECONCILE_JOB, data: {} },
  );
}

/** Railway healthcheck hits /api/health on $PORT — worker is not Next, so serve a tiny probe. */
function startHealthServer(): void {
  const port = Number(process.env.PORT ?? "8080");
  if (!Number.isFinite(port) || port <= 0) return;
  const server = createServer((req, res) => {
    if (req.url === "/api/health" || req.url === "/healthz" || req.url === "/") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, role: "worker" }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(port, () => {
    logger.info({ port }, "worker health server listening");
  });
}

async function main(): Promise<void> {
  const config = getConfig();
  await initErrorReporting();
  registerS3StorageClient();
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
  startHealthServer();

  const scriptWorker = new Worker(
    QUEUE_NAMES.script,
    async (job: Job) => {
      switch (job.name) {
        case JOB_NAMES.generateScript:
          await handleGenerateScriptJob(job.data);
          return;
        case JOB_NAMES.revisionPass:
          await handleRevisionPassJob(job.data);
          return;
        case JOB_NAMES.research:
          await handleResearchJob(job.data);
          return;
        case JOB_NAMES.proposeFrames:
          await handleProposeFramesJob(job.data);
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
        case JOB_NAMES.channelSync:
        case JOB_NAMES.avatarGenerate:
        case JOB_NAMES.postPublishTracking:
          await processSyncQueueJob(job);
          return;
        case CREDIT_RECONCILE_JOB: {
          const report = await runCreditReconciliation();
          logger.info(
            { workspaces: report.checkedWorkspaces, drifted: report.drifted.length, ok: report.ok },
            "credit reconciliation complete",
          );
          return;
        }
        case JOB_NAMES.dailyIdeas:
        case JOB_NAMES.outlierRefresh:
          await processIdeationJob(job);
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
        case JOB_NAMES.titles:
          await handleTitlesJob(job.data);
          return;
        case JOB_NAMES.description:
        case JOB_NAMES.tags:
        case JOB_NAMES.chapters:
          await handlePackagingJob(job.name, job.data);
          return;
        case JOB_NAMES.thumbnails:
          await handleThumbnailsJob(job.data);
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
      getErrorReporter().captureException(err, {
        queue: worker.name,
        job: job?.name ?? "unknown",
      });
    });
    worker.on("error", (err) => {
      logger.error({ queue: worker.name, err: err.message }, "worker error");
      getErrorReporter().captureException(err, { queue: worker.name });
    });
  }

  // Nightly repeatable jobs — schedules live in code, never platform cron
  // (spec §2.8). upsertJobScheduler is idempotent per boot.
  await registerSyncSchedules();
  await registerIdeationSchedules();
  await registerCreditReconciliationSchedule();

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

main().catch((err: unknown) => {
  logger.fatal({ err }, "worker crashed on startup");
  process.exit(1);
});
