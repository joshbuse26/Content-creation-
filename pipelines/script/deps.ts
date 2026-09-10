import { getConfig } from "@/lib/config";
import { getProviders } from "@/lib/providers";
import type { LlmProvider, SearchProvider, TranscriptProvider } from "@/lib/providers/types";
import { hasDb } from "@/db";
import { InMemoryPipelineRunStore, type PipelineRunStore } from "@/queue/pipeline-runner";
import { DrizzlePipelineRunStore } from "@/queue/store";
import type { EngineMode } from "./llm-json";
import { getScriptEventBus, type ScriptEventBus } from "./events";
import { getEngineStore, type EngineStore } from "./store";

/**
 * EngineDeps — everything A2's pipelines and impls need, injectable so tests
 * run against in-memory stores and custom providers with zero env.
 */
export interface EngineDeps {
  mode: EngineMode;
  llm: LlmProvider;
  search: SearchProvider;
  transcript: TranscriptProvider;
  store: EngineStore;
  runs: PipelineRunStore;
  events: ScriptEventBus;
}

let cachedRuns: PipelineRunStore | undefined;

function getRunStore(): PipelineRunStore {
  cachedRuns ??= hasDb() ? new DrizzlePipelineRunStore() : new InMemoryPipelineRunStore();
  return cachedRuns;
}

let cachedDeps: EngineDeps | undefined;

export async function getEngineDeps(): Promise<EngineDeps> {
  if (cachedDeps === undefined) {
    const providers = await getProviders();
    cachedDeps = {
      mode: getConfig().PROVIDERS,
      llm: providers.llm,
      search: providers.search,
      transcript: providers.transcript,
      store: getEngineStore(),
      runs: getRunStore(),
      events: getScriptEventBus(),
    };
  }
  return cachedDeps;
}

export function setEngineDepsForTests(deps: EngineDeps | undefined): void {
  cachedDeps = deps;
  cachedRuns = undefined;
}
