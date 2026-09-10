import { describe, expect, it } from "vitest";
import { fixtureFrame, fixtureProject } from "@/lib/fixtures";
import { SCRIPT_STAGES } from "@/lib/types/pipeline";
import { applyCodeAutoFix } from "@/pipelines/script/auto-fix";
import { stageInputHash } from "@/pipelines/script/hash";
import { runScriptPipeline } from "@/pipelines/script/pipeline";
import { computeQualityReport, gateViolations } from "@/pipelines/script/quality-gate";
import { countWords } from "@/pipelines/script/readability";
import { fixtureCtx, makeDeps } from "./a2-helpers";

const longBody = (words: number) =>
  Array.from(
    { length: Math.ceil(words / 8) },
    () => "The result held up on every single run we tried.",
  ).join(" ");

function bloatedSections() {
  return [
    {
      kind: "hook",
      heading: "Hook",
      body: longBody(200), // ~80s spoken — way over the 30s cap
      estSeconds: 80,
      retentionNote: null,
    },
    { kind: "intro", heading: "Rules", body: longBody(120), estSeconds: 48, retentionNote: null },
    { kind: "chapter", heading: "One", body: longBody(400), estSeconds: 160, retentionNote: null },
    { kind: "chapter", heading: "Two", body: longBody(400), estSeconds: 160, retentionNote: null },
    { kind: "cta", heading: "CTA", body: longBody(40), estSeconds: 16, retentionNote: null },
    { kind: "outro", heading: "Outro", body: longBody(30), estSeconds: 12, retentionNote: null },
  ];
}

describe("quality gate (pure code)", () => {
  it("fails on word count, hook length; reports concrete warnings", () => {
    const report = computeQualityReport({
      sections: bloatedSections(),
      targetMinutes: 2, // 300-word target vs ~1190 words
      tone: "playful",
    });
    expect(report.passed).toBe(false);
    expect(report.wordCountWithinTolerance).toBe(false);
    expect(report.hookOk).toBe(false);
    expect(report.warnings.length).toBeGreaterThanOrEqual(2);
    expect(gateViolations(report).length).toBeGreaterThanOrEqual(2);
  });

  it("passes academic-tone scripts through the readability check", () => {
    const sections = [
      {
        kind: "hook",
        heading: "Hook",
        body: "Epistemological considerations notwithstanding, contemporary historiographical methodologies fundamentally recontextualize interdisciplinary interpretations.",
        estSeconds: 10,
        retentionNote: null,
      },
      { kind: "chapter", heading: "A", body: longBody(140), estSeconds: 60, retentionNote: null },
    ];
    const academic = computeQualityReport({ sections, targetMinutes: 1, tone: "academic" });
    expect(academic.readabilityOk).toBe(true);
  });

  it("applyCodeAutoFix repairs word count and hook length", () => {
    const sections = bloatedSections();
    const report = computeQualityReport({ sections, targetMinutes: 2, tone: "playful" });
    const fixed = applyCodeAutoFix(sections, report);
    const after = computeQualityReport(
      { sections: fixed, targetMinutes: 2, tone: "playful" },
      { autoFixAttempted: true },
    );
    expect(after.hookOk).toBe(true);
    expect(after.wordCountWithinTolerance).toBe(true);
    expect(after.autoFixAttempted).toBe(true);
  });
});

describe("quality-gate failure inside the pipeline triggers the auto-fix loop", () => {
  it("resumes at quality_gate, auto-fixes, and finishes with a passing report", async () => {
    const deps = makeDeps();
    // A chosen frame with a small target the bloated draft violates badly.
    await deps.store.updateFrame(fixtureCtx.workspaceId, fixtureFrame.id, { targetMinutes: 2 });
    const script = await deps.store.createScript({
      workspaceId: fixtureCtx.workspaceId,
      projectId: fixtureProject.id,
      voiceProfileId: null,
    });
    await deps.store.replaceSections(
      fixtureCtx.workspaceId,
      script.id,
      bloatedSections().map((s, position) => ({
        position,
        kind: s.kind as "hook" | "intro" | "chapter" | "cta" | "outro",
        heading: s.heading,
        body: s.body,
        estSeconds: s.estSeconds,
        retentionNote: s.retentionNote,
        factRefs: [],
      })),
    );

    // Mark stages 1-6 done for this exact input hash so the runner resumes
    // directly at quality_gate against the bloated persisted sections.
    const params = {
      input: {
        workspaceId: fixtureCtx.workspaceId,
        projectId: fixtureProject.id,
        frameId: fixtureFrame.id,
        voiceProfileId: null,
        generation: null,
      },
      scriptId: script.id,
      actorUserId: null,
    };
    const inputHash = stageInputHash({ input: params.input, scriptId: script.id });
    for (const stage of SCRIPT_STAGES.slice(0, 6)) {
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

    const result = await runScriptPipeline(deps, params);
    expect(result.status).toBe("done");
    expect(result.status === "done" && result.skippedStages).toEqual([
      ...SCRIPT_STAGES.slice(0, 6),
    ]);

    const report = deps.store.getCachedQualityReport(script.id);
    expect(report?.autoFixAttempted).toBe(true);
    expect(report?.wordCountWithinTolerance).toBe(true);
    expect(report?.hookOk).toBe(true);

    // The persisted sections were actually rewritten shorter.
    const sections = await deps.store.listSections(fixtureCtx.workspaceId, script.id);
    const words = countWords(sections.map((s) => s.body).join(" "));
    expect(words).toBeLessThanOrEqual(Math.round(2 * 150 * 1.15));
  });
});
