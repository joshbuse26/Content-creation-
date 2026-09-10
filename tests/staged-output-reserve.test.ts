import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { FIXTURE_IDS, fixtureProject } from "@/lib/fixtures";
import { scriptContracts } from "@/lib/types/api";
import { runMeteredSyncStage } from "@/pipelines/stages/run";
import { setEngineDepsForTests } from "@/pipelines/script/deps";
import { setStageDepsForTests } from "@/pipelines/stages/deps";
import { setPartnerSourceForTests } from "@/pipelines/stages/partners";
import { getBillingStore, resetBillingStoreForTests } from "@/server/billing/store";
import { scriptStagesImpl } from "@/server/routers/impl/script-stages";
import {
  getSharedWorkspaceStore,
  resetSharedWorkspaceStoreForTests,
} from "@/server/workspace/memory";
import type { InMemoryBillingStore } from "@/server/billing/store";
import { makeDeps, fixtureCtx } from "./a2-helpers";
import { makeStageDeps } from "./c1-helpers";

/**
 * Wave-C adversarial F2 + F5 — staged sync stages
 * (`script.topics/outline/hooks`):
 *
 *  - F2: an identical re-submit RE-SERVES the persisted pipeline_runs.output
 *    (zero compute → zero live LLM calls) instead of recomputing; legacy
 *    rows without a persisted output recompute exactly once, then persist.
 *  - F2 (hash): the topics prompt consumes the outlier snapshot, so the
 *    snapshot is folded into the run's input hash — fresher outliers are a
 *    new metered run, not a stale re-serve.
 *  - F5: a completion charge that bounces off the balance-floor CHECK
 *    routes through the overage path when the plan allows, else fails with
 *    the typed PRECONDITION_FAILED — and the retry re-serves the persisted
 *    output and re-attempts only the charge.
 */

const floorViolation = () =>
  Object.assign(
    new Error('update on "workspaces" violates check constraint "workspaces_credit_balance_floor"'),
    { code: "23514" },
  );

function workspace() {
  const row = getSharedWorkspaceStore().workspaces.find((w) => w.id === fixtureCtx.workspaceId);
  if (row === undefined) throw new Error("fixture workspace missing");
  return row;
}

beforeEach(() => {
  resetSharedWorkspaceStoreForTests();
  resetBillingStoreForTests();
});
afterEach(() => {
  vi.restoreAllMocks();
  resetSharedWorkspaceStoreForTests();
  resetBillingStoreForTests();
  setEngineDepsForTests(undefined);
  setStageDepsForTests(undefined);
  setPartnerSourceForTests(undefined);
});

describe("persisted stage outputs (F2)", () => {
  it("identical re-submit re-serves the persisted output: zero recomputes, same result, one charge", async () => {
    const deps = makeDeps();
    let computeCalls = 0;
    const params = {
      deps,
      stage: "outline" as const,
      workspaceId: fixtureCtx.workspaceId,
      projectId: fixtureProject.id,
      input: { probe: "same" },
      cost: 1,
      actorUserId: null,
      compute: () => {
        computeCalls += 1;
        return Promise.resolve({ sections: [`computed-${String(computeCalls)}`] });
      },
    };
    const first = await runMeteredSyncStage(params);
    const second = await runMeteredSyncStage(params);
    expect(computeCalls).toBe(1); // no recompute ⇒ no live LLM call
    expect(second).toEqual(first);
    expect(deps.store.creditEntries).toHaveLength(1);
    // The output landed on the done run row.
    expect(deps.runs.rows[0]?.output).toEqual(first);
  });

  it("a legacy done row (no persisted output) recomputes ONCE, persists, then re-serves", async () => {
    const deps = makeDeps();
    let computeCalls = 0;
    const params = {
      deps,
      stage: "hooks" as const,
      workspaceId: fixtureCtx.workspaceId,
      projectId: fixtureProject.id,
      input: { probe: "legacy" },
      cost: 1,
      actorUserId: null,
      compute: () => {
        computeCalls += 1;
        return Promise.resolve({ hooks: ["h"] });
      },
    };
    await runMeteredSyncStage(params);
    // Simulate a row written before pipeline_runs.output existed.
    const row = deps.runs.rows[0];
    if (row === undefined) throw new Error("no run row persisted");
    row.output = null;

    await runMeteredSyncStage(params);
    expect(computeCalls).toBe(2); // the one allowed legacy recompute
    expect(row.output).toEqual({ hooks: ["h"] });

    await runMeteredSyncStage(params);
    expect(computeCalls).toBe(2); // now served from the persisted output
    expect(deps.store.creditEntries).toHaveLength(1);
  });

  it("topics: a refreshed outlier snapshot is a NEW run; an unchanged one re-serves free", async () => {
    const deps = makeStageDeps();
    setEngineDepsForTests(deps.engine);
    setStageDepsForTests(deps);
    setPartnerSourceForTests(deps.partners);
    const input = scriptContracts.topics.input.parse({
      workspaceId: FIXTURE_IDS.workspace,
      channelId: FIXTURE_IDS.channel,
    });

    const first = await scriptStagesImpl.topics({ ctx: fixtureCtx, input });
    expect(deps.engine.store.creditEntries).toHaveLength(1);

    // Unchanged snapshot → same hash → re-served, still one charge.
    const again = await scriptStagesImpl.topics({ ctx: fixtureCtx, input });
    expect(again).toEqual(first);
    expect(deps.engine.store.creditEntries).toHaveLength(1);

    // The niche refreshed: a new outlier now tops the snapshot — the same
    // request input is a DIFFERENT run (the prompt consumes the outliers).
    await deps.ideation.upsertNicheVideos([
      {
        youtubeVideoId: "dQfresh0001",
        channelYtid: "UCother00000000000000002",
        title: "This $40 Grinder Beats Machines 10x Its Price",
        thumbnailUrl: null,
        publishedAt: new Date("2026-09-01T12:00:00.000Z"),
        viewCount: 900_000,
        channelMedianViews: 30_000,
        outlierRatio: 30,
        formatTags: ["test"],
        nicheKeywords: ["coffee gear"],
        lastRefreshedAt: new Date("2026-09-09T00:00:00.000Z"),
      },
    ]);
    await scriptStagesImpl.topics({ ctx: fixtureCtx, input });
    expect(deps.engine.store.creditEntries).toHaveLength(2);
  });
});

describe("balance-floor bounce at stage completion (F5)", () => {
  function stubFloorSensitiveLedger(deps: ReturnType<typeof makeDeps>): void {
    const original = deps.store.recordCredits.bind(deps.store);
    vi.spyOn(deps.store, "recordCredits").mockImplementation((record) => {
      if (workspace().creditBalance + record.delta < 0) {
        return Promise.reject(floorViolation());
      }
      return original(record);
    });
  }

  it("free plan: typed PRECONDITION_FAILED; after credits arrive the retry re-serves + charges", async () => {
    const deps = makeDeps();
    workspace().plan = "free";
    workspace().creditBalance = 0;
    stubFloorSensitiveLedger(deps);
    let computeCalls = 0;
    const params = {
      deps,
      stage: "outline" as const,
      workspaceId: fixtureCtx.workspaceId,
      projectId: fixtureProject.id,
      input: { probe: "floor" },
      cost: 1,
      actorUserId: null,
      compute: () => {
        computeCalls += 1;
        return Promise.resolve({ sections: ["s"] });
      },
    };

    const err = await runMeteredSyncStage(params).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("PRECONDITION_FAILED");
    expect(computeCalls).toBe(1); // the work ran; only the charge bounced
    expect(deps.store.creditEntries).toHaveLength(0);

    workspace().creditBalance = 10;
    const result = await runMeteredSyncStage(params);
    expect(result).toEqual({ sections: ["s"] });
    expect(computeCalls).toBe(1); // retry re-served the persisted output
    expect(deps.store.creditEntries).toHaveLength(1);
  });

  it("paid plan with a Stripe customer: the shortfall is metered as overage and the charge lands", async () => {
    const deps = makeDeps();
    workspace().plan = "starter";
    workspace().creditBalance = 0;
    const billing = getBillingStore() as InMemoryBillingStore;
    await billing.updateBilling(fixtureCtx.workspaceId, { stripeCustomerId: "cus_stage_test" });
    stubFloorSensitiveLedger(deps);
    let computeCalls = 0;

    const result = await runMeteredSyncStage({
      deps,
      stage: "hooks" as const,
      workspaceId: fixtureCtx.workspaceId,
      projectId: fixtureProject.id,
      input: { probe: "overage" },
      cost: 1,
      actorUserId: null,
      compute: () => {
        computeCalls += 1;
        return Promise.resolve({ hooks: ["h"] });
      },
    });
    expect(result).toEqual({ hooks: ["h"] });
    expect(computeCalls).toBe(1);
    // The overage grant covered the shortfall, then the charge landed.
    expect(billing.ledger).toEqual([
      expect.objectContaining({ delta: 1, reason: "overage" }),
    ]);
    expect(deps.store.creditEntries).toHaveLength(1);
    expect((await billing.getWorkspace(fixtureCtx.workspaceId))?.overageUsed).toBe(1);
  });
});
