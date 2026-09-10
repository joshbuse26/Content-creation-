import { describe, expect, it } from "vitest";
import type { YtSearchResult, YtVideoStats } from "@/lib/providers/types";
import { outlierJobInputSchema } from "@/lib/types/pipeline";
import {
  computeOutlierRatio,
  runOutlierRefresh,
  OUTLIER_RATIO_THRESHOLD,
} from "@/pipelines/ideation/outliers";
import { InMemoryQuotaCounter, QuotaTracker, QUOTA_UNITS } from "@/pipelines/sync/quota";
import { makeFakeYoutube, makeIdeationDeps, makeStats } from "./b1-helpers";

const NOW = new Date("2026-09-10T12:00:00.000Z");
const RECENT = "2026-08-25T00:00:00.000Z";

function searchResult(id: string, channelYtid: string): YtSearchResult {
  return {
    youtubeVideoId: id,
    channelYtid,
    title: `I Tested 7 Things (${id})`,
    publishedAt: RECENT,
    thumbnailUrl: null,
  };
}

/**
 * Competitor channel UC1 with a median of 100k views (uploads m1..m3),
 * plus two search hits: vidA at exactly 3x the median, vidB just under.
 */
function fixtureNiche() {
  const stats = new Map<string, YtVideoStats>([
    ["vidA", makeStats("vidA", "UC1", 300_000, RECENT)],
    ["vidB", makeStats("vidB", "UC1", 299_000, RECENT)],
    ["m1", makeStats("m1", "UC1", 90_000, RECENT)],
    ["m2", makeStats("m2", "UC1", 100_000, RECENT)],
    ["m3", makeStats("m3", "UC1", 110_000, RECENT)],
  ]);
  return makeFakeYoutube({
    searchResults: [searchResult("vidA", "UC1"), searchResult("vidB", "UC1")],
    stats,
    channelUploads: new Map([["UC1", ["m1", "m2", "m3"]]]),
  });
}

describe("outlier math", () => {
  it("ratio = views / channel median, 2dp", () => {
    expect(computeOutlierRatio(300_000, 100_000)).toBe(3);
    expect(computeOutlierRatio(299_000, 100_000)).toBe(2.99);
  });

  it("is null for a zero median (no division blowups)", () => {
    expect(computeOutlierRatio(1_000, 0)).toBeNull();
  });

  it("keeps ratio >= 3 and drops the rest", async () => {
    const youtube = fixtureNiche();
    const deps = makeIdeationDeps({ youtube, seedNicheVideos: false, now: () => NOW });
    const summary = await runOutlierRefresh(deps, { nicheKeywords: ["home espresso"] });

    expect(summary.kept).toBe(1);
    expect(summary.candidates).toBe(2);
    expect(summary.degraded).toBe(false);

    const outliers = await deps.store.listOutliers({
      nicheKeywords: ["Home Espresso"],
      limit: 10,
    });
    expect(outliers.map((o) => o.youtubeVideoId)).toEqual(["vidA"]);
    const kept = outliers[0];
    expect(kept?.outlierRatio).toBeGreaterThanOrEqual(OUTLIER_RATIO_THRESHOLD);
    expect(kept?.channelMedianViews).toBe(100_000);
    expect(kept?.formatTags.length).toBeGreaterThan(0);
    expect(kept?.nicheKeywords).toEqual(["home espresso"]);
  });

  it("upserts on re-run instead of duplicating", async () => {
    const youtube = fixtureNiche();
    const deps = makeIdeationDeps({ youtube, seedNicheVideos: false, now: () => NOW });
    await runOutlierRefresh(deps, { nicheKeywords: ["home espresso"] });
    await runOutlierRefresh(deps, { nicheKeywords: ["home espresso"] });
    const outliers = await deps.store.listOutliers({ nicheKeywords: ["home espresso"], limit: 10 });
    expect(outliers).toHaveLength(1);
  });
});

describe("niche sharing (spec §8 key design point)", () => {
  it("two channels with the same normalized niche produce ONE search", async () => {
    const youtube = fixtureNiche();
    const deps = makeIdeationDeps({ youtube, seedNicheVideos: false, now: () => NOW });

    // Channel 1's nightly refresh.
    await runOutlierRefresh(deps, { nicheKeywords: ["Home Espresso"] });
    // Channel 2 shares the niche — different casing/spacing, same normalized query.
    await runOutlierRefresh(deps, { nicheKeywords: ["  home   espresso "] });

    expect(youtube.calls.search).toBe(1);
    // Competitor median was computed once and served from the 7d cache after.
    expect(youtube.calls.channel).toBe(1);
  });

  it("spends search quota once per cached query", async () => {
    const youtube = fixtureNiche();
    const quota = new QuotaTracker(new InMemoryQuotaCounter());
    const deps = makeIdeationDeps({ youtube, quota, seedNicheVideos: false, now: () => NOW });

    await runOutlierRefresh(deps, { nicheKeywords: ["home espresso"] });
    const afterFirst = await quota.usedToday();
    await runOutlierRefresh(deps, { nicheKeywords: ["home espresso"] });
    const afterSecond = await quota.usedToday();

    expect(afterFirst).toBeGreaterThanOrEqual(QUOTA_UNITS["search.list"]);
    // Second run re-used the 24h search cache AND the 7d median cache: the
    // only spend is the (cheap) stats re-fetch.
    expect(afterSecond - afterFirst).toBeLessThanOrEqual(QUOTA_UNITS["videos.list"]);
  });
});

describe("quota circuit breaker (spec §8)", () => {
  it("degrades instead of calling YouTube when the breaker is tripped", async () => {
    const youtube = fixtureNiche();
    // Breaker refuses even a 1-unit call.
    const quota = new QuotaTracker(new InMemoryQuotaCounter(), { breakerUnits: 0 });
    const deps = makeIdeationDeps({ youtube, quota, seedNicheVideos: false, now: () => NOW });

    const summary = await runOutlierRefresh(deps, { nicheKeywords: ["home espresso"] });

    expect(summary.degraded).toBe(true);
    expect(summary.searchesPerformed).toBe(0);
    expect(summary.kept).toBe(0);
    expect(youtube.calls.search).toBe(0);
    expect(youtube.calls.stats).toBe(0);
  });

  it("serves cached search results while degraded", async () => {
    const youtube = fixtureNiche();
    const quota = new QuotaTracker(new InMemoryQuotaCounter());
    const deps = makeIdeationDeps({ youtube, quota, seedNicheVideos: false, now: () => NOW });
    // Warm the caches within budget…
    await runOutlierRefresh(deps, { nicheKeywords: ["home espresso"] });
    // …then trip the breaker and refresh again.
    const tripped = makeIdeationDeps({ youtube, seedNicheVideos: false, now: () => NOW });
    tripped.cache = deps.cache;
    tripped.store = deps.store;
    tripped.quota = new QuotaTracker(new InMemoryQuotaCounter(), { breakerUnits: 0 });

    const summary = await runOutlierRefresh(tripped, { nicheKeywords: ["home espresso"] });
    expect(summary.searchCacheHits).toBe(1);
    expect(summary.searchesPerformed).toBe(0);
    // Stats spend was refused, so the run is degraded but still completes.
    expect(summary.degraded).toBe(true);
  });
});

describe("frozen input schema", () => {
  it("caps a run at 6 niche keywords (≤6 searches/channel/day)", () => {
    expect(() =>
      outlierJobInputSchema.parse({ nicheKeywords: ["a", "b", "c", "d", "e", "f", "g"] }),
    ).toThrow();
    expect(outlierJobInputSchema.parse({ nicheKeywords: ["a"] }).nicheKeywords).toEqual(["a"]);
  });
});
