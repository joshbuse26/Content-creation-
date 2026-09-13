import type { NicheVideo } from "@/lib/types/entities";

/**
 * Outlier enrichment math (Wave-D E3) — PURE, DETERMINISTIC signals computed
 * entirely from the niche_videos columns the outlier index already stores
 * (viewCount, channelMedianViews, publishedAt, formatTags, nicheKeywords).
 * No provider read, no LLM, no new paid API — so the same function runs in the
 * discovery client, in the server, and in unit tests with identical results.
 *
 * These turn a bare outlier row into the signals a creator reads when
 * validating a concept before writing: how far it beat its channel's baseline
 * (view multiple), how fast it is accruing views (velocity), and how fresh it
 * is (recency band).
 */

export type RecencyBand = "this_week" | "this_month" | "older";

export interface OutlierEnrichment {
  /** views ÷ channel median — the "N× channel median" multiple; null when the
   *  median is unusable (0 uploads). Rounded to 2 decimals. */
  viewMultiple: number | null;
  /** Whole days between publish and `now` (>= 0; 0 for same-day). */
  daysSincePublished: number;
  /** views ÷ days-since-publish (floored at 1 day) — a momentum signal. */
  viewsPerDay: number;
  recency: RecencyBand;
  formatTags: string[];
  nicheKeywords: string[];
}

const MS_PER_DAY = 86_400_000;

/** Whole days between `publishedAt` and `now`, never negative. */
export function daysSincePublished(publishedAt: Date, now: Date): number {
  const diff = now.getTime() - publishedAt.getTime();
  return Math.max(0, Math.floor(diff / MS_PER_DAY));
}

/** views ÷ channel median, 2 decimals; null when the median is <= 0. */
export function computeViewMultiple(viewCount: number, channelMedianViews: number): number | null {
  if (channelMedianViews <= 0) return null;
  return Math.round((viewCount / channelMedianViews) * 100) / 100;
}

/**
 * views ÷ days-since-publish, floored at 1 day so a same-day upload does not
 * divide by zero (its velocity is simply its full view count). Integer/day.
 */
export function computeViewsPerDay(viewCount: number, publishedAt: Date, now: Date): number {
  const days = Math.max(1, daysSincePublished(publishedAt, now));
  return Math.round(viewCount / days);
}

/** this week (<= 7d) / this month (<= 31d) / older. */
export function recencyBand(publishedAt: Date, now: Date): RecencyBand {
  const days = daysSincePublished(publishedAt, now);
  if (days <= 7) return "this_week";
  if (days <= 31) return "this_month";
  return "older";
}

/** Enrich one outlier row with every deterministic signal. */
export function enrichOutlier(video: NicheVideo, now: Date): OutlierEnrichment {
  return {
    viewMultiple: computeViewMultiple(video.viewCount, video.channelMedianViews),
    daysSincePublished: daysSincePublished(video.publishedAt, now),
    viewsPerDay: computeViewsPerDay(video.viewCount, video.publishedAt, now),
    recency: recencyBand(video.publishedAt, now),
    formatTags: video.formatTags,
    nicheKeywords: video.nicheKeywords,
  };
}

/** Human label for a view multiple, e.g. "6.2× channel median". */
export function viewMultipleLabel(multiple: number): string {
  return `${multiple.toFixed(1)}× channel median`;
}

/** Compact human label for a velocity, e.g. "12.4K views/day". */
export function viewsPerDayLabel(viewsPerDay: number): string {
  const compact =
    viewsPerDay >= 1_000_000
      ? `${(viewsPerDay / 1_000_000).toFixed(1)}M`
      : viewsPerDay >= 1_000
        ? `${(viewsPerDay / 1_000).toFixed(1)}K`
        : String(viewsPerDay);
  return `${compact} views/day`;
}

/** Badge/label copy for a recency band. */
export function recencyLabel(band: RecencyBand): string {
  if (band === "this_week") return "This week";
  if (band === "this_month") return "This month";
  return "Older";
}
