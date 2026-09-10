import { createFixtureProviders } from "@/lib/providers/fixture";
import { FIXTURE_IDS } from "@/lib/fixtures";
import { asUserId, workspaceIdSchema } from "@/lib/types/ids";
import { InProcessScriptEventBus } from "@/pipelines/script/events";
import type { EngineDeps } from "@/pipelines/script/deps";
import { InMemoryEngineStore } from "@/pipelines/script/store";
import { InMemoryPipelineRunStore } from "@/queue/pipeline-runner";
import type { WorkspaceHandlerCtx } from "@/server/routers/impl/_shared";

/** Fresh, fully in-memory EngineDeps for A2 tests — zero env, deterministic. */
export function makeDeps(): EngineDeps & {
  store: InMemoryEngineStore;
  runs: InMemoryPipelineRunStore;
  events: InProcessScriptEventBus;
} {
  const providers = createFixtureProviders();
  return {
    mode: "fixture",
    llm: providers.llm,
    search: providers.search,
    transcript: providers.transcript,
    store: new InMemoryEngineStore(),
    runs: new InMemoryPipelineRunStore(),
    events: new InProcessScriptEventBus(),
  };
}

export const fixtureCtx: WorkspaceHandlerCtx = {
  userId: asUserId(FIXTURE_IDS.user),
  workspaceId: workspaceIdSchema.parse(FIXTURE_IDS.workspace),
};
