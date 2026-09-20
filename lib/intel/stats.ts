import { z } from "zod";
import { channelSchema, channelVideoSchema } from "@/lib/types/entities";
import type { Channel, ChannelStatsSnapshot, ChannelVideo } from "@/lib/types/entities";

/**
 * Intel = the creator's OWN channel, in plain English, from data we actually
 * hold. Pure and deterministic: every number here is derived from the
 * channel's synced uploads (YouTube Data API v3 `videos.list` fields) and its
 * stats snapshots. Nothing is estimated or invented.
 *
 * What the Data API does NOT give us — watch time, average view duration,
 * impressions, click-through rate, subscribers gained per video — needs the
 * YouTube Analytics API under an owner's OAuth grant. Those are reported as
 * unavailable with the reason, never as numbers. Revenue metrics (RPM/CPM/
 * "CPA") need the monetary scope on a monetized channel and are out of scope.
 */

export const INTEL_VERDICTS = ["strong", "typical", "weak", "too_early"] as const;
export type IntelVerdict = (typeof INTEL_VERDICTS)[number];

export const DURATION_BANDS = ["short", "mid", "long"] as const;
export type DurationBand = (typeof DURATION_BANDS)[number];

/** Views at/above this multiple of the channel median read as strong. */
export const STRONG_RATIO = 1.5;
/** Views at/below this multiple read as weak. */
export const WEAK_RATIO = 0.6;
/** A video younger than this has not had its chance yet. */
export const TOO_EARLY_DAYS = 3;
const DAY_MS = 86_400_000;

export const intelVideoSchema = channelVideoSchema.extend({
  /** Views ÷ the channel's median views across its synced uploads. */
  vsMedian: z.number().nonnegative(),
  viewsPerDay: z.number().nonnegative(),
  /** likes ÷ views, or null when likes are hidden. */
  likeRate: z.number().nonnegative().nullable(),
  commentRate: z.number().nonnegative().nullable(),
  band: z.enum(DURATION_BANDS),
  verdict: z.enum(INTEL_VERDICTS),
});
export type IntelVideo = z.infer<typeof intelVideoSchema>;

export const intelPeriodSchema = z.object({
  label: z.string(),
  days: z.number().int().positive().nullable(),
  videos: z.number().int().nonnegative(),
  views: z.number().int().nonnegative(),
  avgViews: z.number().nonnegative(),
});
export type IntelPeriod = z.infer<typeof intelPeriodSchema>;

export const intelDeltaSchema = z.object({
  value: z.number().int(),
  sinceDays: z.number().nonnegative(),
});

/** Analytics-API-only metrics, reported honestly as unavailable. */
export const ANALYTICS_ONLY_FIELDS = [
  { key: "watchTime", label: "Watch time" },
  { key: "avgViewDuration", label: "Average view duration" },
  { key: "impressions", label: "Impressions" },
  { key: "ctr", label: "Impressions click-through rate" },
  { key: "subsPerVideo", label: "Subscribers gained per video" },
] as const;

export const intelOverviewSchema = z.object({
  channel: channelSchema,
  syncedAt: z.date().nullable(),
  /** One human sentence before any number. */
  headline: z.string(),
  kpis: z.object({
    subs: z.number().int().nonnegative().nullable(),
    subsDelta: intelDeltaSchema.nullable(),
    totalViews: z.number().int().nonnegative().nullable(),
    totalViewsDelta: intelDeltaSchema.nullable(),
    medianViews: z.number().int().nonnegative(),
    avgViews: z.number().nonnegative(),
    uploadsLast30d: z.number().int().nonnegative(),
    avgLikeRate: z.number().nonnegative().nullable(),
    avgCommentRate: z.number().nonnegative().nullable(),
  }),
  periods: z.array(intelPeriodSchema),
  byBand: z.array(
    z.object({
      band: z.enum(DURATION_BANDS),
      label: z.string(),
      videos: z.number().int().nonnegative(),
      avgViews: z.number().nonnegative(),
    }),
  ),
  videos: z.array(intelVideoSchema),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  analytics: z.object({
    available: z.literal(false),
    reason: z.string(),
    fields: z.array(z.object({ key: z.string(), label: z.string() })),
  }),
});
export type IntelOverview = z.infer<typeof intelOverviewSchema>;

// ---------------------------------------------------------------------------

export function durationBand(seconds: number): DurationBand {
  if (seconds < 8 * 60) return "short";
  if (seconds <= 15 * 60) return "mid";
  return "long";
}

const BAND_LABEL: Record<DurationBand, string> = {
  short: "under 8 min",
  mid: "8–15 min",
  long: "over 15 min",
};

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return Math.floor(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function rate(part: number | null, whole: number): number | null {
  if (part === null || whole <= 0) return null;
  return part / whole;
}

export function verdictFor(vsMedian: number, ageDays: number): IntelVerdict {
  if (ageDays < TOO_EARLY_DAYS && vsMedian < STRONG_RATIO) return "too_early";
  if (vsMedian >= STRONG_RATIO) return "strong";
  if (vsMedian <= WEAK_RATIO) return "weak";
  return "typical";
}

function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(Math.round(n));
}

function fmtRatio(r: number): string {
  return `${r.toFixed(1)}×`;
}

function periodOf(
  label: string,
  days: number | null,
  videos: readonly IntelVideo[],
  now: Date,
): IntelPeriod {
  const cutoff = days === null ? Number.NEGATIVE_INFINITY : now.getTime() - days * DAY_MS;
  const inPeriod = videos.filter((v) => v.publishedAt.getTime() >= cutoff);
  const views = inPeriod.reduce((sum, v) => sum + v.viewCount, 0);
  return {
    label,
    days,
    videos: inPeriod.length,
    views,
    avgViews: mean(inPeriod.map((v) => v.viewCount)),
  };
}

function deltaBetween(
  latest: ChannelStatsSnapshot | undefined,
  earlier: ChannelStatsSnapshot | undefined,
  pick: (s: ChannelStatsSnapshot) => number,
): z.infer<typeof intelDeltaSchema> | null {
  if (latest === undefined || earlier === undefined || latest.id === earlier.id) return null;
  return {
    value: pick(latest) - pick(earlier),
    sinceDays: Math.max(0, (latest.capturedAt.getTime() - earlier.capturedAt.getTime()) / DAY_MS),
  };
}

/**
 * Build the Intel overview. `snapshots` newest first. Deterministic for a
 * given `now`.
 */
export function buildIntelOverview(input: {
  channel: Channel;
  videos: readonly ChannelVideo[];
  snapshots: readonly ChannelStatsSnapshot[];
  now: Date;
}): IntelOverview {
  const { channel, snapshots, now } = input;
  const medianViews = median(input.videos.map((v) => v.viewCount));

  const videos: IntelVideo[] = [...input.videos]
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
    .map((v) => {
      const ageDays = Math.max(0, (now.getTime() - v.publishedAt.getTime()) / DAY_MS);
      const vsMedian = medianViews > 0 ? v.viewCount / medianViews : 0;
      return {
        ...v,
        vsMedian,
        viewsPerDay: v.viewCount / Math.max(ageDays, 1),
        likeRate: rate(v.likeCount, v.viewCount),
        commentRate: rate(v.commentCount, v.viewCount),
        band: durationBand(v.durationSeconds),
        verdict: verdictFor(vsMedian, ageDays),
      };
    });

  const latest = snapshots[0];
  // The earliest snapshot within ~30 days gives a period delta; else the
  // oldest we have.
  const cutoff = now.getTime() - 30 * DAY_MS;
  const within = snapshots.filter((s) => s.capturedAt.getTime() >= cutoff);
  const deltaWindow = within.length >= 2 ? within : snapshots;
  const earlier = deltaWindow[deltaWindow.length - 1];

  const judged = videos.filter((v) => v.verdict !== "too_early");
  const strong = judged
    .filter((v) => v.verdict === "strong")
    .sort((a, b) => b.vsMedian - a.vsMedian);
  const weak = judged.filter((v) => v.verdict === "weak").sort((a, b) => a.vsMedian - b.vsMedian);

  const byBand = DURATION_BANDS.map((band) => {
    const inBand = videos.filter((v) => v.band === band);
    return {
      band,
      label: BAND_LABEL[band],
      videos: inBand.length,
      avgViews: mean(inBand.map((v) => v.viewCount)),
    };
  });

  const uploadsLast30d = videos.filter((v) => v.publishedAt.getTime() >= cutoff).length;
  const likeRates = videos.flatMap((v) => (v.likeRate === null ? [] : [v.likeRate]));
  const commentRates = videos.flatMap((v) => (v.commentRate === null ? [] : [v.commentRate]));

  const strengths: string[] = [];
  const weaknesses: string[] = [];

  const top = strong[0];
  if (top !== undefined) {
    strengths.push(
      `“${top.title}” did ${fmtRatio(top.vsMedian)} your median (${fmtCount(top.viewCount)} views) — your clearest recent win.`,
    );
  }
  const bottom = weak[0];
  if (bottom !== undefined) {
    weaknesses.push(
      `“${bottom.title}” landed at ${fmtRatio(bottom.vsMedian)} your median (${fmtCount(bottom.viewCount)} views) — below your usual.`,
    );
  }

  // Length band: only a call when two bands each have at least two videos.
  const bandsWithData = byBand.filter((b) => b.videos >= 2).sort((a, b) => b.avgViews - a.avgViews);
  const bestBand = bandsWithData[0];
  const worstBand = bandsWithData[bandsWithData.length - 1];
  if (bestBand !== undefined && worstBand !== undefined && bestBand.band !== worstBand.band) {
    strengths.push(
      `Videos ${bestBand.label} average ${fmtCount(bestBand.avgViews)} views — ${fmtRatio(
        worstBand.avgViews > 0 ? bestBand.avgViews / worstBand.avgViews : 0,
      )} what your ${worstBand.label} videos get.`,
    );
    if (worstBand.avgViews > 0 && bestBand.avgViews / worstBand.avgViews >= STRONG_RATIO) {
      weaknesses.push(
        `Your ${worstBand.label} videos are your weakest length — consider fewer of them.`,
      );
    }
  }

  if (videos.length > 0) {
    if (uploadsLast30d === 0) {
      weaknesses.push("No uploads in the last 30 days — the channel has gone quiet.");
    } else {
      strengths.push(
        `${String(uploadsLast30d)} upload${uploadsLast30d === 1 ? "" : "s"} in the last 30 days — about one every ${String(Math.max(1, Math.round(30 / uploadsLast30d)))} days.`,
      );
    }
  }

  const avgLikeRate = likeRates.length > 0 ? mean(likeRates) : null;
  if (
    avgLikeRate !== null &&
    top !== undefined &&
    top.likeRate !== null &&
    top.likeRate > avgLikeRate * 1.2
  ) {
    strengths.push(
      `Your top video also has your best like rate (${(top.likeRate * 100).toFixed(1)}%) — the audience agreed with the algorithm.`,
    );
  }

  const subsDelta = deltaBetween(latest, earlier, (s) => s.subs);
  if (subsDelta !== null && subsDelta.value !== 0) {
    (subsDelta.value > 0 ? strengths : weaknesses).push(
      `${subsDelta.value > 0 ? "+" : ""}${fmtCount(subsDelta.value)} subscribers over the last ${String(Math.max(1, Math.round(subsDelta.sinceDays)))} days.`,
    );
  }

  const headline =
    videos.length === 0
      ? `${channel.title} has no synced uploads yet — run a sync to see how your videos are doing.`
      : top !== undefined
        ? `${channel.title}: your median video gets ${fmtCount(medianViews)} views, and “${top.title}” blew past it at ${fmtRatio(top.vsMedian)}.`
        : `${channel.title}: your median video gets ${fmtCount(medianViews)} views — steady, no breakout yet.`;

  return intelOverviewSchema.parse({
    channel,
    syncedAt: channel.lastSyncedAt,
    headline,
    kpis: {
      subs: latest?.subs ?? null,
      subsDelta,
      totalViews: latest?.totalViews ?? null,
      totalViewsDelta: deltaBetween(latest, earlier, (s) => s.totalViews),
      medianViews,
      avgViews: mean(videos.map((v) => v.viewCount)),
      uploadsLast30d,
      avgLikeRate,
      avgCommentRate: commentRates.length > 0 ? mean(commentRates) : null,
    },
    periods: [
      periodOf("Last 30 days", 30, videos, now),
      periodOf("Last 90 days", 90, videos, now),
      periodOf("All synced", null, videos, now),
    ],
    byBand,
    videos,
    strengths,
    weaknesses,
    analytics: {
      available: false,
      reason:
        channel.mode === "oauth"
          ? "Your Google connection grants read access to public stats only; watch time, impressions and click-through need YouTube Analytics access, which is not enabled yet."
          : "Watch time, impressions and click-through are only available to the channel owner through YouTube Analytics — connect with Google to unlock them when that access is enabled.",
      fields: ANALYTICS_ONLY_FIELDS.map((f) => ({ key: f.key, label: f.label })),
    },
  });
}
