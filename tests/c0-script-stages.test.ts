import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { resetConfigForTests } from "@/lib/config";
import { FIXTURE_IDS, fixtureFrame, fixtureProject } from "@/lib/fixtures";
import { scriptContracts } from "@/lib/types/api";
import { setEngineDepsForTests } from "@/pipelines/script/deps";
import { setStageDepsForTests } from "@/pipelines/stages/deps";
import { setPartnerSourceForTests } from "@/pipelines/stages/partners";
import { resolveStyleCard } from "@/pipelines/stages/style-resolver";
import { CREDIT_COSTS } from "@/server/credits";
import { scriptStagesImpl } from "@/server/routers/impl/script-stages";
import {
  getSharedWorkspaceStore,
  resetSharedWorkspaceStoreForTests,
} from "@/server/workspace/memory";
import { generationTargetSchema } from "@/lib/types/entities";
import { fixtureCtx } from "./a2-helpers";
import { makeStageDeps } from "./c1-helpers";

/**
 * Wave C: staged script procedures (PRODUCT-CONTRACTS §4) — since C1, the
 * REAL staged pipeline. Verifies: contract-valid outputs, per-stage credit
 * gating + itemized idempotency-keyed ledger entries, and the mode guards
 * (partnered_named flag, train_on_my_channel not built).
 */

type Deps = ReturnType<typeof makeStageDeps>;
let deps: Deps;

beforeEach(() => {
  resetSharedWorkspaceStoreForTests();
  deps = makeStageDeps();
  setEngineDepsForTests(deps.engine);
  setStageDepsForTests(deps);
  setPartnerSourceForTests(deps.partners);
});
afterEach(() => {
  resetSharedWorkspaceStoreForTests();
  setEngineDepsForTests(undefined);
  setStageDepsForTests(undefined);
  setPartnerSourceForTests(undefined);
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
  it("returns contract-valid topics and charges 1 credit, itemized + keyed", async () => {
    const out = await scriptStagesImpl.topics({ ctx: fixtureCtx, input: topicsInput() });
    expect(() => scriptContracts.topics.output.parse(out)).not.toThrow();
    expect(out.topics).toHaveLength(5);
    expect(deps.engine.store.creditEntries).toHaveLength(1);
    expect(deps.engine.store.creditEntries[0]).toMatchObject({
      delta: -CREDIT_COSTS.scriptTopics,
      reason: "script_topics",
      actorUserId: FIXTURE_IDS.user,
    });
    expect(deps.engine.store.creditEntries[0]?.idempotencyKey).toMatch(/^topics:/);
    // The stage persisted a pipeline_runs row under the §4 stage name.
    const rows = deps.engine.runs.rows.filter((r) => r.stage === "topics");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("done");
  });

  it("binds topics to the channel niche", async () => {
    const out = await scriptStagesImpl.topics({ ctx: fixtureCtx, input: topicsInput() });
    // Fixture channel niche: home espresso / coffee gear / latte art.
    const text = out.topics.map((t) => `${t.title} ${t.angle} ${t.rationale}`).join(" ");
    expect(/espresso|coffee|latte/i.test(text)).toBe(true);
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
    // Identical re-run: the completion charge is idempotency-keyed — one entry.
    expect(deps.engine.store.creditEntries).toHaveLength(1);
  });

  it("rejects dispatch without credits (no ledger entry written)", async () => {
    setFixtureBalance(0);
    const err = await scriptStagesImpl
      .topics({ ctx: fixtureCtx, input: topicsInput() })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("PRECONDITION_FAILED");
    expect(deps.engine.store.creditEntries).toHaveLength(0);
  });

  it("unknown channel is NOT_FOUND and never charged", async () => {
    const input = topicsInput({ channelId: "00000000-0000-4000-8000-0000000000fe" });
    const err = await scriptStagesImpl.topics({ ctx: fixtureCtx, input }).catch((e: unknown) => e);
    expect((err as TRPCError).code).toBe("NOT_FOUND");
    expect(deps.engine.store.creditEntries).toHaveLength(0);
  });
});

describe("script.outline / script.hooks", () => {
  it("outline: contract-valid, steered by topic, charges 1 credit keyed", async () => {
    const input = scriptContracts.outline.input.parse({
      workspaceId: FIXTURE_IDS.workspace,
      projectId: fixtureProject.id,
      topic: { title: "The $40 fix", angle: "One cheap part closes most of the gap" },
      generation: archetypeGen,
    });
    const out = await scriptStagesImpl.outline({ ctx: fixtureCtx, input });
    expect(() => scriptContracts.outline.output.parse(out)).not.toThrow();
    expect(out.outline.sections.some((s) => s.kind === "hook")).toBe(true);
    expect(deps.engine.store.creditEntries).toHaveLength(1);
    expect(deps.engine.store.creditEntries[0]?.delta).toBe(-CREDIT_COSTS.scriptOutline);
    expect(deps.engine.store.creditEntries[0]?.idempotencyKey).toMatch(/^outline:/);
  });

  it("outline honors the card's pacing.sectionSeconds and target length", async () => {
    const input = scriptContracts.outline.input.parse({
      workspaceId: FIXTURE_IDS.workspace,
      projectId: fixtureProject.id,
      // high-stakes-challenge: sectionSeconds 60 — more, shorter chapters.
      generation: { mode: "archetype", archetypeId: "high-stakes-challenge" },
    });
    const out = await scriptStagesImpl.outline({ ctx: fixtureCtx, input });
    const total = out.outline.sections.reduce((sum, s) => sum + s.targetSeconds, 0);
    const target = fixtureFrame.targetMinutes * 60;
    expect(Math.abs(total - target) / target).toBeLessThanOrEqual(0.1);
    const chapters = out.outline.sections.filter((s) => s.kind === "chapter");
    const avg = chapters.reduce((sum, s) => sum + s.targetSeconds, 0) / chapters.length;
    expect(avg).toBeGreaterThanOrEqual(40);
    expect(avg).toBeLessThanOrEqual(90);
  });

  it("outline: unknown project is NOT_FOUND and never charged", async () => {
    const input = scriptContracts.outline.input.parse({
      workspaceId: FIXTURE_IDS.workspace,
      projectId: "00000000-0000-4000-8000-0000000000ff",
    });
    const err = await scriptStagesImpl.outline({ ctx: fixtureCtx, input }).catch((e: unknown) => e);
    expect((err as TRPCError).code).toBe("NOT_FOUND");
    expect(deps.engine.store.creditEntries).toHaveLength(0);
  });

  it("hooks: exactly 3 tagged candidates constrained to the card, 1 credit", async () => {
    const input = scriptContracts.hooks.input.parse({
      workspaceId: FIXTURE_IDS.workspace,
      projectId: fixtureProject.id,
      generation: archetypeGen,
    });
    const out = await scriptStagesImpl.hooks({ ctx: fixtureCtx, input });
    expect(() => scriptContracts.hooks.output.parse(out)).not.toThrow();
    expect(out.hooks).toHaveLength(3);
    expect(out.hooks.filter((h) => h.autoPicked)).toHaveLength(1);
    // calm-explainer allows open_loop + bold_claim only; preference = open_loop.
    for (const hook of out.hooks) {
      expect(["open_loop", "bold_claim"]).toContain(hook.style);
    }
    expect(out.hooks.find((h) => h.autoPicked)?.style).toBe("open_loop");
    expect(deps.engine.store.creditEntries[0]?.delta).toBe(-CREDIT_COSTS.scriptHooks);
    expect(deps.engine.store.creditEntries[0]?.idempotencyKey).toMatch(/^hooks:/);
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

    const script = await deps.engine.store.getScript(fixtureCtx.workspaceId, out.scriptId);
    expect(script?.status).toBe("final");
    expect(script?.generationMode).toBe("archetype");
    expect(script?.archetypeId).toBe("calm-explainer");
    const sections = await deps.engine.store.listSections(fixtureCtx.workspaceId, out.scriptId);
    expect(sections.length).toBeGreaterThanOrEqual(3);
    const report = deps.engine.store.getCachedQualityReport(out.scriptId);
    expect(report?.styleGates).not.toBeNull();
    expect(report?.styleGates?.bannedClaimsOk).toBe(true);
    // C1: no style sub-gate is left null when a card exists.
    expect(report?.styleGates?.hookPatternOk).toBe(true);
    expect(report?.styleGates?.readingLevelOk).not.toBeNull();
    expect(report?.styleGates?.readingGrade).not.toBeNull();
    expect(deps.engine.store.getHookCandidates(out.scriptId)).not.toBeNull();
    expect(deps.engine.store.creditEntries).toHaveLength(1);
    expect(deps.engine.store.creditEntries[0]?.delta).toBe(-CREDIT_COSTS.scriptDraft);
    expect(deps.engine.store.creditEntries[0]?.idempotencyKey).toMatch(/^draft:/);
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
    const sections = await deps.engine.store.listSections(fixtureCtx.workspaceId, out.scriptId);
    expect(sections.find((s) => s.kind === "hook")?.body).toBe(hook.body);
  });

  it("rejects a chosen hook whose technique the card forbids (no charge)", async () => {
    const input = scriptContracts.draft.input.parse({
      workspaceId: FIXTURE_IDS.workspace,
      projectId: fixtureProject.id,
      frameId: fixtureFrame.id,
      // calm-explainer allows open_loop/bold_claim — in_medias_res is out.
      hook: { style: "in_medias_res", body: "Round three. Chaos.", autoPicked: true },
      generation: archetypeGen,
    });
    const err = await scriptStagesImpl.draft({ ctx: fixtureCtx, input }).catch((e: unknown) => e);
    expect((err as TRPCError).code).toBe("BAD_REQUEST");
    expect(deps.engine.store.creditEntries).toHaveLength(0);
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
    expect(deps.engine.store.creditEntries).toHaveLength(0);
  });

  it("rejects train_on_my_channel (enum-only this wave)", async () => {
    const input = topicsInput({
      generation: { mode: "train_on_my_channel", voiceProfileId: FIXTURE_IDS.voiceProfile },
    });
    const err = await scriptStagesImpl.topics({ ctx: fixtureCtx, input }).catch((e: unknown) => e);
    expect((err as TRPCError).code).toBe("NOT_IMPLEMENTED");
  });

  it("with the flag on, an unknown partner is NOT_FOUND (registry empty)", async () => {
    process.env.FEATURE_PARTNERED_NAMED = "true";
    resetConfigForTests();
    const generation = generationTargetSchema.parse({
      mode: "partnered_named",
      partnerId: FIXTURE_IDS.partner,
    });
    const err = await resolveStyleCard(generation, null, deps.partners).catch((e: unknown) => e);
    expect((err as TRPCError).code).toBe("NOT_FOUND");
  });

  it("crossover resolves a deterministic merge favoring the heavier archetype", async () => {
    const generation = generationTargetSchema.parse({
      mode: "crossover",
      crossover: { a: "hype-gamer", b: "calm-explainer", weightA: 0.2 },
    });
    const card = await resolveStyleCard(generation, null, deps.partners);
    // calm-explainer carries weight 0.8 — its surface fields win the merge.
    expect(card?.thumbnailPresetId).toBe("calm-explainer");
  });
});
