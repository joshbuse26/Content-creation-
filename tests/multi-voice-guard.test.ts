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
  type ScriptId,
} from "@/lib/types/ids";
import { type ScriptStreamEvent } from "@/lib/types/pipeline";
import { runRevisionPipeline } from "@/pipelines/revision/pipeline";
import { setEngineDepsForTests } from "@/pipelines/script/deps";
import { isTerminalEvent } from "@/pipelines/script/events";
import { runLicensedGuard, LicensedGuardBlockedError } from "@/pipelines/script/licensed-guard";
import { runScriptPipeline } from "@/pipelines/script/pipeline";
import { setStageDepsForTests } from "@/pipelines/stages/deps";
import { setPartnerSourceForTests } from "@/pipelines/stages/partners";
import { assertLicensedVoiceUsable } from "@/server/modes";
import { revisionImpl } from "@/server/routers/impl/revision";
import { scriptImpl } from "@/server/routers/impl/script";
import { scriptStagesImpl } from "@/server/routers/impl/script-stages";
import { voiceProfileImpl } from "@/server/routers/impl/voiceProfile";
import type { WorkspaceHandlerCtx } from "@/server/routers/impl/_shared";
import { resetSharedWorkspaceStoreForTests } from "@/server/workspace/memory";
import { fixtureCtx } from "./a2-helpers";
import { makeStageDeps } from "./c1-helpers";

/** A verbatim run present in the fixture OUTRO section (synthSectionBody). */
const OUTRO_VERBATIM = "Next time I am taking the same test one step further";

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

  // P2-7: a licensed card whose snippet corpus is empty or trivially short
  // leaves the guard with nothing to check against — reject it at the app
  // boundary so a licensed voice can never generate ungated.
  it("assertLicensedVoiceUsable rejects a licensed card with an EMPTY snippet corpus", () => {
    const licensed = seedLicensedProfile([]);
    expect(() => {
      assertLicensedVoiceUsable(licensed);
    }).toThrow(/no usable source material/);
  });

  it("assertLicensedVoiceUsable rejects a licensed card whose snippets are all < 5 words", () => {
    const licensed = seedLicensedProfile(["here is the thing", "dial it in", "  "]);
    expect(() => {
      assertLicensedVoiceUsable(licensed);
    }).toThrow(/no usable source material/);
  });

  it("scriptStages.draft refuses to dispatch a trivial-corpus licensed voice", async () => {
    const licensed = seedLicensedProfile(["here's the thing"]);
    const input = scriptContracts.draft.input.parse({
      workspaceId: FIXTURE_IDS.workspace,
      projectId: fixtureProject.id,
      frameId: fixtureFrame.id,
      voiceProfileId: licensed.id,
      generation: null,
    });
    await expect(scriptStagesImpl.draft({ ctx: fixtureCtx, input })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
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

  it("catches a reproduced SHORT catchphrase the old 5-gram math missed (P1-1)", async () => {
    // A 3-word licensed catchphrase reproduced verbatim: the empty 5-gram set
    // used to score this 'clean' (ratio 0). Now containment detects it and the
    // guard rewrites it away.
    const licensed = seedLicensedProfile(["dial it in", "here is the whole point today"]);
    const body = `${words(30, "own")} dial it in ${words(30, "more")}`;
    const result = await runLicensedGuard({
      mode: "fixture",
      llm: deps.engine.llm,
      threshold: 0.08,
      sections: [{ position: 0, body, licensedProfile: licensed }],
    });
    expect(result?.rewrites.has(0)).toBe(true);
    expect(result?.log.checked[0]?.status).toBe("rewritten");
    // The rewrite no longer contains the catchphrase verbatim.
    expect((result?.rewrites.get(0) ?? "").toLowerCase()).not.toContain("dial it in");
  });

  it("FAILS CLOSED for a licensed voice with an empty corpus (cannot generate)", async () => {
    const licensed = seedLicensedProfile([]);
    await expect(
      runLicensedGuard({
        mode: "fixture",
        llm: deps.engine.llm,
        threshold: 0.08,
        sections: [{ position: 0, body: words(30, "x"), licensedProfile: licensed }],
      }),
    ).rejects.toBeInstanceOf(LicensedGuardBlockedError);
  });
});

// ---------------------------------------------------------------------------
// P1-3: over-similar text is never persisted nor streamed
// ---------------------------------------------------------------------------

describe("licensed guard is atomic in the draft pipeline (P1-3)", () => {
  it("guards BEFORE streaming and persisting — verbatim source never reaches the editor or DB", async () => {
    // The licensed source is a run present verbatim in the fixture OUTRO. With
    // a licensed voice, the guard must scrub it from both the streamed section
    // events and the persisted body.
    const licensed = seedLicensedProfile([OUTRO_VERBATIM]);
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

    // No streamed `section` event carries the verbatim run.
    const streamed = events.filter(
      (e): e is Extract<ScriptStreamEvent, { type: "section" }> => e.type === "section",
    );
    expect(streamed.length).toBeGreaterThan(0);
    for (const e of streamed) {
      expect(e.section.body).not.toContain(OUTRO_VERBATIM);
    }
    // Nor is it persisted (script.get has no status filter — it must be clean).
    const got = await scriptImpl.get({
      ctx: fixtureCtx,
      input: { workspaceId: fixtureCtx.workspaceId, scriptId: out.scriptId },
    });
    for (const s of got.sections) {
      expect(s.body).not.toContain(OUTRO_VERBATIM);
    }
  });

  it("control: without a licensed voice the same verbatim run survives (proves the guard removed it)", async () => {
    const input = scriptContracts.draft.input.parse({
      workspaceId: FIXTURE_IDS.workspace,
      projectId: fixtureProject.id,
      frameId: fixtureFrame.id,
      voiceProfileId: fixtureVoiceProfile.id, // own_channel — no guard
      generation: null,
    });
    const out = await scriptStagesImpl.draft({ ctx: fixtureCtx, input });
    await collectEvents(out.scriptId);
    const got = await scriptImpl.get({
      ctx: fixtureCtx,
      input: { workspaceId: fixtureCtx.workspaceId, scriptId: out.scriptId },
    });
    const outro = got.sections.find((s) => s.kind === "outro");
    expect(outro?.body).toContain(OUTRO_VERBATIM);
  });

  it("hard-fails atomically (fail-closed): a blocked run persists NO sections, script.get stays empty", async () => {
    // An empty-corpus licensed voice cannot be guarded, so the pipeline must
    // fail closed. Driven straight through runScriptPipeline (the dispatch gate
    // would reject it earlier); the point is that even here nothing leaks.
    const licensed = seedLicensedProfile([]);
    const script = await deps.engine.store.createScript({
      workspaceId: fixtureCtx.workspaceId,
      projectId: fixtureProject.id,
      voiceProfileId: licensed.id,
    });
    const jobInput = {
      workspaceId: fixtureCtx.workspaceId,
      projectId: fixtureProject.id,
      frameId: fixtureFrame.id,
      voiceProfileId: licensed.id,
      generation: null,
    };
    const result = await runScriptPipeline(deps.engine, {
      input: jobInput,
      scriptId: script.id,
      actorUserId: null,
    });
    expect(result.status).toBe("failed");
    const got = await scriptImpl.get({
      ctx: fixtureCtx,
      input: { workspaceId: fixtureCtx.workspaceId, scriptId: script.id },
    });
    expect(got.sections.length).toBe(0);
    expect(got.script.status).not.toBe("final");
  });
});

// ---------------------------------------------------------------------------
// P1-2: the revision pass and accept are guarded for licensed voices
// ---------------------------------------------------------------------------

const CREMA = "the crema settles into a tiger stripe pattern across the surface";

async function makeLicensedScript(voiceProfileId: VoiceProfile["id"] | null): Promise<ScriptId> {
  const script = await deps.engine.store.createScript({
    workspaceId: fixtureCtx.workspaceId,
    projectId: fixtureProject.id,
    voiceProfileId,
  });
  return script.id;
}

describe("revision pass licensed guard (P1-2)", () => {
  it("scrubs a verbatim licensed run from a suggestion's replacement before it is offered", async () => {
    const licensed = seedLicensedProfile([CREMA]);
    const scriptId = await makeLicensedScript(licensed.id);
    await deps.engine.store.replaceSections(fixtureCtx.workspaceId, scriptId, [
      {
        position: 0,
        kind: "chapter",
        heading: "Chapter",
        body: `The crema settles into a tiger stripe pattern across the surface today. Then it fades.`,
        estSeconds: 40,
        retentionNote: null,
        factRefs: [],
      },
    ]);
    const { result, revisions } = await runRevisionPipeline(deps.engine, {
      input: { workspaceId: fixtureCtx.workspaceId, scriptId },
      actorUserId: null,
    });
    expect(result.status).toBe("done");
    expect(revisions.length).toBeGreaterThanOrEqual(1);
    for (const revision of revisions) {
      for (const op of revision.diff) {
        expect(op.replacement.toLowerCase()).not.toContain(CREMA);
      }
    }
  });

  it("control: a non-licensed script keeps the verbatim run in its suggestion", async () => {
    const scriptId = await makeLicensedScript(null);
    await deps.engine.store.replaceSections(fixtureCtx.workspaceId, scriptId, [
      {
        position: 0,
        kind: "chapter",
        heading: "Chapter",
        body: `The crema settles into a tiger stripe pattern across the surface today. Then it fades.`,
        estSeconds: 40,
        retentionNote: null,
        factRefs: [],
      },
    ]);
    const { revisions } = await runRevisionPipeline(deps.engine, {
      input: { workspaceId: fixtureCtx.workspaceId, scriptId },
      actorUserId: null,
    });
    const someContains = revisions.some((r) =>
      r.diff.some((op) => op.replacement.toLowerCase().includes(CREMA)),
    );
    expect(someContains).toBe(true);
  });
});

describe("revision.accept licensed guard (P1-2)", () => {
  async function setup(): Promise<{ scriptId: ScriptId; sectionId: string }> {
    const licensed = seedLicensedProfile([CREMA]);
    const scriptId = await makeLicensedScript(licensed.id);
    const [section] = await deps.engine.store.replaceSections(fixtureCtx.workspaceId, scriptId, [
      {
        position: 0,
        kind: "chapter",
        heading: "Chapter",
        body: "alpha one two\nbeta three four\ngamma five six",
        estSeconds: 30,
        retentionNote: null,
        factRefs: [],
      },
    ]);
    if (section === undefined) throw new Error("no section");
    return { scriptId, sectionId: section.id };
  }

  it("rejects an accept whose result would reproduce the licensed source (body unchanged)", async () => {
    const { scriptId, sectionId } = await setup();
    const [over] = await deps.engine.store.insertRevisions([
      {
        workspaceId: fixtureCtx.workspaceId,
        scriptId,
        sectionId: scriptSectionIdSchema.parse(sectionId),
        suggestion: "rephrase line 2",
        diff: [{ lineStart: 2, lineEnd: 2, replacement: CREMA }],
        rationale: "voice",
      },
    ]);
    if (over === undefined) throw new Error("no revision");
    const before = await deps.engine.store.getSection(fixtureCtx.workspaceId, over.sectionId);
    await expect(
      revisionImpl.accept({
        ctx: fixtureCtx,
        input: { workspaceId: fixtureCtx.workspaceId, revisionId: over.id },
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    // Nothing persisted: body and revision status are untouched.
    const after = await deps.engine.store.getSection(fixtureCtx.workspaceId, over.sectionId);
    expect(after?.body).toBe(before?.body);
    const stillPending = await deps.engine.store.getRevision(fixtureCtx.workspaceId, over.id);
    expect(stillPending?.status).toBe("pending");
  });

  it("allows an accept whose result stays original", async () => {
    const { scriptId, sectionId } = await setup();
    const [ok] = await deps.engine.store.insertRevisions([
      {
        workspaceId: fixtureCtx.workspaceId,
        scriptId,
        sectionId: scriptSectionIdSchema.parse(sectionId),
        suggestion: "tighten line 2",
        diff: [{ lineStart: 2, lineEnd: 2, replacement: "beta three four five" }],
        rationale: "voice",
      },
    ]);
    if (ok === undefined) throw new Error("no revision");
    const accepted = await revisionImpl.accept({
      ctx: fixtureCtx,
      input: { workspaceId: fixtureCtx.workspaceId, revisionId: ok.id },
    });
    expect(accepted.revision.status).toBe("accepted");
    expect(accepted.section.body).toContain("beta three four five");
  });
});
