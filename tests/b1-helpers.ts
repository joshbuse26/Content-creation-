import { fixtureAvatar, fixtureChannel, FIXTURE_IDS } from "@/lib/fixtures";
import { createFixtureProviders } from "@/lib/providers/fixture";
import type {
  SearchProvider,
  YoutubeProvider,
  YtChannel,
  YtSearchResult,
  YtVideoStats,
} from "@/lib/providers/types";
import { asUserId, workspaceIdSchema } from "@/lib/types/ids";
import { InMemoryJsonCache } from "@/pipelines/ideation/cache";
import type { IdeationDeps } from "@/pipelines/ideation/deps";
import { InMemoryIdeationStore } from "@/pipelines/ideation/store";
import { InMemoryEngineStore } from "@/pipelines/script/store";
import { InMemoryQuotaCounter, QuotaTracker } from "@/pipelines/sync/quota";
import { InMemoryPipelineRunStore } from "@/queue/pipeline-runner";
import { InMemoryChannelStore } from "@/server/channel/repo";
import type { WorkspaceHandlerCtx } from "@/server/routers/impl/_shared";

/** Fresh, fully in-memory IdeationDeps for B1 tests — zero env, deterministic. */
export interface B1Deps extends IdeationDeps {
  store: InMemoryIdeationStore;
  engineStore: InMemoryEngineStore;
  channelRepo: InMemoryChannelStore;
  runs: InMemoryPipelineRunStore;
  cache: InMemoryJsonCache;
  quota: QuotaTracker;
}

export function makeIdeationDeps(
  overrides: {
    youtube?: YoutubeProvider;
    search?: SearchProvider;
    quota?: QuotaTracker;
    seedNicheVideos?: boolean;
    now?: () => Date;
  } = {},
): B1Deps {
  const providers = createFixtureProviders();
  const channelRepo = new InMemoryChannelStore();
  channelRepo.seedChannel(fixtureChannel);
  channelRepo.seedAvatar(fixtureAvatar);
  return {
    mode: "fixture",
    llm: providers.llm,
    youtube: overrides.youtube ?? providers.youtube,
    search: overrides.search ?? providers.search,
    quota: overrides.quota ?? new QuotaTracker(new InMemoryQuotaCounter()),
    cache: new InMemoryJsonCache(),
    store: new InMemoryIdeationStore({ seedFixtures: overrides.seedNicheVideos ?? true }),
    engineStore: new InMemoryEngineStore(),
    channelRepo,
    runs: new InMemoryPipelineRunStore(),
    now: overrides.now ?? (() => new Date("2026-09-10T12:00:00.000Z")),
  };
}

export const fixtureCtx: WorkspaceHandlerCtx = {
  userId: asUserId(FIXTURE_IDS.user),
  workspaceId: workspaceIdSchema.parse(FIXTURE_IDS.workspace),
};

export const otherWorkspaceCtx: WorkspaceHandlerCtx = {
  userId: asUserId(FIXTURE_IDS.user),
  workspaceId: workspaceIdSchema.parse(FIXTURE_IDS.otherWorkspace),
};

/** A YoutubeProvider stub with per-method call counting, for quota tests. */
export interface FakeNicheYoutubeOptions {
  /** Videos returned by every search, regardless of query. */
  searchResults: YtSearchResult[];
  /** Stats by video id (search hits AND competitor uploads). */
  stats: Map<string, YtVideoStats>;
  /** Competitor channels by ytid → their recent upload ids. */
  channelUploads: Map<string, string[]>;
}

export function makeFakeYoutube(options: FakeNicheYoutubeOptions): YoutubeProvider & {
  calls: { search: number; stats: number; channel: number; playlist: number };
} {
  const calls = { search: 0, stats: 0, channel: 0, playlist: 0 };
  return {
    calls,
    getChannel(idOrHandle: string): Promise<YtChannel> {
      calls.channel += 1;
      return Promise.resolve({
        youtubeChannelId: idOrHandle,
        title: `Channel ${idOrHandle}`,
        handle: null,
        subs: 10_000,
        totalViews: 1_000_000,
        videoCount: 100,
        uploadsPlaylistId: `PL-${idOrHandle}`,
      });
    },
    listRecentVideoIds(uploadsPlaylistId: string, max: number): Promise<string[]> {
      calls.playlist += 1;
      const ytid = uploadsPlaylistId.replace(/^PL-/, "");
      return Promise.resolve((options.channelUploads.get(ytid) ?? []).slice(0, max));
    },
    getVideoStats(videoIds: string[]): Promise<YtVideoStats[]> {
      calls.stats += 1;
      return Promise.resolve(
        videoIds.flatMap((id) => {
          const s = options.stats.get(id);
          return s === undefined ? [] : [s];
        }),
      );
    },
    searchVideos(): Promise<YtSearchResult[]> {
      calls.search += 1;
      return Promise.resolve(options.searchResults);
    },
  };
}

export function makeStats(
  id: string,
  channelYtid: string,
  viewCount: number,
  publishedAt: string,
): YtVideoStats {
  return {
    youtubeVideoId: id,
    title: `I Tested 7 Things (${id})`,
    publishedAt,
    viewCount,
    likeCount: null,
    commentCount: null,
    durationSeconds: 600,
    thumbnailUrl: null,
    channelYtid,
  };
}
