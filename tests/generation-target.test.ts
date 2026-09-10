import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { resetConfigForTests } from "@/lib/config";
import { FIXTURE_IDS, fixtureFrame, fixtureProject, fixtureVoiceProfile } from "@/lib/fixtures";
import { generationTargetColumns } from "@/lib/generation-target";
import { projectContracts, scriptContracts } from "@/lib/types/api";
import { generationTargetSchema } from "@/lib/types/entities";
import { setEngineDepsForTests } from "@/pipelines/script/deps";
import { setStageDepsForTests } from "@/pipelines/stages/deps";
import { setPartnerSourceForTests } from "@/pipelines/stages/partners";
import { projectHandlers } from "@/server/routers/impl/project";
import { scriptImpl } from "@/server/routers/impl/script";
import { resetSharedWorkspaceStoreForTests } from "@/server/workspace/memory";
import { fixtureCtx } from "./a2-helpers";
import { makeStageDeps } from "./c1-helpers";

/**
 * Wave-C adversarial F8: project.setGenerationTarget must apply the same
 * record-level partner checks as the dispatch sites (existence + enabled),
 * and mode columns are normalized — fields outside the target's mode are
 * stored NULL on both project and script rows (no cross-mode residue).
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

const setTarget = (generation: unknown) =>
  projectHandlers.setGenerationTarget({
    ctx: fixtureCtx,
    input: projectContracts.setGenerationTarget.input.parse({
      workspaceId: FIXTURE_IDS.workspace,
      projectId: fixtureProject.id,
      generation,
    }),
  });

describe("setGenerationTarget partner validation (F8)", () => {
  beforeEach(() => {
    process.env.FEATURE_PARTNERED_NAMED = "true";
    resetConfigForTests();
  });

  const partnerGen = { mode: "partnered_named", partnerId: FIXTURE_IDS.partner };

  it("a bogus partnerId is rejected NOT_FOUND and never stored", async () => {
    const err = await setTarget(partnerGen).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("NOT_FOUND");
    const project = await deps.engine.store.getProject(fixtureCtx.workspaceId, fixtureProject.id);
    expect(project?.partnerId).toBeNull();
    expect(project?.generationMode).toBeNull();
  });

  it("a disabled (unlicensed) partner is FORBIDDEN", async () => {
    deps.partners.set({
      id: FIXTURE_IDS.partner,
      name: "Unsigned Partner",
      enabled: false,
      styleCard: fixtureVoiceProfile.styleCard,
    });
    const err = await setTarget(partnerGen).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("FORBIDDEN");
  });

  it("an enabled partner is stored, with the other mode fields null", async () => {
    deps.partners.set({
      id: FIXTURE_IDS.partner,
      name: "Licensed Partner",
      enabled: true,
      styleCard: fixtureVoiceProfile.styleCard,
    });
    const project = await setTarget(partnerGen);
    expect(project.generationMode).toBe("partnered_named");
    expect(project.partnerId).toBe(FIXTURE_IDS.partner);
    expect(project.archetypeId).toBeNull();
    expect(project.crossover).toBeNull();
  });
});

describe("mode-column normalization (F8)", () => {
  const crossover = { a: "calm-explainer", b: "data-storyteller", weightA: 0.6 };

  it("a crossover target with stray archetype/partner residue stores them NULL on the project", async () => {
    const project = await setTarget({
      mode: "crossover",
      crossover,
      // Cross-mode residue the schema does not forbid:
      archetypeId: "calm-explainer",
      partnerId: FIXTURE_IDS.partner,
    });
    expect(project.generationMode).toBe("crossover");
    expect(project.crossover).toEqual(crossover);
    expect(project.archetypeId).toBeNull();
    expect(project.partnerId).toBeNull();
  });

  it("script rows from a crossover dispatch carry null partnerId/archetypeId", async () => {
    const out = await scriptImpl.generate({
      ctx: fixtureCtx,
      input: scriptContracts.generate.input.parse({
        workspaceId: FIXTURE_IDS.workspace,
        projectId: fixtureProject.id,
        frameId: fixtureFrame.id,
        generation: {
          mode: "crossover",
          crossover,
          archetypeId: "calm-explainer",
          partnerId: FIXTURE_IDS.partner,
        },
      }),
    });
    const script = await deps.engine.store.getScript(fixtureCtx.workspaceId, out.scriptId);
    expect(script?.generationMode).toBe("crossover");
    expect(script?.crossover).toEqual(crossover);
    expect(script?.archetypeId).toBeNull();
    expect(script?.partnerId).toBeNull();
  });

  it("the normalize helper is exhaustive per mode", () => {
    const archetype = generationTargetSchema.parse({
      mode: "archetype",
      archetypeId: "calm-explainer",
      crossover,
      partnerId: FIXTURE_IDS.partner,
    });
    expect(generationTargetColumns(archetype)).toEqual({
      generationMode: "archetype",
      archetypeId: "calm-explainer",
      crossover: null,
      partnerId: null,
    });
    expect(generationTargetColumns(null)).toEqual({
      generationMode: null,
      archetypeId: null,
      crossover: null,
      partnerId: null,
    });
  });
});
