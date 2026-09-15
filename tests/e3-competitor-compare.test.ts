import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixtureChannel } from "@/lib/fixtures";
import type {
  YoutubeProvider,
  YtChannel,
  YtSearchResult,
  YtVideoStats,
} from "@/lib/providers/types";
import { scanDenylist } from "@/lib/seed-lint";
import { extractSharedThemes, median } from "@/pipelines/ideation/compete";
import { setIdeationDepsForTests } from "@/pipelines/ideation/deps";
import { CREDIT_COSTS } from "@/server/credits";
import { ideasHandlers } from "@/server/routers/impl/ideas";
import {
  getSharedWorkspaceStore,
  resetSharedWorkspaceStoreForTests,
} from "@/server/workspace/memory";
import { fixtureCtx, makeIdeationDeps, otherWorkspaceCtx, type B1Deps } from "./b1-helpers";

const channelId = fixtureChannel.id;

function stat(id: string, channelYtid: string, title: string, viewCount: number): YtVideoStats {
  return {
    youtubeVideoId: id,
    title,
    publishedAt: "2026-09-01T00:00:00.000Z",
    viewCount,
    likeCount: null,
    commentCount: null,
    durationSeconds: 600,
    thumbnailUrl: null,
    channelYtid,
  };
}

/**
 * A competitor YouTube stub. Alpha + Beta both win with test/listicle formats
 * (a SHARED pattern); Gamma wins with tutorials. A real-name title is planted
 * on Alpha to prove the derived concepts never leak it.
 */
function makeCompetitorYoutube(): YoutubeProvider {
  const uploads: Record<string, string[]> = {
    "@alpha": ["a_hi", "a_lo1", "a_lo2"],
    "@beta": ["b_hi", "b_lo1", "b_lo2"],
    "@gamma": ["g_hi", "g_lo1", "g_lo2"],
  };
  const stats = new Map<string, YtVideoStats>([
    // Alpha — the breakout title names a (denylisted) real creator on purpose.
    ["a_hi", stat("a_hi", "UCALPHA", "I Tested 12 Grinders like MrBeast would", 400_000)],
    ["a_lo1", stat("a_lo1", "UCALPHA", "I Tested a cheap tamper", 20_000)],
    ["a_lo2", stat("a_lo2", "UCALPHA", "I Tested water filters", 20_000)],
    // Beta — same winning pattern (test / listicle).
    ["b_hi", stat("b_hi", "UCBETA", "I Tested 5 Machines So You Don't Have To", 500_000)],
    ["b_lo1", stat("b_lo1", "UCBETA", "I Tested a milk frother", 25_000)],
    ["b_lo2", stat("b_lo2", "UCBETA", "I Tested a scale", 25_000)],
    // Gamma — tutorials (not shared with the others).
    ["g_hi", stat("g_hi", "UCGAMMA", "How to dial in espresso fast", 300_000)],
    ["g_lo1", stat("g_lo1", "UCGAMMA", "How to froth milk", 15_000)],
    ["g_lo2", stat("g_lo2", "UCGAMMA", "How to clean a machine", 15_000)],
  ]);
  return {
    getChannel(idOrHandle: string): Promise<YtChannel> {
      return Promise.resolve({
        youtubeChannelId: idOrHandle,
        title: `Channel ${idOrHandle}`,
        handle: idOrHandle,
        subs: 50_000,
        totalViews: 5_000_000,
        videoCount: 100,
        uploadsPlaylistId: `PL-${idOrHandle}`,
      });
    },
    listRecentVideoIds(uploadsPlaylistId: string, max: number): Promise<string[]> {
      const handle = uploadsPlaylistId.replace(/^PL-/, "");
      return Promise.resolve((uploads[handle] ?? []).slice(0, max));
    },
    getVideoStats(ids: string[]): Promise<YtVideoStats[]> {
      return Promise.resolve(
        ids.flatMap((id) => {
          const s = stats.get(id);
          return s === undefined ? [] : [s];
        }),
      );
    },
    searchVideos(): Promise<YtSearchResult[]> {
      return Promise.resolve([]);
    },
  };
}

describe("extractSharedThemes (pure)", () => {
  it("requires >= 2 channels to share a tag (multi-channel compare)", () => {
    const themes = extractSharedThemes([
      [{ youtubeVideoId: "a", title: "t", ratio: 9, tags: ["test", "listicle"] }],
      [{ youtubeVideoId: "b", title: "t", ratio: 8, tags: ["test"] }],
      [{ youtubeVideoId: "c", title: "t", ratio: 7, tags: ["tutorial"] }],
    ]);
    const tags = themes.map((t) => t.formatTag);
    expect(tags).toContain("test"); // shared by 2 channels
    expect(tags).not.toContain("listicle"); // only 1 channel
    expect(tags).not.toContain("tutorial"); // only 1 channel
    expect(themes.find((t) => t.formatTag === "test")?.sharedByChannels).toBe(2);
  });

  it("median is exact", () => {
    expect(median([20_000, 400_000, 20_000])).toBe(20_000);
    expect(median([])).toBe(0);
  });
});

describe("ideas.competitorCompare", () => {
  let deps: B1Deps;
  beforeEach(() => {
    deps = makeIdeationDeps({ youtube: makeCompetitorYoutube() });
    setIdeationDepsForTests(deps);
    resetSharedWorkspaceStoreForTests();
  });
  afterEach(() => {
    setIdeationDepsForTests(undefined);
    resetSharedWorkspaceStoreForTests();
  });

  const input = {
    workspaceId: fixtureCtx.workspaceId,
    channelId,
    channelHandles: ["@alpha", "@beta", "@gamma"],
  };

  // The batch cost is config (currently 0 for playtest); widen the literal so
  // every expectation below derives from it instead of assuming either value.
  const batchCost: number = CREDIT_COSTS.ideaBatch;

  it("surfaces shared THEMES and ORIGINAL concepts with no real-creator names", async () => {
    const result = await ideasHandlers.competitorCompare({ ctx: fixtureCtx, input });

    expect(result.themes.length).toBeGreaterThan(0);
    // test/listicle are shared by alpha+beta; tutorial (gamma only) is not.
    expect(result.themes.every((t) => t.sharedByChannels >= 2)).toBe(true);
    expect(result.themes.map((t) => t.formatTag)).not.toContain("tutorial");

    expect(result.ideas.length).toBeGreaterThan(0);
    for (const idea of result.ideas) {
      // Seed-lint clean: no real creator name (denylist) leaks through, even
      // though a competitor title named one. Concepts derive from the abstract
      // format pattern, never the source titles.
      expect(scanDenylist(idea.title)).toHaveLength(0);
      expect(scanDenylist(idea.angle)).toHaveLength(0);
      expect(scanDenylist(idea.rationale)).toHaveLength(0);
      expect(`${idea.title} ${idea.angle} ${idea.rationale}`).not.toMatch(/MrBeast/i);
      // Evidence ids are the REAL competitor video ids (→ real watch URLs).
      for (const vid of idea.evidenceVideoIds) {
        expect(["a_hi", "b_hi", "a_lo1", "a_lo2", "b_lo1", "b_lo2"]).toContain(vid);
      }
    }
  });

  it("persists the concepts so they appear in the feed", async () => {
    await ideasHandlers.competitorCompare({ ctx: fixtureCtx, input });
    const feed = await ideasHandlers.feed({
      ctx: fixtureCtx,
      input: { workspaceId: fixtureCtx.workspaceId, channelId, limit: 100 },
    });
    expect(feed.length).toBeGreaterThan(1);
  });

  it("charges the configured batch cost once, idempotently on a repeat compare", async () => {
    // competitorCompare always settles ONE ledger entry keyed on the compare
    // hash; its delta is -CREDIT_COSTS.ideaBatch (a 0-delta entry while
    // batches are free). A repeat never adds a second entry.
    await ideasHandlers.competitorCompare({ ctx: fixtureCtx, input });
    expect(deps.engineStore.creditEntries).toHaveLength(1);
    expect(deps.engineStore.creditEntries[0]?.delta).toBe(-batchCost);
    expect(deps.engineStore.creditEntries[0]?.reason).toBe("idea_batch");

    // Same competitors again → no second charge, no duplicate concepts.
    const second = await ideasHandlers.competitorCompare({ ctx: fixtureCtx, input });
    expect(deps.engineStore.creditEntries).toHaveLength(1);
    expect(second.ideas).toHaveLength(0); // all titles already exist (deduped)
  });

  it("with a zero balance: fails PRECONDITION_FAILED when compares cost credits, otherwise succeeds free", async () => {
    const ws = getSharedWorkspaceStore().workspaces.find((w) => w.id === fixtureCtx.workspaceId);
    if (ws !== undefined) ws.creditBalance = 0;
    const compare = ideasHandlers.competitorCompare({ ctx: fixtureCtx, input });
    if (batchCost > 0) {
      await expect(compare).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(deps.engineStore.creditEntries).toHaveLength(0);
    } else {
      // Free compares never gate on balance; the settled entry debits nothing.
      const result = await compare;
      expect(result.ideas.length).toBeGreaterThan(0);
      expect(deps.engineStore.creditEntries).toHaveLength(1);
      expect(deps.engineStore.creditEntries[0]?.delta).toBe(-batchCost);
    }
  });

  it("rejects a cross-workspace channel (tenancy)", async () => {
    await expect(
      ideasHandlers.competitorCompare({
        ctx: otherWorkspaceCtx,
        input: { ...input, workspaceId: otherWorkspaceCtx.workspaceId },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(deps.engineStore.creditEntries).toHaveLength(0);
  });
});
