import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import { resetConfigForTests } from "@/lib/config";
import { FIXTURE_IDS, fixtureFrame, fixtureProject, fixtureVoiceProfile } from "@/lib/fixtures";
import { scriptContracts } from "@/lib/types/api";
import { voiceProfileSchema, type StyleCard, type VoiceProfile } from "@/lib/types/entities";
import {
  scriptSectionIdSchema,
  voiceProfileIdSchema,
  workspaceIdSchema,
  asUserId,
} from "@/lib/types/ids";
import { type ScriptStreamEvent } from "@/lib/types/pipeline";
import { setEngineDepsForTests } from "@/pipelines/script/deps";
import { isTerminalEvent } from "@/pipelines/script/events";
import { runLicensedGuard } from "@/pipelines/script/licensed-guard";
import { setStageDepsForTests } from "@/pipelines/stages/deps";
import { setPartnerSourceForTests } from "@/pipelines/stages/partners";
import { assertLicensedVoiceUsable } from "@/server/modes";
import { scriptImpl } from "@/server/routers/impl/script";
import { scriptStagesImpl } from "@/server/routers/impl/script-stages";
import { voiceProfileImpl } from "@/server/routers/impl/voiceProfile";
import type { WorkspaceHandlerCtx } from "@/server/routers/impl/_shared";
import { resetSharedWorkspaceStoreForTests } from "@/server/workspace/memory";
import { fixtureCtx } from "./a2-helpers";
import { makeStageDeps } from "./c1-helpers";

/**
 * Multi-voice (PRODUCT-CONTRACTS §7): per-section voice override wiring,
 * plus the licensed-voice similarity guard where it runs inside the draft
 * pipeline and the single-section path.
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
  resetConfigForTests();
});

const words = (n: number, seed: string): string =>
  Array.from({ length: n }, (_, i) => `${seed}${i}`).join(" ");

function seedLicensedProfile(snippets: string[]): VoiceProfile {
  const card: StyleCard = {
    ...fixtureVoiceProfile.styleCard,
    exampleSnippets: snippets.slice(0, 4),
  };
  const profile = voiceProfileSchema.parse({
    ...fixtureVoiceProfile,
    id: voiceProfileIdSchema.parse(randomUUID()),
    name: "Licensed guest voice",
    source: "licensed",
    styleCard: card,
    licenseDocUrl: "https://example.com/license.pdf",
    licenseSignedAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  deps.engine.store.seedVoiceProfile(profile);
  return profile;
}

async function collectEvents(scriptId: string): Promise<ScriptStreamEvent[]> {
  const events: ScriptStreamEvent[] = [];
  for await (const event of deps.engine.events.subscribe(scriptId)) {
    events.push(event);
    if (isTerminalEvent(event)) break;
  }
  return events;
}

// ---------------------------------------------------------------------------
// setSectionVoice
// ---------------------------------------------------------------------------

describe("script.setSectionVoice", () => {
  it("assigns a section voice override and clears it with null — no credit charge", async () => {
    const before = deps.engine.store.creditEntries.length;
    const assigned = await scriptImpl.setSectionVoice({
      ctx: fixtureCtx,
      input: {
        workspaceId: fixtureCtx.workspaceId,
        sectionId: scriptSectionIdSchema.parse(FIXTURE_IDS.sectionIntro),
        voiceProfileId: fixtureVoiceProfile.id,
      },
    });
    expect(assigned.voiceProfileId).toBe(fixtureVoiceProfile.id);

    const cleared = await scriptImpl.setSectionVoice({
      ctx: fixtureCtx,
      input: {
        workspaceId: fixtureCtx.workspaceId,
        sectionId: scriptSectionIdSchema.parse(FIXTURE_IDS.sectionIntro),
        voiceProfileId: null,
      },
    });
    expect(cleared.voiceProfileId).toBeNull();
    // Config, not generation: the ledger never moves.
    expect(deps.engine.store.creditEntries.length).toBe(before);
  });

  it("is tenancy-scoped: another workspace cannot touch the section", async () => {
    const foreignCtx: WorkspaceHandlerCtx = {
      userId: asUserId(FIXTURE_IDS.user),
      workspaceId: workspaceIdSchema.parse(randomUUID()),
    };
    await expect(
      scriptImpl.setSectionVoice({
        ctx: foreignCtx,
        input: {
          workspaceId: foreignCtx.workspaceId,
          sectionId: scriptSectionIdSchema.parse(FIXTURE_IDS.sectionIntro),
          voiceProfileId: fixtureVoiceProfile.id,
        },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects an unknown voice profile id", async () => {
    await expect(
      scriptImpl.setSectionVoice({
        ctx: fixtureCtx,
        input: {
          workspaceId: fixtureCtx.workspaceId,
          sectionId: scriptSectionIdSchema.parse(FIXTURE_IDS.sectionIntro),
          voiceProfileId: voiceProfileIdSchema.parse(randomUUID()),
        },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("voiceProfile.list returns the workspace's profiles for the picker", async () => {
    seedLicensedProfile(["a b c d e f"]);
    const list = await voiceProfileImpl.list({
      ctx: fixtureCtx,
      input: { workspaceId: fixtureCtx.workspaceId },
    });
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.map((v) => v.id)).toContain(fixtureVoiceProfile.id);
  });
});

// ---------------------------------------------------------------------------
// Licensed-card usability (guard-at-use; the DB CHECK + schema cover creation)
// ---------------------------------------------------------------------------

describe("licensed voice usability", () => {
  it("voiceProfileSchema refuses a licensed card without license fields", () => {
    const parsed = voiceProfileSchema.safeParse({
      ...fixtureVoiceProfile,
      source: "licensed",
      licenseDocUrl: null,
      licenseSignedAt: null,
    });
    expect(parsed.success).toBe(false);
  });

  it("assertLicensedVoiceUsable blocks a licensed card missing its signed license", () => {
    const unusable = {
      ...fixtureVoiceProfile,
      source: "licensed" as const,
      licenseDocUrl: null,
      licenseSignedAt: null,
    } as VoiceProfile;
    expect(() => {
      assertLicensedVoiceUsable(unusable);
    }).toThrow(TRPCError);
    // A properly-licensed card and non-licensed cards pass.
    const licensed = seedLicensedProfile(["a b c d e f"]);
    expect(() => {
      assertLicensedVoiceUsable(licensed);
    }).not.toThrow();
    expect(() => {
      assertLicensedVoiceUsable(fixtureVoiceProfile);
    }).not.toThrow();
    expect(() => {
      assertLicensedVoiceUsable(null);
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Guard in the draft pipeline + the guard helper
// ---------------------------------------------------------------------------

describe("licensed-voice guard in the draft pipeline", () => {
  it("runs for a licensed script-level voice and logs the check on the voice_pass run", async () => {
    // A licensed source whose snippets never appear in the synthesized draft:
    // the guard runs and passes clean, and its result is logged.
    const licensed = seedLicensedProfile(["the quick brown fox jumps over the lazy dog today"]);
    const input = scriptContracts.draft.input.parse({
      workspaceId: FIXTURE_IDS.workspace,
      projectId: fixtureProject.id,
      frameId: fixtureFrame.id,
      voiceProfileId: licensed.id,
      generation: null,
    });
    const out = await scriptStagesImpl.draft({ ctx: fixtureCtx, input });
    const events = await collectEvents(out.scriptId);
    expect(events.at(-1)?.type).toBe("complete");

    const voicePassRun = deps.engine.runs.rows.find((r) => r.stage === "voice_pass");
    expect(voicePassRun).toBeDefined();
    const output = voicePassRun?.output as {
      licensedGuard?: { guard: string; checked: unknown[] };
    };
    expect(output.licensedGuard?.guard).toBe("licensed_similarity");
    expect(output.licensedGuard?.checked.length).toBeGreaterThan(0);
  });

  it("does NOT run or log for a non-licensed voice (unchanged behavior)", async () => {
    const input = scriptContracts.draft.input.parse({
      workspaceId: FIXTURE_IDS.workspace,
      projectId: fixtureProject.id,
      frameId: fixtureFrame.id,
      voiceProfileId: fixtureVoiceProfile.id, // source: own_channel
      generation: null,
    });
    const out = await scriptStagesImpl.draft({ ctx: fixtureCtx, input });
    await collectEvents(out.scriptId);
    const voicePassRun = deps.engine.runs.rows.find((r) => r.stage === "voice_pass");
    expect(voicePassRun?.output ?? null).toBeNull();
  });
});

describe("runLicensedGuard helper", () => {
  it("auto-rewrites an over-similar section and passes on re-check", async () => {
    const licensed = seedLicensedProfile([words(40, "lic")]);
    const body = `${words(20, "z")} ${words(40, "lic")} ${words(20, "q")}`;
    const result = await runLicensedGuard({
      mode: "fixture",
      llm: deps.engine.llm,
      threshold: 0.08,
      sections: [{ position: 0, body, licensedProfile: licensed }],
    });
    expect(result).not.toBeNull();
    expect(result?.rewrites.has(0)).toBe(true);
    expect(result?.log.checked[0]?.status).toBe("rewritten");
    expect(result?.log.checked[0]?.maxOverlapAfter).toBeLessThanOrEqual(0.08);
  });

  it("returns null when no section has a licensed voice", async () => {
    const result = await runLicensedGuard({
      mode: "fixture",
      llm: deps.engine.llm,
      threshold: 0.08,
      sections: [{ position: 0, body: words(30, "x"), licensedProfile: null }],
    });
    expect(result).toBeNull();
  });
});
