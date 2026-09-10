import { describe, expect, it } from "vitest";
import { fixtureFrame, fixtureProject, fixtureResearchDoc } from "@/lib/fixtures";
import { SCRIPT_STAGES } from "@/lib/types/pipeline";
import {
  extractClaimSentences,
  findSupportingDoc,
  matchClaims,
} from "@/pipelines/script/fact-match";
import { stageInputHash } from "@/pipelines/script/hash";
import { runScriptPipeline } from "@/pipelines/script/pipeline";
import { fixtureCtx, makeDeps } from "./a2-helpers";

const supportedClaim =
  "Blind panels could not distinguish shots from a $200 vs $1,800 setup when the same grinder was used.";
const unsupportedClaim =
  "Exactly 73 percent of professional baristas secretly prefer instant coffee, according to a 2025 industry survey.";

describe("fact-check claim matching (pure code / fixture path)", () => {
  it("extracts only claim-like sentences", () => {
    const body = `${supportedClaim} I like coffee a lot. What could go wrong? ${unsupportedClaim}`;
    const claims = extractClaimSentences(body);
    expect(claims).toHaveLength(2);
    expect(claims.some((c) => c.includes("$200"))).toBe(true);
  });

  it("matches a claim stated by a research doc and flags the invented one", () => {
    const docs = [fixtureResearchDoc];
    expect(findSupportingDoc(supportedClaim, docs)).toBe(fixtureResearchDoc.id);
    expect(findSupportingDoc(unsupportedClaim, docs)).toBeNull();

    const refs = matchClaims(`${supportedClaim} ${unsupportedClaim}`, docs);
    expect(refs).toHaveLength(2);
    expect(refs[0]?.researchDocId).toBe(fixtureResearchDoc.id);
    expect(refs[1]?.researchDocId).toBeNull();
  });
});

describe("fact_check stage persists refs and flags unsupported claims", () => {
  it("writes factRefs onto persisted sections", async () => {
    const deps = makeDeps();
    const script = await deps.store.createScript({
      workspaceId: fixtureCtx.workspaceId,
      projectId: fixtureProject.id,
      voiceProfileId: null,
    });
    await deps.store.replaceSections(fixtureCtx.workspaceId, script.id, [
      {
        position: 0,
        kind: "hook",
        heading: "Hook",
        body: "This one is short and safe to say out loud.",
        estSeconds: 10,
        retentionNote: null,
        factRefs: [],
      },
      {
        position: 1,
        kind: "chapter",
        heading: "Claims",
        body: `${supportedClaim} ${unsupportedClaim}`,
        estSeconds: 60,
        retentionNote: null,
        factRefs: [],
      },
      {
        position: 2,
        kind: "outro",
        heading: "Outro",
        body: "That is the whole test. See you in the next one.",
        estSeconds: 10,
        retentionNote: null,
        factRefs: [],
      },
    ]);

    // Resume directly at fact_check (stages 1-5 marked done for this hash).
    const params = {
      input: {
        workspaceId: fixtureCtx.workspaceId,
        projectId: fixtureProject.id,
        frameId: fixtureFrame.id,
        voiceProfileId: null,
      },
      scriptId: script.id,
      actorUserId: null,
    };
    const inputHash = stageInputHash({ input: params.input, scriptId: script.id });
    for (const stage of SCRIPT_STAGES.slice(0, 5)) {
      await deps.runs.create({
        workspaceId: fixtureCtx.workspaceId,
        projectId: fixtureProject.id,
        kind: "script",
        stage,
        status: "done",
        attempt: 1,
        inputHash,
        error: null,
        creditsCharged: 0,
      });
    }
    // Relax the gate so quality_gate passes with this tiny two-section script.
    await deps.store.updateFrame(fixtureCtx.workspaceId, fixtureFrame.id, { targetMinutes: 1 });

    const result = await runScriptPipeline(deps, params);
    expect(result.status).toBe("done");

    const sections = await deps.store.listSections(fixtureCtx.workspaceId, script.id);
    const refs = sections[1]?.factRefs ?? [];
    expect(refs.length).toBeGreaterThanOrEqual(2);
    const supported = refs.find((r) => r.claim.includes("$200"));
    const unsupported = refs.find((r) => r.claim.includes("73 percent"));
    expect(supported?.researchDocId).toBe(fixtureResearchDoc.id);
    expect(unsupported).toBeDefined();
    expect(unsupported?.researchDocId).toBeNull();
  });
});
