import { z } from "zod";
import { LLM_MODELS } from "@/lib/config";
import { logger } from "@/lib/logger";
import type { YtSearchResult, YtVideoStats } from "@/lib/providers/types";
import { OUTLIER_STAGES, outlierJobInputSchema } from "@/lib/types/pipeline";
import { generateJson } from "@/pipelines/script/llm-json";
import { chunk, computeMedianViews90d } from "@/pipelines/sync/pipeline";
import { QuotaExceededError } from "@/pipelines/sync/quota";
import { InMemoryPipelineRunStore, PipelineRunner } from "@/queue/pipeline-runner";
import {
  MEDIAN_CACHE_TTL_SECONDS,
  SEARCH_CACHE_TTL_SECONDS,
  medianCacheKey,
  searchCacheKey,
} from "./cache";
import type { IdeationDeps } from "./deps";
import { synthFormatTags } from "./fixture-content";
import { formatTagsPrompt, ideationStageHash } from "./prompts";
import { normalizeKeywordSet } from "./similarity";
import type { UpsertNicheVideo } from "./store";

/**
 * §5.3 Outlier index (queue: sync, job: outlier-refresh) — nightly per
 * niche keyword set.
 *
 * search.list per keyword (100u, ≤6/run — the frozen outlierJobInputSchema
 * caps keywords at 6) → batched videos.list stats → competitor channel
 * medians (cached 7d) → outlier_ratio = views / channel median → keep
 * ratio ≥ 3 → Haiku-tier format tags → upsert niche_videos.
 *
 * Quota discipline (spec §8):
 * - search results cached 24h keyed by NORMALIZED query — channels sharing
 *   a niche share searches (the sweep also dedupes identical keyword sets);
 * - every YouTube call charges the shared circuit breaker BEFORE it runs;
 *   when the breaker trips mid-run the stage DEGRADES to cached data
 *   (summary.degraded = true) instead of failing the run.
 *
 * Runs are GLOBAL (niche_videos has no workspace) — pipeline_runs.workspace_id
 * is a workspaces FK, so these runs use an in-memory run store for the
 * runner's sequencing/retry mechanics only (same precedent as the original
 * sync pipeline; see REQUESTS-B1.md).
 */

export const OUTLIER_RATIO_THRESHOLD = 3;
/** Look-back window for the niche search (fresh outliers only). */
export const SEARCH_WINDOW_DAYS = 90;
/** Cap on videos sent to the format-tagging LLM call per run. */
const MAX_TAGGED_PER_RUN = 30;
const VIDEO_STATS_BATCH_SIZE = 50;
/** Synthetic key for global runs in the (in-memory) run store. */
const GLOBAL_RUN_WORKSPACE = "global";

const cachedSearchResultsSchema = z.array(
  z.object({
    youtubeVideoId: z.string(),
    channelYtid: z.string(),
    title: z.string(),
    publishedAt: z.string(),
    thumbnailUrl: z.string().nullable(),
  }),
);

const cachedMedianSchema = z.object({
  median: z.number().int().nonnegative(),
  computedAt: z.string(),
});

const formatTagsOutputSchema = z.object({
  videos: z.array(
    z.object({
      youtubeVideoId: z.string(),
      tags: z.array(z.string().min(1).max(30)).min(1).max(4),
    }),
  ),
});

export interface OutlierRefreshSummary {
  keywords: string[];
  searchesPerformed: number;
  searchCacheHits: number;
  candidates: number;
  kept: number;
  /** True when the quota breaker forced a fall-back to cached data. */
  degraded: boolean;
}

interface SearchHit {
  result: YtSearchResult;
  keywords: Set<string>;
}

interface Candidate {
  stats: YtVideoStats;
  median: number;
  ratio: number;
  keywords: string[];
}

interface RunState {
  hits: Map<string, SearchHit>;
  candidates: Candidate[];
  searchesPerformed: number;
  searchCacheHits: number;
  degraded: boolean;
}

async function searchStage(deps: IdeationDeps, keywords: string[], state: RunState): Promise<void> {
  const publishedAfterIso = new Date(
    deps.now().getTime() - SEARCH_WINDOW_DAYS * 86_400_000,
  ).toISOString();
  for (const keyword of keywords) {
    const key = searchCacheKey(keyword);
    let results = await deps.cache.get(key, (raw) => cachedSearchResultsSchema.parse(raw));
    if (results !== null) {
      state.searchCacheHits += 1;
    } else {
      try {
        await deps.quota.charge("search.list");
      } catch (err) {
        if (err instanceof QuotaExceededError) {
          state.degraded = true;
          logger.warn({ keyword }, "outlier refresh: quota breaker tripped, skipping search");
          continue;
        }
        throw err;
      }
      results = await deps.youtube.searchVideos(keyword, publishedAfterIso);
      state.searchesPerformed += 1;
      await deps.cache.set(key, results, SEARCH_CACHE_TTL_SECONDS);
    }
    for (const result of results) {
      const hit = state.hits.get(result.youtubeVideoId);
      if (hit !== undefined) {
        hit.keywords.add(keyword);
      } else {
        state.hits.set(result.youtubeVideoId, { result, keywords: new Set([keyword]) });
      }
    }
  }
}

/**
 * Median 90-day views of a competitor channel's recent uploads — 3 quota
 * units on a cache miss, cached 7 days. Returns null when the breaker
 * refuses the spend.
 */
async function channelMedian(deps: IdeationDeps, channelYtid: string): Promise<number | null> {
  const key = medianCacheKey(channelYtid);
  const cached = await deps.cache.get(key, (raw) => cachedMedianSchema.parse(raw));
  if (cached !== null) return cached.median;
  try {
    await deps.quota.charge("channels.list");
    const channel = await deps.youtube.getChannel(channelYtid);
    await deps.quota.charge("playlistItems.list");
    const recentIds = await deps.youtube.listRecentVideoIds(channel.uploadsPlaylistId, 50);
    const batches = chunk(recentIds, VIDEO_STATS_BATCH_SIZE);
    if (batches.length > 0) await deps.quota.charge("videos.list", batches.length);
    const stats: YtVideoStats[] = [];
    for (const batch of batches) {
      stats.push(...(await deps.youtube.getVideoStats(batch)));
    }
    const median = computeMedianViews90d(stats, deps.now());
    await deps.cache.set(
      key,
      { median, computedAt: deps.now().toISOString() },
      MEDIAN_CACHE_TTL_SECONDS,
    );
    return median;
  } catch (err) {
    if (err instanceof QuotaExceededError) return null;
    throw err;
  }
}

/** views / channel median; null when the median is unusable (0 uploads). */
export function computeOutlierRatio(viewCount: number, channelMedianViews: number): number | null {
  if (channelMedianViews <= 0) return null;
  return Math.round((viewCount / channelMedianViews) * 100) / 100;
}

async function statsStage(deps: IdeationDeps, state: RunState): Promise<void> {
  const ids = [...state.hits.keys()].sort();
  if (ids.length === 0) return;

  const batches = chunk(ids, VIDEO_STATS_BATCH_SIZE);
  const stats: YtVideoStats[] = [];
  for (const batch of batches) {
    try {
      await deps.quota.charge("videos.list");
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        state.degraded = true;
        logger.warn({}, "outlier refresh: quota breaker tripped, stats fetch truncated");
        break;
      }
      throw err;
    }
    stats.push(...(await deps.youtube.getVideoStats(batch)));
  }

  const medians = new Map<string, number | null>();
  for (const video of stats) {
    let median = medians.get(video.channelYtid);
    if (median === undefined) {
      median = await channelMedian(deps, video.channelYtid);
      if (median === null) state.degraded = true;
      medians.set(video.channelYtid, median);
    }
    if (median === null) continue;
    const ratio = computeOutlierRatio(video.viewCount, median);
    if (ratio === null || ratio < OUTLIER_RATIO_THRESHOLD) continue;
    const keywords = state.hits.get(video.youtubeVideoId)?.keywords ?? new Set<string>();
    state.candidates.push({ stats: video, median, ratio, keywords: [...keywords].sort() });
  }
  state.candidates.sort((a, b) => b.ratio - a.ratio);
}

async function tagStage(deps: IdeationDeps, state: RunState): Promise<void> {
  const candidates = state.candidates.slice(0, MAX_TAGGED_PER_RUN);
  if (candidates.length === 0) return;

  const tagged = await generateJson({
    mode: deps.mode,
    llm: deps.llm,
    model: LLM_MODELS.haiku,
    template: formatTagsPrompt({
      videos: candidates.map((c) => ({
        youtubeVideoId: c.stats.youtubeVideoId,
        title: c.stats.title,
      })),
    }),
    maxTokens: 1500,
    temperature: 0,
    schema: formatTagsOutputSchema,
    fixture: () => ({
      videos: candidates.map((c) => ({
        youtubeVideoId: c.stats.youtubeVideoId,
        tags: synthFormatTags(c.stats.title),
      })),
    }),
  });
  const tagsById = new Map(tagged.videos.map((v) => [v.youtubeVideoId, v.tags]));

  const now = deps.now();
  const rows: UpsertNicheVideo[] = candidates.map((c) => ({
    youtubeVideoId: c.stats.youtubeVideoId,
    channelYtid: c.stats.channelYtid,
    title: c.stats.title,
    thumbnailUrl: c.stats.thumbnailUrl,
    publishedAt: new Date(c.stats.publishedAt),
    viewCount: c.stats.viewCount,
    channelMedianViews: c.median,
    outlierRatio: c.ratio,
    formatTags: tagsById.get(c.stats.youtubeVideoId) ?? ["essay"],
    nicheKeywords: c.keywords,
    lastRefreshedAt: now,
  }));
  await deps.store.upsertNicheVideos(rows);
}

/**
 * Run one outlier refresh for a niche keyword set. Validates input against
 * the frozen outlierJobInputSchema; throws when a stage exhausts its
 * retries (BullMQ's job-level safety net takes over).
 */
export async function runOutlierRefresh(
  deps: IdeationDeps,
  rawInput: unknown,
): Promise<OutlierRefreshSummary> {
  const input = outlierJobInputSchema.parse(rawInput);
  const keywords = normalizeKeywordSet(input.nicheKeywords);
  const state: RunState = {
    hits: new Map(),
    candidates: [],
    searchesPerformed: 0,
    searchCacheHits: 0,
    degraded: false,
  };

  const stageBodies: Record<(typeof OUTLIER_STAGES)[number], () => Promise<void>> = {
    search_niche: () => searchStage(deps, keywords, state),
    fetch_stats: () => statsStage(deps, state),
    tag_formats: () => tagStage(deps, state),
  };

  const runner = new PipelineRunner(new InMemoryPipelineRunStore());
  const result = await runner.execute(
    {
      kind: "ideas",
      stages: OUTLIER_STAGES.map((name) => ({ name, run: () => stageBodies[name]() })),
    },
    {
      workspaceId: GLOBAL_RUN_WORKSPACE,
      projectId: null,
      input,
      inputHash: ideationStageHash({ keywords, day: deps.now().toISOString().slice(0, 10) }),
    },
  );
  if (result.status === "failed") {
    throw new Error(`outlier refresh failed at ${result.stage}: ${result.error}`);
  }

  const summary: OutlierRefreshSummary = {
    keywords,
    searchesPerformed: state.searchesPerformed,
    searchCacheHits: state.searchCacheHits,
    candidates: state.hits.size,
    kept: state.candidates.length,
    degraded: state.degraded,
  };
  logger.info(summary, "outlier refresh complete");
  return summary;
}
