import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixtureChannel } from "@/lib/fixtures";
import { nicheVideoSchema } from "@/lib/types/entities";
import { setIdeationDepsForTests } from "@/pipelines/ideation/deps";
import {
  computeViewMultiple,
  computeViewsPerDay,
  daysSincePublished,
  enrichOutlier,
  recencyBand,
  recencyLabel,
  viewMultipleLabel,
  viewsPerDayLabel,
} from "@/pipelines/ideation/enrich";
import { whyCacheKey } from "@/pipelines/ideation/cache";
import { computeWhyItWorked } from "@/pipelines/ideation/why";
import { containsRealCreatorName } from "@/lib/seed-lint";
import { ideasHandlers } from "@/server/routers/impl/ideas";
import { resetSharedWorkspaceStoreForTests } from "@/server/workspace/memory";
import { fixtureCtx, makeIdeationDeps, type B1Deps } from "./b1-helpers";

const NOW = new Date("2026-09-12T12:00:00.000Z");
const channelId = fixtureChannel.id;

function nicheVideo(overrides: Partial<Record<string, unknown>> = {}) {
  return nicheVideoSchema.parse({
    id: crypto.randomUUID(),
    youtubeVideoId: `v${Math.random().toString(36).slice(2, 10)}`,
    channelYtid: "UCcompetitor0000000000001",
    title: "I Tested 12 Budget Grinders So You Don't Have To",
    thumbnailUrl: "https://i.ytimg.com/vi/x/hqdefault.jpg",
    publishedAt: new Date("2026-09-10T00:00:00.000Z"),
    viewCount: 412_000,
    channelMedianViews: 40_000,
    outlierRatio: 10.3,
    formatTags: ["listicle", "test"],
    nicheKeywords: ["coffee gear"],
    lastRefreshedAt: NOW,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Pure enrichment math (deterministic)
// ---------------------------------------------------------------------------

describe("enrichment math", () => {
  it("view multiple is views / channel median (2dp), null on a zero median", () => {
    expect(computeViewMultiple(412_000, 40_000)).toBe(10.3);
    expect(computeViewMultiple(250_000, 40_000)).toBe(6.25);
    expect(computeViewMultiple(100_000, 0)).toBeNull();
  });

  it("days-since-publish is whole days, never negative", () => {
    expect(daysSincePublished(new Date("2026-09-05T12:00:00Z"), NOW)).toBe(7);
    expect(daysSincePublished(new Date("2026-09-12T18:00:00Z"), NOW)).toBe(0); // future-ish clamps to 0
  });

  it("view velocity is views / days (floored at 1 day)", () => {
    // 7 days since publish → 420000/7 = 60000
    expect(computeViewsPerDay(420_000, new Date("2026-09-05T12:00:00Z"), NOW)).toBe(60_000);
    // same-day upload → full views (floor of 1 day)
    expect(computeViewsPerDay(9_000, new Date("2026-09-12T06:00:00Z"), NOW)).toBe(9_000);
  });

  it("recency bands split on 7 and 31 days", () => {
    expect(recencyBand(new Date("2026-09-10T00:00:00Z"), NOW)).toBe("this_week");
    expect(recencyBand(new Date("2026-08-25T00:00:00Z"), NOW)).toBe("this_month");
    expect(recencyBand(new Date("2026-06-01T00:00:00Z"), NOW)).toBe("older");
  });

  it("enrichOutlier assembles every signal off the row", () => {
    const e = enrichOutlier(nicheVideo({ publishedAt: new Date("2026-09-10T00:00:00Z") }), NOW);
    expect(e.viewMultiple).toBe(10.3);
    expect(e.recency).toBe("this_week");
    expect(e.viewsPerDay).toBeGreaterThan(0);
    expect(e.formatTags).toEqual(["listicle", "test"]);
  });

  it("labels render the human copy", () => {
    expect(viewMultipleLabel(6.2)).toBe("6.2× channel median");
    expect(viewsPerDayLabel(12_400)).toBe("12.4K views/day");
    expect(viewsPerDayLabel(2_100_000)).toBe("2.1M views/day");
    expect(recencyLabel("this_week")).toBe("This week");
  });
});

// ---------------------------------------------------------------------------
// why it worked (deterministic + cached + seed-lint clean)
// ---------------------------------------------------------------------------

describe("computeWhyItWorked", () => {
  let deps: B1Deps;
  beforeEach(() => {
    deps = makeIdeationDeps({ now: () => NOW });
  });

  it("returns a name-free blurb per video, in input order", async () => {
    const videos = [
      nicheVideo({ youtubeVideoId: "aaa", formatTags: ["listicle"] }),
      nicheVideo({ youtubeVideoId: "bbb", formatTags: ["versus"] }),
    ];
    const out = await computeWhyItWorked(deps, videos);
    expect(out.map((w) => w.youtubeVideoId)).toEqual(["aaa", "bbb"]);
    for (const w of out) {
      expect(w.blurb.length).toBeGreaterThan(0);
      expect(containsRealCreatorName(w.blurb)).toBe(false);
    }
    // Deterministic in fixture mode.
    const again = await computeWhyItWorked(deps, videos);
    expect(again).toEqual(out);
  });

  it("caches per video id (7d)", async () => {
    const video = nicheVideo({ youtubeVideoId: "ccc" });
    await computeWhyItWorked(deps, [video]);
    const cached = await deps.cache.get(whyCacheKey("ccc"), (raw) => String(raw));
    expect(cached).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// server-side outlier filters (narrow correctly, additive + default-safe)
// ---------------------------------------------------------------------------

describe("ideas.outliers filters", () => {
  let deps: B1Deps;
  beforeEach(() => {
    deps = makeIdeationDeps({ now: () => NOW, seedNicheVideos: false });
    setIdeationDepsForTests(deps);
    resetSharedWorkspaceStoreForTests();
  });
  afterEach(() => {
    setIdeationDepsForTests(undefined);
    resetSharedWorkspaceStoreForTests();
  });

  async function seed() {
    await deps.store.upsertNicheVideos([
      {
        youtubeVideoId: "hot",
        channelYtid: "UCx1",
        title: "I Tested 12 Grinders",
        thumbnailUrl: null,
        publishedAt: new Date("2026-09-11T00:00:00Z"), // this week
        viewCount: 500_000,
        channelMedianViews: 50_000,
        outlierRatio: 10,
        formatTags: ["listicle"],
        nicheKeywords: ["coffee gear"],
        lastRefreshedAt: NOW,
      },
      {
        youtubeVideoId: "mild",
        channelYtid: "UCx2",
        title: "A calm essay on beans",
        thumbnailUrl: null,
        publishedAt: new Date("2026-06-01T00:00:00Z"), // older
        viewCount: 120_000,
        channelMedianViews: 40_000,
        outlierRatio: 3,
        formatTags: ["essay"],
        nicheKeywords: ["coffee gear"],
        lastRefreshedAt: NOW,
      },
    ]);
  }

  const baseInput = {
    workspaceId: fixtureCtx.workspaceId,
    channelId,
    nicheKeyword: null,
    limit: 40,
    minOutlierRatio: null,
    recency: "all" as const,
  };

  it("default params return everything (behavior preserved)", async () => {
    await seed();
    const rows = await ideasHandlers.outliers({ ctx: fixtureCtx, input: baseInput });
    expect(rows.map((r) => r.youtubeVideoId).sort()).toEqual(["hot", "mild"]);
  });

  it("minOutlierRatio keeps only concepts at/above the floor", async () => {
    await seed();
    const rows = await ideasHandlers.outliers({
      ctx: fixtureCtx,
      input: { ...baseInput, minOutlierRatio: 5 },
    });
    expect(rows.map((r) => r.youtubeVideoId)).toEqual(["hot"]);
  });

  it("recency=week narrows to fresh videos", async () => {
    await seed();
    const rows = await ideasHandlers.outliers({
      ctx: fixtureCtx,
      input: { ...baseInput, recency: "week" },
    });
    expect(rows.map((r) => r.youtubeVideoId)).toEqual(["hot"]);
  });
});

// ---------------------------------------------------------------------------
// useIdea deepened — avatar hint reaches the seeded frame's audience segment
// ---------------------------------------------------------------------------

describe("ideas.useIdea deepened prefill", () => {
  let deps: B1Deps;
  beforeEach(() => {
    deps = makeIdeationDeps({ now: () => NOW });
    setIdeationDepsForTests(deps);
    resetSharedWorkspaceStoreForTests();
  });
  afterEach(() => {
    setIdeationDepsForTests(undefined);
    resetSharedWorkspaceStoreForTests();
  });

  it("prefills the audience segment from the channel avatar", async () => {
    const [idea] = await deps.store.insertIdeas([
      {
        workspaceId: fixtureCtx.workspaceId,
        channelId,
        title: "Budget espresso, blind tested",
        angle: "Cost-optimized stack",
        rationale: "Budget stacks over-perform.",
        evidenceVideoIds: [],
        score: 70,
        generatedOn: "2026-09-12",
      },
    ]);
    if (idea === undefined) throw new Error("seed failed");

    const { frame } = await ideasHandlers.useIdea({
      ctx: fixtureCtx,
      input: {
        workspaceId: fixtureCtx.workspaceId,
        ideaId: idea.id,
        angle: null,
        targetMinutes: null,
      },
    });
    // fixtureAvatar: sophistication "intermediate" + first pain about over-spending.
    expect(frame.audienceSegment).toContain("intermediate");
    expect(frame.audienceSegment.length).toBeGreaterThan("coffee gear".length);
    // Still free.
    expect(deps.engineStore.creditEntries).toHaveLength(0);
  });
});
