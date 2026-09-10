import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureFrame, fixtureProject, fixtureVoiceProfile } from "@/lib/fixtures";
import { SCRIPT_STAGES, type ScriptStreamEvent } from "@/lib/types/pipeline";
import { isTerminalEvent } from "@/pipelines/script/events";
import { runScriptPipeline } from "@/pipelines/script/pipeline";
import { resetBillingStoreForTests } from "@/server/billing/store";
import {
  getSharedWorkspaceStore,
  resetSharedWorkspaceStoreForTests,
} from "@/server/workspace/memory";
import { makeDeps, fixtureCtx } from "./a2-helpers";

/**
 * Wave-C adversarial F1: the completion charge is attempted on EVERY
 * completed run (idempotent by ledger key) and the script surfaces as
 * `final` only after the charge lands — a crash or balance-floor bounce
 * between the last stage and the charge can never yield a finished, free,
 * final script on the BullMQ retry.
 */

type Deps = ReturnType<typeof makeDeps>;

const pipelineParams = (deps: Deps, scriptId: Parameters<typeof runScriptPipeline>[1]["scriptId"]) =>
  ({
    input: {
      workspaceId: fixtureCtx.workspaceId,
      projectId: fixtureProject.id,
      frameId: fixtureFrame.id,
      voiceProfileId: fixtureVoiceProfile.id,
      generation: null,
    },
    scriptId,
    actorUserId: fixtureCtx.userId,
  }) as const;

function setBalance(value: number): void {
  const workspace = getSharedWorkspaceStore().workspaces.find(
    (w) => w.id === fixtureCtx.workspaceId,
  );
  if (workspace === undefined) throw new Error("fixture workspace missing");
  workspace.creditBalance = value;
  workspace.plan = "free"; // no overage rescue unless a test opts in
}

/** The shape Postgres raises when the balance-floor CHECK rejects a debit. */
const floorViolation = () =>
  Object.assign(
    new Error('update on "workspaces" violates check constraint "workspaces_credit_balance_floor"'),
    { code: "23514" },
  );

async function firstTerminalRun(deps: Deps, scriptId: string): Promise<ScriptStreamEvent[]> {
  const events: ScriptStreamEvent[] = [];
  for await (const event of deps.events.subscribe(scriptId)) {
    events.push(event);
    if (isTerminalEvent(event)) break;
  }
  return events;
}

beforeEach(() => {
  resetSharedWorkspaceStoreForTests();
  resetBillingStoreForTests();
});
afterEach(() => {
  vi.restoreAllMocks();
  resetSharedWorkspaceStoreForTests();
  resetBillingStoreForTests();
});

describe("completion charge is never skippable (F1)", () => {
  it("crash after the last stage, before the charge: retry charges exactly once and finalizes", async () => {
    const deps = makeDeps();
    const script = await deps.store.createScript({
      workspaceId: fixtureCtx.workspaceId,
      projectId: fixtureProject.id,
      voiceProfileId: fixtureVoiceProfile.id,
    });
    const params = pipelineParams(deps, script.id);

    vi.spyOn(deps.store, "recordCredits").mockRejectedValueOnce(
      new Error("connection reset before ledger write"),
    );
    const first = await runScriptPipeline(deps, params);
    expect(first.status).toBe("failed");
    expect(deps.store.creditEntries).toHaveLength(0);
    // The unpaid script must not surface as final, and the stream must end
    // in `failed`, not `complete`.
    expect((await deps.store.getScript(fixtureCtx.workspaceId, script.id))?.status).not.toBe(
      "final",
    );
    const events = await firstTerminalRun(deps, script.id);
    expect(events.at(-1)?.type).toBe("failed");

    // BullMQ retry: every stage resumes as done; the charge is re-attempted.
    const second = await runScriptPipeline(deps, params);
    expect(second.status).toBe("done");
    if (second.status === "done") expect(second.skippedStages).toEqual([...SCRIPT_STAGES]);
    expect(deps.store.creditEntries).toEqual([
      expect.objectContaining({ delta: -6, reason: "script_generation" }),
    ]);
    expect((await deps.store.getScript(fixtureCtx.workspaceId, script.id))?.status).toBe("final");
  });

  it("balance-floor bounce fails the run cleanly; credits added + retry → charged once, final", async () => {
    const deps = makeDeps();
    setBalance(0); // free plan, nothing to overage-meter
    const script = await deps.store.createScript({
      workspaceId: fixtureCtx.workspaceId,
      projectId: fixtureProject.id,
      voiceProfileId: fixtureVoiceProfile.id,
    });
    const params = pipelineParams(deps, script.id);

    const original = deps.store.recordCredits.bind(deps.store);
    vi.spyOn(deps.store, "recordCredits").mockImplementation((record) => {
      const workspace = getSharedWorkspaceStore().get(fixtureCtx.workspaceId);
      if ((workspace?.creditBalance ?? 0) + record.delta < 0) {
        return Promise.reject(floorViolation());
      }
      return original(record);
    });

    const first = await runScriptPipeline(deps, params);
    expect(first.status).toBe("failed");
    if (first.status === "failed") expect(first.error).toMatch(/Not enough credits/);
    expect(deps.store.creditEntries).toHaveLength(0);
    expect((await deps.store.getScript(fixtureCtx.workspaceId, script.id))?.status).not.toBe(
      "final",
    );

    // Credits purchased → the retry pays and finalizes without new work.
    const workspace = getSharedWorkspaceStore().workspaces.find(
      (w) => w.id === fixtureCtx.workspaceId,
    );
    if (workspace !== undefined) workspace.creditBalance = 20;
    const second = await runScriptPipeline(deps, params);
    expect(second.status).toBe("done");
    if (second.status === "done") expect(second.skippedStages).toEqual([...SCRIPT_STAGES]);
    expect(deps.store.creditEntries).toHaveLength(1);
    expect((await deps.store.getScript(fixtureCtx.workspaceId, script.id))?.status).toBe("final");
  });

  it("a genuine identical re-run dedupes on the ledger key — no second charge", async () => {
    const deps = makeDeps();
    const script = await deps.store.createScript({
      workspaceId: fixtureCtx.workspaceId,
      projectId: fixtureProject.id,
      voiceProfileId: fixtureVoiceProfile.id,
    });
    const params = pipelineParams(deps, script.id);

    const first = await runScriptPipeline(deps, params);
    expect(first.status).toBe("done");
    const second = await runScriptPipeline(deps, params);
    expect(second.status).toBe("done");
    expect(deps.store.creditEntries).toHaveLength(1);
    expect((await deps.store.getScript(fixtureCtx.workspaceId, script.id))?.status).toBe("final");
  });
});
