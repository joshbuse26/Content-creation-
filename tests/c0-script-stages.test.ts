import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { resetConfigForTests } from "@/lib/config";
import { FIXTURE_IDS, fixtureFrame, fixtureProject } from "@/lib/fixtures";
import { scriptContracts } from "@/lib/types/api";
import { setEngineDepsForTests } from "@/pipelines/script/deps";
import { CREDIT_COSTS } from "@/server/credits";
import { scriptStagesImpl, resolveStubStyleCard } from "@/server/routers/impl/script-stages";
import {
  getSharedWorkspaceStore,
  resetSharedWorkspaceStoreForTests,
} from "@/server/workspace/memory";
import { generationTargetSchema } from "@/lib/types/entities";
import { makeDeps, fixtureCtx } from "./a2-helpers";

/**
 * Wave C (C0): staged script procedures (PRODUCT-CONTRACTS §4) — contract
 * stubs. Verifies: contract-valid outputs, per-stage credit gating +
 * itemized ledger entries, and the mode guards (partnered_named flag,
 * train_on_my_channel not built).
 */

type Deps = ReturnType<typeof makeDeps>;
let deps: Deps;

beforeEach(() => {
  resetSharedWorkspaceStoreForTests();
  deps = makeDeps();
  setEngineDepsForTests(deps);
});
afterEach(() => {
  resetSharedWorkspaceStoreForTests();
  setEngineDepsForTests(undefined);
  delete process.env.FEATURE_PARTNERED_NAMED;
  resetConfigForTests();
});

function setFixtureBalance(balance: number): void {
  const workspace = getSharedWorkspaceStore().workspaces.find(
    (w) => w.id === FIXTURE_IDS.workspace,
  );
  if (workspace === undefined) throw new Error("fixture workspace missing");
  workspace.creditBalance = balance;
}

const archetypeGen = { mode: "archetype", archetypeId: "calm-explainer" };

const topicsInput = (over: Record<string, unknown> = {}) =>
  scriptContracts.topics.input.parse({
    workspaceId: FIXTURE_IDS.workspace,
    channelId: FIXTURE_IDS.channel,
    ...over,
  });

describe("script.topics", () => {
  it("returns contract-valid topics and charges 1 credit, itemized", async () => {
    const out = await scriptStagesImpl.topics({ ctx: fixtureCtx, input: topicsInput() });
    expect(() => scriptContracts.topics.output.parse(out)).not.toThrow();
    expect(out.topics).toHaveLength(5);
    expect(deps.store.creditEntries).toHaveLength(1);
    expect(deps.store.creditEntries[0]).toMatchObject({
      delta: -CREDIT_COSTS.scriptTopics,
      reason: "script_generation",
      actorUserId: FIXTURE_IDS.user,
    });
  });

  it("is deterministic and archetype-sensitive", async () => {
    const a1 = await scriptStagesImpl.topics({
      ctx: fixtureCtx,
      input: topicsInput({ generation: archetypeGen }),
    });
    const a2 = await scriptStagesImpl.topics({
      ctx: fixtureCtx,
      input: topicsInput({ generation: archetypeGen }),
    });
    expect(a1).toEqual(a2);
  });

  it("rejects dispatch without credits (no ledger entry written)", async () => {
    setFixtureBalance(0);
    const err = await scriptStagesImpl
      .topics({ ctx: fixtureCtx, input: topicsInput() })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("PRECONDITION_FAILED");
    expect(deps.store.creditEntries).toHaveLength(0);
  });
});

describe("script.outline / script.hooks", () => {
  it("outline: contract-valid, steered by topic, charges 1 credit", async () => {
    const input = scriptContracts.outline.input.parse({
      workspaceId: FIXTURE_IDS.workspace,
      projectId: fixtureProject.id,
      topic: { title: "The $40 fix", angle: "One cheap part closes most of the gap" },
      generation: archetypeGen,
    });
    const out = await scriptStagesImpl.outline({ ctx: fixtureCtx, input });
    expect(() => scriptContracts.outline.output.parse(out)).not.toThrow();
    expect(out.outline.sections.some((s) => s.kind === "hook")).toBe(true);
    expect(deps.store.creditEntries).toHaveLength(1);
    expect(deps.store.creditEntries[0]?.delta).toBe(-CREDIT_COSTS.scriptOutline);
  });

  it("outline: unknown project is NOT_FOUND and never charged", async () => {
    const input = scriptContracts.outline.input.parse({
      workspaceId: FIXTURE_IDS.workspace,
      projectId: "00000000-0000-4000-8000-0000000000ff",
    });
    const err = await scriptStagesImpl.outline({ ctx: fixtureCtx, input }).catch((e: unknown) => e);
    expect((err as TRPCError).code).toBe("NOT_FOUND");
    expect(deps.store.creditEntries).toHaveLength(0);
  });

  it("hooks: exactly 3 tagged candidates, one auto-picked, 1 credit", async () => {
    const input = scriptContracts.hooks.input.parse({
      workspaceId: FIXTURE_IDS.workspace,
      projectId: fixtureProject.id,
      generation: archetypeGen,
    });
    const out = await scriptStagesImpl.hooks({ ctx: fixtureCtx, input });
    expect(() => scriptContracts.hooks.output.parse(out)).not.toThrow();
    expect(out.hooks).toHaveLength(3);
    expect(out.hooks.filter((h) => h.autoPicked)).toHaveLength(1);
    expect(deps.store.creditEntries[0]?.delta).toBe(-CREDIT_COSTS.scriptHooks);
  });
});

describe("script.draft", () => {
  it("creates a final script with sections, mode fields, style gates; charges 4", async () => {
    const input = scriptContracts.draft.input.parse({
      workspaceId: FIXTURE_IDS.workspace,
      projectId: fixtureProject.id,
      frameId: fixtureFrame.id,
      generation: archetypeGen,
    });
    const out = await scriptStagesImpl.draft({ ctx: fixtureCtx, input });
    expect(() => scriptContracts.draft.output.parse(out)).not.toThrow();

    const script = await deps.store.getScript(fixtureCtx.workspaceId, out.scriptId);
    expect(script?.status).toBe("final");
    expect(script?.generationMode).toBe("archetype");
    expect(script?.archetypeId).toBe("calm-explainer");
    const sections = await deps.store.listSections(fixtureCtx.workspaceId, out.scriptId);
    expect(sections.length).toBeGreaterThanOrEqual(3);
    const report = deps.store.getCachedQualityReport(out.scriptId);
    expect(report?.styleGates).not.toBeNull();
    expect(report?.styleGates?.bannedClaimsOk).toBe(true);
    expect(deps.store.getHookCandidates(out.scriptId)).toHaveLength(3);
    expect(deps.store.creditEntries[0]?.delta).toBe(-CREDIT_COSTS.scriptDraft);
  });

  it("uses the chosen hook body for the hook section", async () => {
    const hook = { style: "bold_claim", body: "My chosen hook body, verbatim.", autoPicked: true };
    const input = scriptContracts.draft.input.parse({
      workspaceId: FIXTURE_IDS.workspace,
      projectId: fixtureProject.id,
      frameId: fixtureFrame.id,
      hook,
    });
    const out = await scriptStagesImpl.draft({ ctx: fixtureCtx, input });
    const sections = await deps.store.listSections(fixtureCtx.workspaceId, out.scriptId);
    expect(sections.find((s) => s.kind === "hook")?.body).toBe(hook.body);
  });

  it("stage costs sum to the composite scriptGeneration cost", () => {
    expect(CREDIT_COSTS.scriptOutline + CREDIT_COSTS.scriptHooks + CREDIT_COSTS.scriptDraft).toBe(
      CREDIT_COSTS.scriptGeneration,
    );
  });
});

describe("mode guards", () => {
  it("rejects partnered_named while FEATURE_PARTNERED_NAMED is off (default)", async () => {
    const input = topicsInput({
      generation: { mode: "partnered_named", partnerId: FIXTURE_IDS.partner },
    });
    const err = await scriptStagesImpl.topics({ ctx: fixtureCtx, input }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("FORBIDDEN");
    expect(deps.store.creditEntries).toHaveLength(0);
  });

  it("rejects train_on_my_channel (enum-only this wave)", async () => {
    const input = topicsInput({
      generation: { mode: "train_on_my_channel", voiceProfileId: FIXTURE_IDS.voiceProfile },
    });
    const err = await scriptStagesImpl.topics({ ctx: fixtureCtx, input }).catch((e: unknown) => e);
    expect((err as TRPCError).code).toBe("NOT_IMPLEMENTED");
  });

  it("with the flag on, partnered_named passes the guard but partner resolution is C1's", () => {
    process.env.FEATURE_PARTNERED_NAMED = "true";
    resetConfigForTests();
    const generation = generationTargetSchema.parse({
      mode: "partnered_named",
      partnerId: FIXTURE_IDS.partner,
    });
    expect(() => resolveStubStyleCard(generation, null)).toThrow(/not implemented/i);
  });

  it("crossover resolves the heavier archetype's card in the stub", () => {
    const generation = generationTargetSchema.parse({
      mode: "crossover",
      crossover: { a: "hype-gamer", b: "calm-explainer", weightA: 0.2 },
    });
    const card = resolveStubStyleCard(generation, null);
    // calm-explainer carries weight 0.8 — its card wins in the stub merge.
    expect(card?.thumbnailPresetId).toBe("calm-explainer");
  });
});
