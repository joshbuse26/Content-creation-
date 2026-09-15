import { beforeEach, describe, expect, it } from "vitest";
import { channelContracts } from "@/lib/types/api";
import {
  DEMO_CHANNEL,
  DEMO_NICHE_VIDEOS,
  DEMO_OWN_VIDEO_IDS,
  demoOwnTranscripts,
} from "@/lib/fixtures/demo";
import { FIXTURE_IDS } from "@/lib/fixtures";
import { asUserId, asWorkspaceId, channelIdSchema, workspaceIdSchema } from "@/lib/types/ids";
import { styleCardSchema, voiceProfileSchema, type AudienceAvatar } from "@/lib/types/entities";
import { createFixtureProviders } from "@/lib/providers/fixture";
import { InMemoryChannelStore } from "@/server/channel/repo";
import { createChannelHandlers } from "@/server/routers/impl/channel";
import { InMemoryQuotaCounter, QuotaTracker } from "@/pipelines/sync/quota";
import { InMemoryIdeationStore } from "@/pipelines/ideation/store";
import { InMemoryEngineStore } from "@/pipelines/script/store";
import { trainStyleCardFromChannel, type TrainVoiceDeps } from "@/server/voice/train";
import { resetBillingStoreForTests } from "@/server/billing";
import { resetSharedWorkspaceStoreForTests } from "@/server/workspace/memory";
import type { ChannelDomainDeps } from "@/server/channel/deps";
import type { SyncEnqueuer } from "@/server/channel/jobs";

/**
 * channel.connectDemo — the one-click "use a demo channel" playtest affordance.
 * Fully in-memory, zero keys: seeds a synthetic channel + avatar + niche
 * outliers (+ own-video transcripts for training) into the current workspace,
 * idempotently, so every downstream feature lights up with no real channel and
 * no Google/OAuth credentials.
 */

const wsA = asWorkspaceId(FIXTURE_IDS.workspace);
const wsB = asWorkspaceId(FIXTURE_IDS.otherWorkspace);
const userA = asUserId(FIXTURE_IDS.user);
const ctxA = { userId: userA, workspaceId: wsA };
const ctxB = { userId: userA, workspaceId: wsB };

function makeWorld() {
  const store = new InMemoryChannelStore();
  const ideation = new InMemoryIdeationStore({ seedFixtures: false });
  const engineAvatars: AudienceAvatar[] = [];
  const providers = createFixtureProviders();
  const deps: ChannelDomainDeps = {
    channelRepo: store,
    avatarRepo: store.asAvatarRepo(),
    trackingRepo: store,
    providers,
    quota: new QuotaTracker(new InMemoryQuotaCounter()),
  };
  const enqueuer: SyncEnqueuer = {
    enqueueChannelSync: () => Promise.resolve("job-sync"),
    enqueueAvatarGenerate: () => Promise.resolve("job-avatar"),
  };
  const handlers = createChannelHandlers({
    getDeps: () => Promise.resolve(deps),
    getEnqueuer: () => enqueuer,
    getIdeationStore: () => ideation,
    seedEngineAvatar: (a) => engineAvatars.push(a),
  });
  const input = channelContracts.connectDemo.input.parse({ workspaceId: wsA });
  return { store, ideation, engineAvatars, handlers, input };
}

describe("channel.connectDemo — seeding", () => {
  it("seeds a demo channel, avatar, and niche outliers into the workspace", async () => {
    const world = makeWorld();
    const channel = await world.handlers.connectDemo({ ctx: ctxA, input: world.input });

    expect(channel.workspaceId).toBe(wsA);
    expect(channel.mode).toBe("demo");
    expect(channel.title).toBe(DEMO_CHANNEL.title);
    expect(channel.handle).toBe(DEMO_CHANNEL.handle);
    expect(channel.youtubeChannelId).toBe(DEMO_CHANNEL.youtubeChannelId);
    // Presents as fully connected seeded data.
    expect(channel.syncStatus).toBe("synced");

    // Channel visible + snapshot present (channel.get renders stats).
    const list = await world.store.list(wsA);
    expect(list).toHaveLength(1);
    const snapshot = await world.store.latestSnapshot(wsA, channel.id);
    expect(snapshot?.subs).toBeGreaterThan(0);

    // Populated avatar (avatar panel + avatar-in-context).
    const avatar = await world.store.asAvatarRepo().get(wsA, channel.id);
    expect(avatar).not.toBeNull();
    expect(avatar?.pains.length).toBeGreaterThan(0);
    expect(avatar?.motivations.length).toBeGreaterThan(0);
    // Mirrored into the engine store for generation avatar-in-context.
    expect(world.engineAvatars).toHaveLength(1);

    // Niche outliers seeded for Discovery.
    const outliers = await world.ideation.listOutliers({
      nicheKeywords: [...DEMO_CHANNEL.nicheKeywords],
      limit: 40,
    });
    expect(outliers).toHaveLength(DEMO_NICHE_VIDEOS.length);
    // Sorted by outlier ratio desc, with varied ratios.
    const ratios = outliers.map((o) => o.outlierRatio);
    expect(ratios[0]).toBeGreaterThan(ratios[ratios.length - 1] ?? 0);
  });

  it("is idempotent — connecting twice reuses the same channel (no duplicates)", async () => {
    const world = makeWorld();
    const first = await world.handlers.connectDemo({ ctx: ctxA, input: world.input });
    const second = await world.handlers.connectDemo({ ctx: ctxA, input: world.input });

    expect(second.id).toBe(first.id);
    expect(await world.store.list(wsA)).toHaveLength(1);
    // Engine avatar mirrored only on first connect.
    expect(world.engineAvatars).toHaveLength(1);
    // Outliers deduped on youtube_video_id.
    const outliers = await world.ideation.listOutliers({
      nicheKeywords: [...DEMO_CHANNEL.nicheKeywords],
      limit: 40,
    });
    expect(outliers).toHaveLength(DEMO_NICHE_VIDEOS.length);
  });

  it("Discovery/outliers return the demo outliers for the channel's niche", async () => {
    const world = makeWorld();
    const channel = await world.handlers.connectDemo({ ctx: ctxA, input: world.input });
    // Mirror the ideas.outliers handler: query the channel's own niche keywords.
    const outliers = await world.ideation.listOutliers({
      nicheKeywords: channel.nicheKeywords,
      limit: 40,
    });
    const ids = outliers.map((o) => o.youtubeVideoId);
    for (const seed of DEMO_NICHE_VIDEOS) {
      expect(ids).toContain(seed.youtubeVideoId);
    }
  });

  it("scopes the demo channel to the connecting workspace (tenancy)", async () => {
    const world = makeWorld();
    await world.handlers.connectDemo({ ctx: ctxA, input: world.input });
    const inputB = channelContracts.connectDemo.input.parse({ workspaceId: wsB });
    const channelB = await world.handlers.connectDemo({ ctx: ctxB, input: inputB });

    expect(channelB.workspaceId).toBe(wsB);
    // Each workspace has exactly its own demo channel row.
    expect(await world.store.list(wsA)).toHaveLength(1);
    expect(await world.store.list(wsB)).toHaveLength(1);
    // A's channel id is not readable from B, and vice-versa.
    const [aChannel] = await world.store.list(wsA);
    if (aChannel === undefined) throw new Error("expected a demo channel in workspace A");
    expect(await world.store.get(wsB, aChannel.id)).toBeNull();
    // Avatar is workspace-scoped too.
    expect(await world.store.asAvatarRepo().get(wsB, aChannel.id)).toBeNull();
  });
});

describe("train_on_my_channel on the demo channel", () => {
  const workspaceId = workspaceIdSchema.parse(FIXTURE_IDS.workspace);
  const demoChannelId = channelIdSchema.parse("00000000-0000-4000-8000-0000000d3701");
  const trainCtx = { workspaceId, actorUserId: userA };

  beforeEach(() => {
    resetBillingStoreForTests();
    resetSharedWorkspaceStoreForTests();
  });

  function makeTrainDeps(): { deps: TrainVoiceDeps; store: InMemoryEngineStore } {
    const providers = createFixtureProviders();
    const channels = new InMemoryChannelStore();
    // A demo-mode channel with the synthetic own-video ids the real transcript
    // provider could never serve — training must fall back to seeded transcripts.
    channels.seedChannel({
      id: demoChannelId,
      workspaceId,
      mode: "demo",
      youtubeChannelId: DEMO_CHANNEL.youtubeChannelId,
      title: DEMO_CHANNEL.title,
      handle: DEMO_CHANNEL.handle,
      nicheKeywords: [...DEMO_CHANNEL.nicheKeywords],
      syncStatus: "synced",
      lastSyncedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const store = new InMemoryEngineStore({ seedFixtures: false });
    return {
      store,
      deps: {
        mode: "fixture",
        llm: providers.llm,
        youtube: providers.youtube,
        transcript: providers.transcript,
        store,
        channels,
      },
    };
  }

  const input = {
    channelId: demoChannelId,
    sampleVideoIds: null,
    remixFrom: null,
    name: null,
  };

  it("derives a trained StyleCard from the demo channel's seeded transcripts", async () => {
    const { deps, store } = makeTrainDeps();
    const result = await trainStyleCardFromChannel(trainCtx, input, deps);

    expect(() => styleCardSchema.parse(result.voiceProfile.styleCard)).not.toThrow();
    expect(() => voiceProfileSchema.parse(result.voiceProfile)).not.toThrow();
    expect(result.remix).toBe(false);
    expect(result.voiceProfile.source).toBe("trained");
    expect(result.voiceProfile.trainedFromChannelId).toBe(demoChannelId);

    // Sampled exactly the seeded demo own-video ids (no provider needed).
    expect([...result.sampledVideoIds].sort()).toEqual([...DEMO_OWN_VIDEO_IDS].sort());

    // Treated as proven-owned (synthetic data): the card carries the demo title.
    expect(result.voiceProfile.name).toContain(DEMO_CHANNEL.title);

    const persisted = await store.listVoiceProfiles(workspaceId);
    expect(persisted).toHaveLength(1);
  });

  it("uses seeded transcripts, not the transcript provider (works with zero keys / live mode)", async () => {
    const { deps } = makeTrainDeps();
    // A transcript provider that throws — proves the demo path never calls it.
    deps.transcript = {
      getTranscript: () => Promise.reject(new Error("transcript provider must not be called")),
    };
    deps.youtube = {
      getChannel: () => Promise.reject(new Error("youtube provider must not be called")),
      listRecentVideoIds: () => Promise.reject(new Error("youtube provider must not be called")),
      getVideoStats: () => Promise.reject(new Error("youtube provider must not be called")),
      searchVideos: () => Promise.reject(new Error("youtube provider must not be called")),
    };
    const result = await trainStyleCardFromChannel(trainCtx, input, deps);
    expect(result.sampledVideoIds.length).toBeGreaterThan(0);
  });
});

describe("demo seed data integrity", () => {
  it("own-video transcripts are available and non-empty for every own video", () => {
    const { videoIds, texts } = demoOwnTranscripts();
    expect(videoIds).toEqual(DEMO_OWN_VIDEO_IDS);
    expect(texts.every((t) => t.trim().length > 0)).toBe(true);
  });

  it("uses obviously-fake handles and ids (no real channel identity)", () => {
    expect(DEMO_CHANNEL.handle).toMatch(/demo/i);
    expect(DEMO_CHANNEL.youtubeChannelId).toMatch(/demo/i);
    for (const v of DEMO_NICHE_VIDEOS) {
      expect(v.youtubeVideoId).toMatch(/dmo/i);
    }
  });
});
