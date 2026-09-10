import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { FIXTURE_IDS, fixtureFrame, fixtureProject, fixtureWorkspace } from "@/lib/fixtures";
import { setEngineDepsForTests } from "@/pipelines/script/deps";
import { runScriptPipeline } from "@/pipelines/script/pipeline";
import { stageInputHash } from "@/pipelines/script/hash";
import { RUN_ALREADY_IN_PROGRESS } from "@/queue/pipeline-runner";
import { CREDIT_COSTS, getCreditBalance, requireCredits } from "@/server/credits";
import { scriptImpl } from "@/server/routers/impl/script";
import {
  getSharedWorkspaceStore,
  resetSharedWorkspaceStoreForTests,
} from "@/server/workspace/memory";
import { makeDeps, fixtureCtx } from "./a2-helpers";

/**
 * Regression tests for the credit-safety fixes:
 * - requireCredits gates generation dispatch (insufficient → PRECONDITION_FAILED)
 * - completion charges are idempotent (retry / identical re-run → one entry)
 * - the runner claim refuses an identical run that is already running & fresh
 */

function setFixtureBalance(balance: number): void {
  const workspace = getSharedWorkspaceStore().workspaces.find(
    (w) => w.id === FIXTURE_IDS.workspace,
  );
  if (workspace === undefined) throw new Error("fixture workspace missing");
  workspace.creditBalance = balance;
}

const scriptInput = {
  workspaceId: fixtureCtx.workspaceId,
  projectId: fixtureProject.id,
  frameId: fixtureFrame.id,
  voiceProfileId: null,
};

describe("credit gating at dispatch", () => {
  beforeEach(() => {
    resetSharedWorkspaceStoreForTests();
  });
  afterEach(() => {
    resetSharedWorkspaceStoreForTests();
    setEngineDepsForTests(undefined);
  });

  it("reads the fixture workspace balance", async () => {
    await expect(getCreditBalance(fixtureCtx.workspaceId)).resolves.toBe(
      fixtureWorkspace.creditBalance,
    );
  });

  it("requireCredits passes when the balance covers the cost", async () => {
    await expect(requireCredits(fixtureCtx.workspaceId, 6)).resolves.toBeUndefined();
  });

  it("requireCredits throws PRECONDITION_FAILED at 0 credits", async () => {
    setFixtureBalance(0);
    await expect(requireCredits(fixtureCtx.workspaceId, 1)).rejects.toSatisfy(
      (err: unknown) => err instanceof TRPCError && err.code === "PRECONDITION_FAILED",
    );
  });

  it("script.generate rejects with PRECONDITION_FAILED when the workspace has 0 credits", async () => {
    setFixtureBalance(0);
    const deps = makeDeps();
    setEngineDepsForTests(deps);
    await expect(
      scriptImpl.generate({ ctx: fixtureCtx, input: scriptInput }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof TRPCError &&
        err.code === "PRECONDITION_FAILED" &&
        /credits/i.test(err.message),
    );
    // Nothing was created or charged.
    expect(deps.store.creditEntries).toHaveLength(0);
  });

  it("script.generate proceeds when the balance covers the cost", async () => {
    setFixtureBalance(CREDIT_COSTS.scriptGeneration);
    const deps = makeDeps();
    setEngineDepsForTests(deps);
    const result = await scriptImpl.generate({ ctx: fixtureCtx, input: scriptInput });
    expect(result.status).toBe("queued");
  });
});

describe("idempotent completion charges", () => {
  it("memory store records at most one ledger entry per idempotency key", async () => {
    const deps = makeDeps();
    const record = {
      workspaceId: fixtureCtx.workspaceId,
      delta: -6,
      reason: "script_generation" as const,
      actorUserId: null,
      projectId: fixtureProject.id,
      idempotencyKey: "script_generation:abc",
    };
    await deps.store.recordCredits(record);
    await deps.store.recordCredits(record);
    expect(deps.store.creditEntries).toHaveLength(1);
    // Entries without a key still always append (grants, refunds).
    await deps.store.recordCredits({ ...record, idempotencyKey: null });
    await deps.store.recordCredits({ ...record, idempotencyKey: null });
    expect(deps.store.creditEntries).toHaveLength(3);
  });

  it("an identical script re-run (simulated BullMQ retry) charges exactly once", async () => {
    const deps = makeDeps();
    const script = await deps.store.createScript({
      workspaceId: fixtureCtx.workspaceId,
      projectId: fixtureProject.id,
      voiceProfileId: null,
    });
    const params = { input: scriptInput, scriptId: script.id, actorUserId: null };

    const first = await runScriptPipeline(deps, params);
    expect(first.status).toBe("done");
    expect(first.skippedStages).toHaveLength(0);
    expect(deps.store.creditEntries).toHaveLength(1);

    // Retry with the identical payload: every stage resumes as done, no new
    // work happens, and no second charge is recorded.
    const second = await runScriptPipeline(deps, params);
    expect(second.status).toBe("done");
    expect(second.skippedStages.length).toBeGreaterThan(0);
    expect(deps.store.creditEntries).toHaveLength(1);
  });
});

describe("runner claim", () => {
  it("refuses to start while an identical run is running and fresh", async () => {
    const deps = makeDeps();
    const script = await deps.store.createScript({
      workspaceId: fixtureCtx.workspaceId,
      projectId: fixtureProject.id,
      voiceProfileId: null,
    });
    const params = { input: scriptInput, scriptId: script.id, actorUserId: null };
    const inputHash = stageInputHash({ input: scriptInput, scriptId: script.id });

    // Simulate a concurrent in-flight run: a fresh `running` stage row.
    const row = await deps.runs.create({
      workspaceId: fixtureCtx.workspaceId,
      projectId: fixtureProject.id,
      kind: "script",
      stage: "assemble_context",
      status: "queued",
      attempt: 1,
      inputHash,
      error: null,
      creditsCharged: 0,
    });
    await deps.runs.update(row.id, { status: "running" });

    const result = await runScriptPipeline(deps, params);
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error).toBe(RUN_ALREADY_IN_PROGRESS);
    }
    expect(deps.store.creditEntries).toHaveLength(0);

    // Once the concurrent row goes stale, the claim no longer blocks.
    deps.runs.setTouchedAtForTests(row.id, new Date(Date.now() - 10 * 60_000));
    const retried = await runScriptPipeline(deps, params);
    expect(retried.status).toBe("done");
    expect(deps.store.creditEntries).toHaveLength(1);
  });
});
