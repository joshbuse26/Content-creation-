import { describe, expect, it } from "vitest";
import { createFixtureProviders } from "@/lib/providers/fixture";
import { FIXTURE_IDS } from "@/lib/fixtures";
import { asProjectId, asWorkspaceId } from "@/lib/types/ids";
import { InMemoryPipelineRunStore } from "@/queue/pipeline-runner";
import { InMemoryChannelStore } from "@/server/channel/repo";
import {
  chunk,
  computeMedianViews90d,
  runChannelSync,
  type SyncDeps,
} from "@/pipelines/sync/pipeline";
import { runPostPublishTracking } from "@/pipelines/sync/tracking";
import { processSyncQueueJob, type SyncProcessorDeps } from "@/pipelines/sync/processor";
import { InMemoryQuotaCounter, QuotaTracker } from "@/pipelines/sync/quota";
import { JOB_NAMES } from "@/queue/queues";
import type { SyncJobInput } from "@/lib/types/pipeline";

const workspaceId = asWorkspaceId(FIXTURE_IDS.workspace);

async function seedChannel(store: InMemoryChannelStore) {
  return store.create({
    workspaceId,
    mode: "public",
    youtubeChannelId: "UCfixture0000000000000001",
    title: "Deep Dive with Casey",
    handle: "@deepdivecasey",
    nicheKeywords: ["home espresso"],
    oauthRefreshTokenEnc: null,
  });
}

function makeDeps(store: InMemoryChannelStore): SyncDeps & { quota: QuotaTracker } {
  const providers = createFixtureProviders();
  return {
    channelRepo: store,
    youtube: providers.youtube,
    quota: new QuotaTracker(new InMemoryQuotaCounter()),
    runStore: new InMemoryPipelineRunStore(),
  };
}

describe("channel sync pipeline (§5.1) — fixture E2E", () => {
  it("writes the expected snapshot row and updates the channel", async () => {
    const store = new InMemoryChannelStore();
    const channel = await seedChannel(store);
    const deps = makeDeps(store);

    const result = await runChannelSync(deps, {
      workspaceId,
      channelId: channel.id,
    });

    // Recent 50 uploads fetched, stats batched.
    expect(result.videos).toHaveLength(50);
    expect(result.channelId).toBe(channel.id);

    // Snapshot row written with the recomputed 90-day median.
    expect(store.allSnapshots).toHaveLength(1);
    const snapshot = store.allSnapshots[0];
    expect(snapshot).toBeDefined();
    if (snapshot === undefined) throw new Error("unreachable");
    expect(snapshot.workspaceId).toBe(workspaceId);
    expect(snapshot.channelId).toBe(channel.id);
    expect(snapshot.subs).toBe(result.subs);
    expect(snapshot.totalViews).toBe(result.totalViews);
    expect(snapshot.medianViews90d).toBe(result.medianViews90d);
    expect(snapshot.medianViews90d).toBe(
      computeMedianViews90d(
        result.videos.map((v) => ({ publishedAt: v.publishedAt, viewCount: v.viewCount })),
        snapshot.capturedAt,
      ),
    );

    // Channel row transitioned never → synced with a fresh lastSyncedAt.
    const updated = await store.get(workspaceId, channel.id);
    expect(updated?.syncStatus).toBe("synced");
    expect(updated?.lastSyncedAt).not.toBeNull();

    // All three stages ran through the PipelineRunner.
    const runStore = deps.runStore as InMemoryPipelineRunStore;
    expect(runStore.rows.map((r) => [r.stage, r.status])).toEqual([
      ["fetch_channel", "done"],
      ["fetch_videos", "done"],
      ["snapshot_stats", "done"],
    ]);

    // Quota: 1 channels.list + 1 playlistItems.list + 1 videos.list batch.
    expect(await deps.quota.usedToday()).toBe(3);
  });

  it("marks the channel failed and throws when the quota breaker is tripped", async () => {
    const store = new InMemoryChannelStore();
    const channel = await seedChannel(store);
    const deps = makeDeps(store);
    // Exhaust the budget so the first stage's charge refuses.
    for (let i = 0; i < 90; i++) {
      await deps.quota.charge("search.list");
    }

    await expect(runChannelSync(deps, { workspaceId, channelId: channel.id })).rejects.toThrow(
      /channel sync failed at fetch_channel/,
    );
    const updated = await store.get(workspaceId, channel.id);
    expect(updated?.syncStatus).toBe("failed");
  }, 15_000); // stage retries back off ~3s before giving up

  it("rejects a sync for a channel outside the workspace", async () => {
    const store = new InMemoryChannelStore();
    const channel = await seedChannel(store);
    const deps = makeDeps(store);
    await expect(
      runChannelSync(deps, {
        workspaceId: asWorkspaceId(FIXTURE_IDS.otherWorkspace),
        channelId: channel.id,
      }),
    ).rejects.toThrow(/not found in workspace/);
    expect(store.allSnapshots).toHaveLength(0);
  });

  it("computeMedianViews90d ignores videos older than 90 days", () => {
    const now = new Date("2026-09-10T00:00:00.000Z");
    const videos = [
      { publishedAt: "2026-09-01T00:00:00.000Z", viewCount: 100 },
      { publishedAt: "2026-08-01T00:00:00.000Z", viewCount: 300 },
      { publishedAt: "2026-07-01T00:00:00.000Z", viewCount: 200 },
      { publishedAt: "2025-01-01T00:00:00.000Z", viewCount: 999_999 }, // out of window
    ];
    expect(computeMedianViews90d(videos, now)).toBe(200);
    expect(computeMedianViews90d([], now)).toBe(0);
    expect(
      computeMedianViews90d(
        [
          { publishedAt: "2026-09-01T00:00:00.000Z", viewCount: 100 },
          { publishedAt: "2026-09-02T00:00:00.000Z", viewCount: 301 },
        ],
        now,
      ),
    ).toBe(200); // even count → floor of the mean of the middle two
  });

  it("chunk batches ids at 50 per videos.list call", () => {
    expect(
      chunk(
        Array.from({ length: 120 }, (_, i) => i),
        50,
      ).map((c) => c.length),
    ).toEqual([50, 50, 20]);
    expect(chunk([], 50)).toEqual([]);
  });
});

describe("post-publish tracking (§5.12)", () => {
  it("pulls stats for published projects and upserts the shared stats store", async () => {
    const store = new InMemoryChannelStore();
    const channel = await seedChannel(store);
    await store.insertSnapshot({
      workspaceId,
      channelId: channel.id,
      capturedAt: new Date(),
      subs: 48_200,
      totalViews: 6_490_000,
      medianViews90d: 20_000,
    });
    store.publishedProjects.push({
      projectId: asProjectId(FIXTURE_IDS.project),
      workspaceId,
      channelId: channel.id,
      publishedVideoId: "fxpublished1",
    });

    const providers = createFixtureProviders();
    const quota = new QuotaTracker(new InMemoryQuotaCounter());
    const summary = await runPostPublishTracking({
      trackingRepo: store,
      channelRepo: store,
      youtube: providers.youtube,
      quota,
    });

    expect(summary).toEqual({ projectsScanned: 1, videosTracked: 1 });
    const tracked = store.trackedVideos.get("fxpublished1");
    expect(tracked).toBeDefined();
    if (tracked === undefined) throw new Error("unreachable");
    expect(tracked.channelMedianViews).toBe(20_000);
    expect(tracked.outlierRatio).toBeCloseTo(tracked.viewCount / 20_000, 2);
    expect(await quota.usedToday()).toBe(1); // one videos.list batch
  });

  it("is a no-op with no published projects", async () => {
    const store = new InMemoryChannelStore();
    const providers = createFixtureProviders();
    const quota = new QuotaTracker(new InMemoryQuotaCounter());
    const summary = await runPostPublishTracking({
      trackingRepo: store,
      channelRepo: store,
      youtube: providers.youtube,
      quota,
    });
    expect(summary).toEqual({ projectsScanned: 0, videosTracked: 0 });
    expect(await quota.usedToday()).toBe(0);
  });
});

describe("sync queue processor", () => {
  function processorDeps(store: InMemoryChannelStore): SyncProcessorDeps & {
    enqueued: { name: string; input: SyncJobInput }[];
  } {
    const providers = createFixtureProviders();
    const enqueued: { name: string; input: SyncJobInput }[] = [];
    return {
      channelRepo: store,
      avatarRepo: store.asAvatarRepo(),
      trackingRepo: store,
      providers,
      quota: new QuotaTracker(new InMemoryQuotaCounter()),
      enqueuer: {
        enqueueChannelSync(input) {
          enqueued.push({ name: "channel-sync", input });
          return Promise.resolve(`job-${enqueued.length}`);
        },
        enqueueAvatarGenerate() {
          return Promise.resolve("job-avatar");
        },
      },
      enqueued,
    };
  }

  it("fans the nightly sweep out to one job per channel", async () => {
    const store = new InMemoryChannelStore();
    const a = await seedChannel(store);
    const b = await store.create({
      workspaceId: asWorkspaceId(FIXTURE_IDS.otherWorkspace),
      mode: "public",
      youtubeChannelId: "UCother00000000000000002",
      title: "Other Channel",
      handle: null,
      nicheKeywords: [],
      oauthRefreshTokenEnc: null,
    });
    const deps = processorDeps(store);

    await processSyncQueueJob({ name: JOB_NAMES.channelSync, data: { sweep: true } }, deps);

    expect(deps.enqueued.map((e) => e.input.channelId).sort()).toEqual(
      [a.id, b.id].map((x) => String(x)).sort(),
    );
  });

  it("runs a single-channel sync job end-to-end", async () => {
    const store = new InMemoryChannelStore();
    const channel = await seedChannel(store);
    const deps = processorDeps(store);
    await processSyncQueueJob(
      {
        name: JOB_NAMES.channelSync,
        data: { workspaceId: FIXTURE_IDS.workspace, channelId: channel.id },
      },
      deps,
    );
    expect(store.allSnapshots).toHaveLength(1);
  });

  it("throws on jobs it does not own", async () => {
    const store = new InMemoryChannelStore();
    await expect(
      processSyncQueueJob({ name: "daily-ideas", data: {} }, processorDeps(store)),
    ).rejects.toThrow(/unhandled job/);
  });
});
