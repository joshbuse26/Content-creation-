import {
  PipelineRunner,
  InMemoryPipelineRunStore,
  type PipelineDefinition,
  type PipelineRunStore,
} from "@/queue/pipeline-runner";
import {
  SYNC_STAGES,
  syncJobInputSchema,
  syncResultSchema,
  type SyncJobInput,
  type SyncResult,
} from "@/lib/types/pipeline";
import type { PipelineKind } from "@/lib/types/enums";
import type { YoutubeProvider, YtChannel, YtVideoStats } from "@/lib/providers/types";
import type { ChannelRepo } from "@/server/channel/repo";
import type { Channel } from "@/lib/types/entities";
import { logger } from "@/lib/logger";
import type { QuotaTracker } from "./quota";

/**
 * §5.1 Channel sync pipeline (queue: sync, job: channel-sync).
 *
 * channels.list → recent 50 uploads (playlistItems.list) → batched
 * videos.list stats (50 ids/call = 1 unit) → channel_stats_snapshots row →
 * recompute median_views_90d. Every YouTube call is charged against the
 * quota circuit breaker BEFORE it is made.
 *
 * Stage sequencing and per-stage 2× retries are owned by PipelineRunner
 * (stage names from lib/types/pipeline.ts SYNC_STAGES). NOTE: the frozen
 * pipeline_runs.kind enum has no "sync" member (spec §3 lists
 * script/ideas/avatar/revision/thumbnail), so sync stage rows are NOT
 * persisted to pipeline_runs — the runner gets a per-run store purely for
 * its sequencing/retry mechanics and the placeholder kind below never
 * reaches Postgres. REQUESTS-A1.md asks A0 to add a "sync" kind so these
 * runs can be persisted like the others.
 */
const SYNC_STORE_KIND: PipelineKind = "avatar"; // placeholder key, in-memory store only — see above

export const RECENT_UPLOADS_COUNT = 50;
const VIDEO_STATS_BATCH_SIZE = 50;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export interface SyncDeps {
  channelRepo: ChannelRepo;
  youtube: YoutubeProvider;
  quota: QuotaTracker;
  /**
   * Per-channel provider selection: oauth-mode channels sync with an
   * authed provider built from their stored refresh token
   * (server/channel/oauth-token.ts); defaults to `youtube` when absent.
   */
  resolveYoutube?: (channel: Channel) => Promise<YoutubeProvider>;
  /** Injectable for tests that want to observe stage rows. */
  runStore?: PipelineRunStore;
  now?: () => Date;
}

/** Median of view counts over videos published in the last 90 days (0 if none). */
export function computeMedianViews90d(
  videos: readonly Pick<YtVideoStats, "publishedAt" | "viewCount">[],
  now: Date,
): number {
  const cutoff = now.getTime() - NINETY_DAYS_MS;
  const counts = videos
    .filter((v) => {
      const t = Date.parse(v.publishedAt);
      return !Number.isNaN(t) && t >= cutoff;
    })
    .map((v) => v.viewCount)
    .sort((a, b) => a - b);
  if (counts.length === 0) return 0;
  const mid = Math.floor(counts.length / 2);
  if (counts.length % 2 === 1) {
    const v = counts[mid];
    return v ?? 0;
  }
  const lo = counts[mid - 1] ?? 0;
  const hi = counts[mid] ?? 0;
  return Math.floor((lo + hi) / 2);
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

interface SyncRunContext {
  channel: Channel;
  yt?: YtChannel;
  videos?: YtVideoStats[];
  snapshotMedian?: number;
}

function buildSyncPipeline(deps: SyncDeps, ctx: SyncRunContext): PipelineDefinition<SyncJobInput> {
  const now = deps.now ?? (() => new Date());

  const stages: Record<(typeof SYNC_STAGES)[number], (input: SyncJobInput) => Promise<void>> = {
    async fetch_channel() {
      await deps.quota.charge("channels.list");
      ctx.yt = await deps.youtube.getChannel(ctx.channel.youtubeChannelId);
    },
    async fetch_videos() {
      const yt = ctx.yt;
      if (yt === undefined) throw new Error("fetch_channel did not run");
      await deps.quota.charge("playlistItems.list");
      const videoIds = await deps.youtube.listRecentVideoIds(
        yt.uploadsPlaylistId,
        RECENT_UPLOADS_COUNT,
      );
      const batches = chunk(videoIds, VIDEO_STATS_BATCH_SIZE);
      if (batches.length > 0) {
        await deps.quota.charge("videos.list", batches.length);
      }
      const stats: YtVideoStats[] = [];
      for (const batch of batches) {
        stats.push(...(await deps.youtube.getVideoStats(batch)));
      }
      ctx.videos = stats;
    },
    async snapshot_stats(input) {
      const yt = ctx.yt;
      const videos = ctx.videos;
      if (yt === undefined || videos === undefined) {
        throw new Error("earlier sync stages did not run");
      }
      const capturedAt = now();
      const medianViews90d = computeMedianViews90d(videos, capturedAt);
      ctx.snapshotMedian = medianViews90d;
      // The creator's own uploads, for Intel (own-channel stats). Same fetch,
      // now persisted; invalid publish dates are dropped rather than faked.
      await deps.channelRepo.upsertChannelVideos(
        input.workspaceId,
        input.channelId,
        videos.flatMap((v) => {
          const publishedAt = new Date(v.publishedAt);
          if (Number.isNaN(publishedAt.getTime())) return [];
          return [
            {
              youtubeVideoId: v.youtubeVideoId,
              title: v.title,
              thumbnailUrl: v.thumbnailUrl,
              publishedAt,
              durationSeconds: v.durationSeconds,
              viewCount: v.viewCount,
              likeCount: v.likeCount,
              commentCount: v.commentCount,
            },
          ];
        }),
        capturedAt,
      );
      await deps.channelRepo.insertSnapshot({
        workspaceId: input.workspaceId,
        channelId: input.channelId,
        capturedAt,
        subs: yt.subs,
        totalViews: yt.totalViews,
        medianViews90d,
      });
      await deps.channelRepo.update(input.workspaceId, input.channelId, {
        title: yt.title,
        handle: yt.handle,
        syncStatus: "synced",
        lastSyncedAt: capturedAt,
      });
    },
  };

  return {
    kind: SYNC_STORE_KIND,
    stages: SYNC_STAGES.map((name) => ({ name, run: stages[name] })),
  };
}

/**
 * Run a full channel sync. Validates input, marks the channel `syncing`,
 * executes the three stages through PipelineRunner, and marks the channel
 * `synced`/`failed`. Returns the schema-validated SyncResult.
 *
 * @throws when the channel is missing in the workspace or a stage exhausts
 *         its retries (the worker lets BullMQ's safety-net retry kick in).
 */
export async function runChannelSync(deps: SyncDeps, rawInput: unknown): Promise<SyncResult> {
  const input = syncJobInputSchema.parse(rawInput);
  const channel = await deps.channelRepo.get(input.workspaceId, input.channelId);
  if (channel === null) {
    throw new Error(`channel ${input.channelId} not found in workspace ${input.workspaceId}`);
  }

  await deps.channelRepo.update(input.workspaceId, input.channelId, { syncStatus: "syncing" });

  // oauth-mode channels sync as the channel owner via their stored refresh
  // token; the resolver falls back to the public provider on any failure.
  const youtube =
    deps.resolveYoutube !== undefined ? await deps.resolveYoutube(channel) : deps.youtube;

  const ctx: SyncRunContext = { channel };
  const runner = new PipelineRunner(deps.runStore ?? new InMemoryPipelineRunStore());
  const result = await runner.execute(buildSyncPipeline({ ...deps, youtube }, ctx), {
    workspaceId: input.workspaceId,
    projectId: null,
    input,
  });

  if (result.status === "failed") {
    await deps.channelRepo.update(input.workspaceId, input.channelId, { syncStatus: "failed" });
    logger.error(
      { channelId: input.channelId, stage: result.stage, error: result.error },
      "channel sync failed",
    );
    throw new Error(`channel sync failed at ${result.stage}: ${result.error}`);
  }

  const yt = ctx.yt;
  const videos = ctx.videos ?? [];
  if (yt === undefined) throw new Error("sync completed without channel data");

  return syncResultSchema.parse({
    channelId: input.channelId,
    subs: yt.subs,
    totalViews: yt.totalViews,
    medianViews90d: ctx.snapshotMedian ?? 0,
    videos: videos.map((v) => ({
      youtubeVideoId: v.youtubeVideoId,
      title: v.title,
      publishedAt: v.publishedAt,
      viewCount: v.viewCount,
      likeCount: v.likeCount,
      commentCount: v.commentCount,
      durationSeconds: v.durationSeconds,
    })),
  });
}
