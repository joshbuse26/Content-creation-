import { z } from "zod";
import type { YoutubeProvider } from "@/lib/providers/types";
import type { ChannelRepo, TrackingRepo } from "@/server/channel/repo";
import { logger } from "@/lib/logger";
import { chunk } from "./pipeline";
import type { QuotaTracker } from "./quota";

/**
 * §5.12 Post-publish tracking (nightly, queue: sync, job:
 * post-publish-tracking): for every project with a published_video_id, pull
 * current stats via batched videos.list (50 ids/call = 1 unit) and upsert
 * them into niche_videos keyed by youtube_video_id — the shared stats store
 * the dashboard's projected-vs-actual view reads from
 * (projects.published_video_id → niche_videos.youtube_video_id).
 *
 * Never stores third-party media — metadata and counts only (spec §0).
 */

export const trackingSweepInputSchema = z.object({ sweep: z.literal(true) });

const VIDEO_STATS_BATCH_SIZE = 50;

export interface TrackingDeps {
  trackingRepo: TrackingRepo;
  channelRepo: ChannelRepo;
  youtube: YoutubeProvider;
  quota: QuotaTracker;
  now?: () => Date;
}

export interface TrackingRunSummary {
  projectsScanned: number;
  videosTracked: number;
}

export async function runPostPublishTracking(deps: TrackingDeps): Promise<TrackingRunSummary> {
  const projects = await deps.trackingRepo.listPublishedProjects();
  if (projects.length === 0) {
    return { projectsScanned: 0, videosTracked: 0 };
  }

  const videoIds = [...new Set(projects.map((p) => p.publishedVideoId))];
  const batches = chunk(videoIds, VIDEO_STATS_BATCH_SIZE);
  await deps.quota.charge("videos.list", batches.length);

  const statsById = new Map<
    string,
    Awaited<ReturnType<YoutubeProvider["getVideoStats"]>>[number]
  >();
  for (const batch of batches) {
    for (const stat of await deps.youtube.getVideoStats(batch)) {
      statsById.set(stat.youtubeVideoId, stat);
    }
  }

  // Median lookup per (workspace, channel) — one snapshot read per channel.
  const medianCache = new Map<string, number>();
  const medianFor = async (workspaceId: string, channelId: string): Promise<number> => {
    const key = `${workspaceId}:${channelId}`;
    const cached = medianCache.get(key);
    if (cached !== undefined) return cached;
    const project = projects.find(
      (p) => p.workspaceId === workspaceId && p.channelId === channelId,
    );
    if (project === undefined) return 0;
    const snapshot = await deps.channelRepo.latestSnapshot(project.workspaceId, project.channelId);
    const median = snapshot?.medianViews90d ?? 0;
    medianCache.set(key, median);
    return median;
  };

  const rows = [];
  for (const project of projects) {
    const stat = statsById.get(project.publishedVideoId);
    if (stat === undefined) {
      logger.warn(
        { projectId: project.projectId, videoId: project.publishedVideoId },
        "post-publish tracking: video stats unavailable",
      );
      continue;
    }
    const median = await medianFor(project.workspaceId, project.channelId);
    rows.push({
      youtubeVideoId: stat.youtubeVideoId,
      channelYtid: stat.channelYtid,
      title: stat.title,
      thumbnailUrl: stat.thumbnailUrl,
      publishedAt: new Date(stat.publishedAt),
      viewCount: stat.viewCount,
      channelMedianViews: median,
      outlierRatio: median > 0 ? Math.round((stat.viewCount / median) * 100) / 100 : 0,
    });
  }

  await deps.trackingRepo.upsertVideoStats(rows);
  logger.info(
    { projects: projects.length, tracked: rows.length },
    "post-publish tracking complete",
  );
  return { projectsScanned: projects.length, videosTracked: rows.length };
}
