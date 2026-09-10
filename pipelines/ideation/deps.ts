import { hasDb } from "@/db";
import { getConfig } from "@/lib/config";
import type { JsonCache } from "@/lib/cache";
import { createJsonCache } from "@/lib/cache";
import { getProviders } from "@/lib/providers";
import type { LlmProvider, YoutubeProvider } from "@/lib/providers/types";
import type { EngineMode } from "@/pipelines/script/llm-json";
import { getEngineStore, type EngineStore } from "@/pipelines/script/store";
import { getSharedQuotaTracker, type QuotaTracker } from "@/pipelines/sync/quota";
import { InMemoryPipelineRunStore, type PipelineRunStore } from "@/queue/pipeline-runner";
import { DrizzlePipelineRunStore } from "@/queue/store";
import { DrizzleChannelRepo, getSharedMemoryStore, type ChannelRepo } from "@/server/channel/repo";
import { InMemoryJsonCache } from "./cache";
import { getIdeationStore, type IdeationStore } from "./store";

/**
 * IdeationDeps — everything the outlier index (§5.3), daily ideas (§5.4)
 * and the ideas router impl need, injectable so tests run fully in-memory
 * with custom providers and zero env.
 */
export interface IdeationDeps {
  mode: EngineMode;
  llm: LlmProvider;
  youtube: YoutubeProvider;
  /** Shared YouTube quota ledger + circuit breaker (spec §8). */
  quota: QuotaTracker;
  /** Search-result (24h) and channel-median (7d) cache. */
  cache: JsonCache;
  /** niche_videos + ideas persistence. */
  store: IdeationStore;
  /** Projects (recent topics, promote), avatars, credit ledger. */
  engineStore: EngineStore;
  channelRepo: ChannelRepo;
  /** pipeline_runs persistence for workspace-scoped daily-ideas runs. */
  runs: PipelineRunStore;
  now: () => Date;
}

let cachedDeps: IdeationDeps | undefined;
let fallbackCache: InMemoryJsonCache | undefined;

async function buildCache(): Promise<JsonCache> {
  const { hasRedis, getRedisConnection } = await import("@/queue/connection");
  if (hasRedis()) return createJsonCache(getRedisConnection());
  fallbackCache ??= new InMemoryJsonCache();
  return fallbackCache;
}

export async function getIdeationDeps(): Promise<IdeationDeps> {
  if (cachedDeps === undefined) {
    const providers = await getProviders();
    cachedDeps = {
      mode: getConfig().PROVIDERS,
      llm: providers.llm,
      youtube: providers.youtube,
      quota: await getSharedQuotaTracker(),
      cache: await buildCache(),
      store: getIdeationStore(),
      engineStore: getEngineStore(),
      channelRepo: hasDb() ? new DrizzleChannelRepo() : getSharedMemoryStore(),
      runs: hasDb() ? new DrizzlePipelineRunStore() : new InMemoryPipelineRunStore(),
      now: () => new Date(),
    };
  }
  return cachedDeps;
}

export function setIdeationDepsForTests(deps: IdeationDeps | undefined): void {
  cachedDeps = deps;
  fallbackCache = undefined;
}
