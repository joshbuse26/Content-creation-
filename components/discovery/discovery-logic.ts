import type { BadgeTone } from "@/components/ui/badge";
import type {
  DemandLevel,
  DemandSignal,
  Idea,
  NicheVideo,
  WhyItWorked,
} from "@/lib/types/entities";
import {
  enrichOutlier,
  recencyLabel,
  viewMultipleLabel,
  viewsPerDayLabel,
  type OutlierEnrichment,
} from "@/pipelines/ideation/enrich";

/**
 * Pure logic for the pre-write discovery surface (Wave-D D3) — kept out of the
 * screen component so niche filtering, outlier enrichment and demand lookup are
 * unit-testable without a DOM. The surface FRONTS existing data (the ideas feed
 * + the outlier index + the search-demand signal); none of the ranking or
 * generation logic is reimplemented here.
 */

/** Index the outlier rows by their YouTube video id (idea evidence ⇒ outlier). */
export function indexOutliers(outliers: readonly NicheVideo[]): Map<string, NicheVideo> {
  return new Map(outliers.map((o) => [o.youtubeVideoId, o]));
}

/**
 * The strongest performance signal behind an idea: the max outlier ratio among
 * its evidence videos that we have index rows for. null when none are known
 * (e.g. the outlier index hasn't been fronted yet).
 */
export function ideaOutlierRatio(idea: Idea, index: Map<string, NicheVideo>): number | null {
  let best: number | null = null;
  for (const videoId of idea.evidenceVideoIds) {
    const outlier = index.get(videoId);
    if (outlier === undefined) continue;
    if (best === null || outlier.outlierRatio > best) best = outlier.outlierRatio;
  }
  return best;
}

/** "10.8× channel median" style label for an outlier ratio. */
export function ratioLabel(ratio: number): string {
  return `${ratio.toFixed(1)}× channel median`;
}

/**
 * Whether an idea belongs to the selected niche keyword: true when no filter is
 * active, otherwise true if any of its evidence outliers carries the keyword.
 */
export function ideaMatchesNiche(
  idea: Idea,
  keyword: string | null,
  index: Map<string, NicheVideo>,
): boolean {
  if (keyword === null) return true;
  return idea.evidenceVideoIds.some((videoId) => {
    const outlier = index.get(videoId);
    return outlier !== undefined && outlier.nicheKeywords.includes(keyword);
  });
}

/** Distinct idea titles to request demand signals for (bounded by the API). */
export function demandTopics(ideas: readonly Idea[], limit = 20): string[] {
  const seen = new Set<string>();
  const topics: string[] = [];
  for (const idea of ideas) {
    if (seen.has(idea.title)) continue;
    seen.add(idea.title);
    topics.push(idea.title);
    if (topics.length >= limit) break;
  }
  return topics;
}

/** Look demand signals up by topic string (the exact title that was queried). */
export function demandByTopic(signals: readonly DemandSignal[]): Map<string, DemandSignal> {
  return new Map(signals.map((s) => [s.topic, s]));
}

export function demandTone(level: DemandLevel): BadgeTone {
  if (level === "high") return "emerald";
  if (level === "moderate") return "blue";
  return "neutral";
}

export function demandLabel(level: DemandLevel): string {
  if (level === "high") return "High demand";
  if (level === "moderate") return "Steady demand";
  return "Low demand";
}

// ---------------------------------------------------------------------------
// E3 enrichment + "why it worked" lookup (re-uses the pure enrich math)
// ---------------------------------------------------------------------------

export { enrichOutlier, recencyLabel, viewMultipleLabel, viewsPerDayLabel };
export type { OutlierEnrichment };

/** Look "why it worked" blurbs up by video id. */
export function whyByVideo(rows: readonly WhyItWorked[]): Map<string, string> {
  return new Map(rows.map((r) => [r.youtubeVideoId, r.blurb]));
}

/** The strongest evidence outlier behind an idea (max ratio we have a row for). */
export function bestEvidenceOutlier(idea: Idea, index: Map<string, NicheVideo>): NicheVideo | null {
  let best: NicheVideo | null = null;
  for (const videoId of idea.evidenceVideoIds) {
    const outlier = index.get(videoId);
    if (outlier === undefined) continue;
    if (best === null || outlier.outlierRatio > best.outlierRatio) best = outlier;
  }
  return best;
}
