import { describe, expect, it } from "vitest";
import { FIXTURE_IDS, fixtureChannel } from "@/lib/fixtures";
import { DEMO_OWN_VIDEO_STATS, DEMO_SNAPSHOT } from "@/lib/fixtures/demo";
import type { ChannelStatsSnapshot, ChannelVideo } from "@/lib/types/entities";
import { asChannelId, asWorkspaceId, channelStatsSnapshotIdSchema } from "@/lib/types/ids";
import {
  ANALYTICS_ONLY_FIELDS,
  buildIntelOverview,
  durationBand,
  median,
  STRONG_RATIO,
  verdictFor,
  WEAK_RATIO,
} from "@/lib/intel/stats";
import { InMemoryChannelStore } from "@/server/channel/repo";

/**
 * Intel = own-channel stats, derived purely from synced uploads + snapshots.
 * Pins: derivations are deterministic and honest (no Analytics-only numbers
 * ever appear), verdicts follow the channel's own median, the plain-English
 * calls name the right videos, snapshot deltas come from real snapshots, and
 * the repo round-trips the rows the sync pipeline writes.
 */

const WS = asWorkspaceId(FIXTURE_IDS.workspace);
const CH = asChannelId(fixtureChannel.id);
const NOW = new Date("2026-09-20T12:00:00Z");
const DAY = 86_400_000;

function video(partial: Partial<ChannelVideo> & { youtubeVideoId: string }): ChannelVideo {
  return {
    workspaceId: WS,
    channelId: CH,
    title: partial.youtubeVideoId,
    thumbnailUrl: null,
    publishedAt: new Date(NOW.getTime() - 30 * DAY),
    durationSeconds: 600,
    viewCount: 10_000,
    likeCount: 400,
    commentCount: 50,
    capturedAt: NOW,
    ...partial,
  };
}

function snapshot(daysAgo: number, subs: number, totalViews: number): ChannelStatsSnapshot {
  return {
    id: channelStatsSnapshotIdSchema.parse(
      `00000000-0000-4000-8000-0000000000${String(daysAgo).padStart(2, "0")}`,
    ),
    workspaceId: WS,
    channelId: CH,
    capturedAt: new Date(NOW.getTime() - daysAgo * DAY),
    subs,
    totalViews,
    medianViews90d: 10_000,
  };
}

describe("primitives", () => {
  it("median handles odd, even and empty", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2);
    expect(median([])).toBe(0);
  });

  it("duration bands split at 8 and 15 minutes", () => {
    expect(durationBand(7 * 60 + 59)).toBe("short");
    expect(durationBand(8 * 60)).toBe("mid");
    expect(durationBand(15 * 60)).toBe("mid");
    expect(durationBand(15 * 60 + 1)).toBe("long");
  });

  it("verdicts follow the median ratio, and a fresh video is 'too early' unless it already broke out", () => {
    expect(verdictFor(STRONG_RATIO, 30)).toBe("strong");
    expect(verdictFor(WEAK_RATIO, 30)).toBe("weak");
    expect(verdictFor(1, 30)).toBe("typical");
    expect(verdictFor(0.2, 1)).toBe("too_early");
    expect(verdictFor(3, 1)).toBe("strong");
  });
});

describe("buildIntelOverview", () => {
  it("names the clear winner and the clear miss, and never reports Analytics-only numbers", () => {
    const videos = [
      video({ youtubeVideoId: "a", title: "winner", viewCount: 40_000 }),
      video({ youtubeVideoId: "b", title: "middle one", viewCount: 10_000 }),
      video({ youtubeVideoId: "c", title: "another middle", viewCount: 11_000 }),
      video({ youtubeVideoId: "d", title: "miss", viewCount: 3_000 }),
    ];
    const overview = buildIntelOverview({
      channel: fixtureChannel,
      videos,
      snapshots: [],
      now: NOW,
    });

    expect(overview.kpis.medianViews).toBe(10_500);
    expect(overview.videos.find((v) => v.title === "winner")?.verdict).toBe("strong");
    expect(overview.videos.find((v) => v.title === "miss")?.verdict).toBe("weak");
    expect(overview.strengths[0]).toContain("“winner”");
    expect(overview.weaknesses[0]).toContain("“miss”");
    expect(overview.headline).toContain("“winner”");

    // Honest about what the Data API cannot give us.
    expect(overview.analytics.available).toBe(false);
    expect(overview.analytics.fields.map((f) => f.key)).toEqual(
      ANALYTICS_ONLY_FIELDS.map((f) => f.key),
    );
    // No snapshot → no subscriber figure, not a made-up one.
    expect(overview.kpis.subs).toBeNull();
    expect(overview.kpis.subsDelta).toBeNull();
  });

  it("subscriber and view deltas come from the two snapshots that bracket the last 30 days", () => {
    const snapshots = [
      snapshot(0, 1_200, 500_000),
      snapshot(10, 1_100, 480_000),
      snapshot(45, 900, 400_000),
    ];
    const overview = buildIntelOverview({
      channel: fixtureChannel,
      videos: [video({ youtubeVideoId: "a" })],
      snapshots,
      now: NOW,
    });
    expect(overview.kpis.subs).toBe(1_200);
    expect(overview.kpis.subsDelta).toEqual({ value: 100, sinceDays: 10 });
    expect(overview.kpis.totalViewsDelta).toEqual({ value: 20_000, sinceDays: 10 });
    expect(overview.strengths.some((s) => s.includes("+100 subscribers"))).toBe(true);
  });

  it("calls out the winning length band only when two bands each have data", () => {
    const videos = [
      video({ youtubeVideoId: "s1", durationSeconds: 300, viewCount: 30_000 }),
      video({ youtubeVideoId: "s2", durationSeconds: 320, viewCount: 28_000 }),
      video({ youtubeVideoId: "l1", durationSeconds: 1_200, viewCount: 9_000 }),
      video({ youtubeVideoId: "l2", durationSeconds: 1_300, viewCount: 8_000 }),
    ];
    const overview = buildIntelOverview({
      channel: fixtureChannel,
      videos,
      snapshots: [],
      now: NOW,
    });
    expect(overview.strengths.some((s) => s.startsWith("Videos under 8 min average"))).toBe(true);
    expect(overview.weaknesses.some((w) => w.includes("over 15 min videos are your weakest"))).toBe(
      true,
    );
  });

  it("an empty channel gets an honest headline and no calls", () => {
    const overview = buildIntelOverview({
      channel: fixtureChannel,
      videos: [],
      snapshots: [],
      now: NOW,
    });
    expect(overview.headline).toContain("no synced uploads yet");
    expect(overview.strengths).toEqual([]);
    expect(overview.weaknesses).toEqual([]);
    expect(overview.periods.every((p) => p.videos === 0)).toBe(true);
  });

  it("the demo channel's seeded uploads produce a strong AND a weak call", () => {
    const videos = DEMO_OWN_VIDEO_STATS.map((v) => ({
      ...v,
      workspaceId: WS,
      channelId: CH,
      capturedAt: NOW,
    }));
    const overview = buildIntelOverview({
      channel: fixtureChannel,
      videos,
      snapshots: [snapshot(0, DEMO_SNAPSHOT.subs, DEMO_SNAPSHOT.totalViews)],
      now: NOW,
    });
    expect(overview.videos.some((v) => v.verdict === "strong")).toBe(true);
    expect(overview.videos.some((v) => v.verdict === "weak")).toBe(true);
    expect(overview.strengths.length).toBeGreaterThan(0);
    expect(overview.weaknesses.length).toBeGreaterThan(0);
  });
});

describe("InMemoryChannelStore videos", () => {
  it("upserts by (channel, video), lists newest first, scopes by workspace, and clears on remove", async () => {
    const store = new InMemoryChannelStore();
    const ch = await store.create({
      workspaceId: WS,
      mode: "public",
      youtubeChannelId: "UCtest",
      title: "t",
      handle: null,
      nicheKeywords: [],
      oauthRefreshTokenEnc: null,
    });
    const rows = [
      {
        youtubeVideoId: "v1",
        title: "one",
        thumbnailUrl: null,
        publishedAt: new Date(NOW.getTime() - 5 * DAY),
        durationSeconds: 100,
        viewCount: 1,
        likeCount: null,
        commentCount: null,
      },
      {
        youtubeVideoId: "v2",
        title: "two",
        thumbnailUrl: null,
        publishedAt: new Date(NOW.getTime() - 1 * DAY),
        durationSeconds: 100,
        viewCount: 2,
        likeCount: 1,
        commentCount: 1,
      },
    ];
    await store.upsertChannelVideos(WS, ch.id, rows, NOW);
    const first = rows[0];
    if (first === undefined) throw new Error("no row");
    await store.upsertChannelVideos(WS, ch.id, [{ ...first, viewCount: 99 }], NOW);
    const listed = await store.listChannelVideos(WS, ch.id);
    expect(listed.map((v) => v.youtubeVideoId)).toEqual(["v2", "v1"]);
    expect(listed[1]?.viewCount).toBe(99);
    expect(await store.listChannelVideos(asWorkspaceId(FIXTURE_IDS.otherWorkspace), ch.id)).toEqual(
      [],
    );
    await store.remove(WS, ch.id);
    expect(await store.listChannelVideos(WS, ch.id)).toEqual([]);
  });
});
