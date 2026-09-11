import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { resetConfigForTests } from "@/lib/config";
import { FIXTURE_IDS, fixtureFrame, fixtureProject, fixtureVoiceProfile } from "@/lib/fixtures";
import { scriptContracts } from "@/lib/types/api";
import { asUserId, workspaceIdSchema } from "@/lib/types/ids";
import {
  SCRIPT_STAGES,
  scriptStreamEventSchema,
  type ScriptStreamEvent,
} from "@/lib/types/pipeline";
import { setEngineDepsForTests } from "@/pipelines/script/deps";
import { isTerminalEvent } from "@/pipelines/script/events";
import { handleGenerateScriptJob } from "@/pipelines/script/jobs";
import { setStageDepsForTests } from "@/pipelines/stages/deps";
import { setPartnerSourceForTests } from "@/pipelines/stages/partners";
import { CREDIT_COSTS } from "@/server/credits";
import { scriptImpl } from "@/server/routers/impl/script";
import { scriptStagesImpl } from "@/server/routers/impl/script-stages";
import type { WorkspaceHandlerCtx } from "@/server/routers/impl/_shared";
import {
  getSharedWorkspaceStore,
  resetSharedWorkspaceStoreForTests,
} from "@/server/workspace/memory";
import { fixtureCtx } from "./a2-helpers";
import { makeStageDeps } from "./c1-helpers";

/**
 * C1: the real staged pipeline — idempotent per-stage charges, partnered
 * mode behind the flag + partner record, draft SSE conformance to the
 * frozen event union, the `generate` orchestrator's itemized ledger, and
 * cross-workspace denial on all four stages.
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

const archetypeGen = { mode: "archetype", archetypeId: "high-stakes-challenge" };

async function collectEvents(scriptId: string): Promise<ScriptStreamEvent[]> {
  const events: ScriptStreamEvent[] = [];
  for await (const event of deps.engine.events.subscribe(scriptId)) {
    events.push(event);
    if (isTerminalEvent(event)) break;
  }
  return events;
}

describe("idempotent stage charges", () => {
  it("outline: identical re-submit returns the same outline and charges once", async () => {
    const input = scriptContracts.outline.input.parse({
      workspaceId: FIXTURE_IDS.workspace,
      projectId: fixtureProject.id,
      generation: archetypeGen,
    });
    const first = await scriptStagesImpl.outline({ ctx: fixtureCtx, input });
    const second = await scriptStagesImpl.outline({ ctx: fixtureCtx, input });
    expect(first).toEqual(second);
    expect(deps.engine.store.creditEntries).toHaveLength(1);
  });

  it("hooks: identical re-submit charges once", async () => {
    const input = scriptContracts.hooks.input.parse({
      workspaceId: FIXTURE_IDS.workspace,
      projectId: fixtureProject.id,
      generation: archetypeGen,
    });
    await scriptStagesImpl.hooks({ ctx: fixtureCtx, input });
    await scriptStagesImpl.hooks({ ctx: fixtureCtx, input });
    expect(deps.engine.store.creditEntries).toHaveLength(1);
  });

  it("draft: a simulated BullMQ retry of the same job charges once", async () => {
    const input = scriptContracts.draft.input.parse({
      workspaceId: FIXTURE_IDS.workspace,
      projectId: fixtureProject.id,
      frameId: fixtureFrame.id,
      generation: archetypeGen,
    });
    const out = await scriptStagesImpl.draft({ ctx: fixtureCtx, input });
    expect(deps.engine.store.creditEntries).toHaveLength(1);
    // Same payload the impl dispatched — a worker retry re-runs the job;
    // every stage resumes as done and the keyed charge dedupes.
    await handleGenerateScriptJob({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      frameId: input.frameId,
      voiceProfileId: null,
      generation: input.generation,
      scriptId: out.scriptId,
      actorUserId: fixtureCtx.userId,
      dispatch: "draft",
      presetOutline: null,
      chosenHook: null,
    });
    expect(deps.engine.store.creditEntries).toHaveLength(1);
  });
});

describe("partnered_named (flag on)", () => {
  const partnerGen = { mode: "partnered_named", partnerId: FIXTURE_IDS.partner };

  beforeEach(() => {
    process.env.FEATURE_PARTNERED_NAMED = "true";
    resetConfigForTests();
  });

  it("an enabled partner's card drives the stage", async () => {
    deps.partners.set({
      id: FIXTURE_IDS.partner,
      name: "Licensed Partner",
      enabled: true,
      styleCard: fixtureVoiceProfile.styleCard,
    });
    const out = await scriptStagesImpl.hooks({
      ctx: fixtureCtx,
      input: scriptContracts.hooks.input.parse({
        workspaceId: FIXTURE_IDS.workspace,
        projectId: fixtureProject.id,
        generation: partnerGen,
      }),
    });
    // The partner card allows open_loop + stakes only.
    for (const hook of out.hooks) {
      expect(["open_loop", "stakes"]).toContain(hook.style);
    }
  });

  it("a disabled (unlicensed) partner is FORBIDDEN, never charged", async () => {
    deps.partners.set({
      id: FIXTURE_IDS.partner,
      name: "Unsigned Partner",
      enabled: false,
      styleCard: fixtureVoiceProfile.styleCard,
    });
    const err = await scriptStagesImpl
      .topics({
        ctx: fixtureCtx,
        input: scriptContracts.topics.input.parse({
          workspaceId: FIXTURE_IDS.workspace,
          channelId: FIXTURE_IDS.channel,
          generation: partnerGen,
        }),
      })
      .catch((e: unknown) => e);
    expect((err as TRPCError).code).toBe("FORBIDDEN");
    expect((err as TRPCError).message).toMatch(/license/i);
    expect(deps.engine.store.creditEntries).toHaveLength(0);
  });
});

describe("draft SSE stream", () => {
  it("conforms to the frozen event union with preset outline + chosen hook", async () => {
    const outlineOut = await scriptStagesImpl.outline({
      ctx: fixtureCtx,
      input: scriptContracts.outline.input.parse({
        workspaceId: FIXTURE_IDS.workspace,
        projectId: fixtureProject.id,
        generation: archetypeGen,
      }),
    });
    const hooksOut = await scriptStagesImpl.hooks({
      ctx: fixtureCtx,
      input: scriptContracts.hooks.input.parse({
        workspaceId: FIXTURE_IDS.workspace,
        projectId: fixtureProject.id,
        outline: outlineOut.outline,
        generation: archetypeGen,
      }),
    });
    const chosen = hooksOut.hooks.find((h) => !h.autoPicked) ?? hooksOut.hooks[0];
    const draftOut = await scriptStagesImpl.draft({
      ctx: fixtureCtx,
      input: scriptContracts.draft.input.parse({
        workspaceId: FIXTURE_IDS.workspace,
        projectId: fixtureProject.id,
        frameId: fixtureFrame.id,
        outline: outlineOut.outline,
        hook: chosen,
        generation: archetypeGen,
      }),
    });

    const events = await collectEvents(draftOut.scriptId);
    for (const event of events) scriptStreamEventSchema.parse(event);
    const started = events.filter((e) => e.type === "stage_started").map((e) => e.stage);
    const done = events.filter((e) => e.type === "stage_done").map((e) => e.stage);
    expect(started).toEqual([...SCRIPT_STAGES]);
    expect(done).toEqual([...SCRIPT_STAGES]);
    expect(events.at(-1)?.type).toBe("complete");

    // The preset outline was adopted verbatim, and streamed.
    const outlineEvent = events.find((e) => e.type === "outline");
    if (outlineEvent?.type === "outline") {
      expect(outlineEvent.outline).toEqual(outlineOut.outline);
    }
    // One section event per outline section; the chosen hook body verbatim.
    const sectionEvents = events.filter((e) => e.type === "section");
    expect(sectionEvents).toHaveLength(outlineOut.outline.sections.length);
    const sections = await deps.engine.store.listSections(
      fixtureCtx.workspaceId,
      draftOut.scriptId,
    );
    expect(sections.find((s) => s.kind === "hook")?.body).toBe(chosen?.body);

    // Full staged flow ledger: outline 1 + hooks 1 + draft 4.
    const deltas = deps.engine.store.creditEntries.map((e) => e.delta);
    expect(deltas).toEqual([-1, -1, -4]);
  });
});

describe("script.generate orchestrator", () => {
  const generateInput = () =>
    scriptContracts.generate.input.parse({
      workspaceId: FIXTURE_IDS.workspace,
      projectId: fixtureProject.id,
      frameId: fixtureFrame.id,
      generation: archetypeGen,
    });

  it("charges ITEMIZED per-stage entries summing to 6 — the pinned ledger shape", async () => {
    const out = await scriptImpl.generate({ ctx: fixtureCtx, input: generateInput() });
    const entries = deps.engine.store.creditEntries;
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.delta)).toEqual([
      -CREDIT_COSTS.scriptOutline,
      -CREDIT_COSTS.scriptHooks,
      -CREDIT_COSTS.scriptDraft,
    ]);
    expect(entries.reduce((sum, e) => sum + e.delta, 0)).toBe(-CREDIT_COSTS.scriptGeneration);
    // Per-stage reasons (wave-C OPEN-ITEM): each itemized entry is labeled
    // distinctly so the billing screen no longer shows three identical rows.
    expect(entries.map((e) => e.reason)).toEqual([
      "script_outline",
      "script_hooks",
      "script_draft",
    ]);
    for (const entry of entries) {
      expect(entry.projectId).toBe(fixtureProject.id);
    }
    expect(entries[0]?.idempotencyKey).toMatch(/^outline:/);
    expect(entries[1]?.idempotencyKey).toMatch(/^hooks:/);
    expect(entries[2]?.idempotencyKey).toMatch(/^draft:/);

    // One SSE stream across the stages, terminal complete.
    const events = await collectEvents(out.scriptId);
    const types = events.map((e) => e.type);
    expect(types).toContain("outline");
    expect(types).toContain("hooks");
    expect(types).toContain("quality_report");
    expect(types.at(-1)).toBe("complete");
  });

  it("a worker retry of the orchestrator job never double-charges a stage", async () => {
    const out = await scriptImpl.generate({ ctx: fixtureCtx, input: generateInput() });
    expect(deps.engine.store.creditEntries).toHaveLength(3);
    await handleGenerateScriptJob({
      workspaceId: FIXTURE_IDS.workspace,
      projectId: fixtureProject.id,
      frameId: fixtureFrame.id,
      voiceProfileId: null,
      generation: archetypeGen,
      scriptId: out.scriptId,
      actorUserId: fixtureCtx.userId,
      dispatch: "generate",
    });
    expect(deps.engine.store.creditEntries).toHaveLength(3);
  });

  it("requires the full summed cost at dispatch", async () => {
    const workspace = getSharedWorkspaceStore().workspaces.find(
      (w) => w.id === FIXTURE_IDS.workspace,
    );
    if (workspace === undefined) throw new Error("fixture workspace missing");
    workspace.creditBalance = CREDIT_COSTS.scriptGeneration - 1;
    const err = await scriptImpl
      .generate({ ctx: fixtureCtx, input: generateInput() })
      .catch((e: unknown) => e);
    expect((err as TRPCError).code).toBe("PRECONDITION_FAILED");
    expect(deps.engine.store.creditEntries).toHaveLength(0);
  });

  it("legacy null-generation dispatch still works end to end", async () => {
    const out = await scriptImpl.generate({
      ctx: fixtureCtx,
      input: scriptContracts.generate.input.parse({
        workspaceId: FIXTURE_IDS.workspace,
        projectId: fixtureProject.id,
        frameId: fixtureFrame.id,
        voiceProfileId: fixtureVoiceProfile.id,
      }),
    });
    const script = await deps.engine.store.getScript(fixtureCtx.workspaceId, out.scriptId);
    expect(script?.status).toBe("final");
    expect(script?.generationMode).toBeNull();
    // Orchestrated metering applies to the composite too: 1 + 1 + 4.
    expect(deps.engine.store.creditEntries.map((e) => e.delta)).toEqual([-1, -1, -4]);
  });
});

describe("cross-workspace denial (all four stages)", () => {
  const foreignCtx: WorkspaceHandlerCtx = {
    userId: asUserId(FIXTURE_IDS.user),
    workspaceId: workspaceIdSchema.parse("00000000-0000-4000-8000-0000000000aa"),
  };

  it("denies every stage with NOT_FOUND and never charges", async () => {
    const results = await Promise.all([
      scriptStagesImpl
        .topics({
          ctx: foreignCtx,
          input: scriptContracts.topics.input.parse({
            workspaceId: foreignCtx.workspaceId,
            channelId: FIXTURE_IDS.channel,
          }),
        })
        .catch((e: unknown) => e),
      scriptStagesImpl
        .outline({
          ctx: foreignCtx,
          input: scriptContracts.outline.input.parse({
            workspaceId: foreignCtx.workspaceId,
            projectId: fixtureProject.id,
          }),
        })
        .catch((e: unknown) => e),
      scriptStagesImpl
        .hooks({
          ctx: foreignCtx,
          input: scriptContracts.hooks.input.parse({
            workspaceId: foreignCtx.workspaceId,
            projectId: fixtureProject.id,
          }),
        })
        .catch((e: unknown) => e),
      scriptStagesImpl
        .draft({
          ctx: foreignCtx,
          input: scriptContracts.draft.input.parse({
            workspaceId: foreignCtx.workspaceId,
            projectId: fixtureProject.id,
            frameId: fixtureFrame.id,
          }),
        })
        .catch((e: unknown) => e),
    ]);
    for (const err of results) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe("NOT_FOUND");
    }
    expect(deps.engine.store.creditEntries).toHaveLength(0);
  });
});
