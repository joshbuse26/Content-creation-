import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  fixtureFrame,
  fixtureProject,
  fixtureResearchDoc,
  fixtureVoiceProfile,
} from "@/lib/fixtures";
import { scriptSectionSchema } from "@/lib/types/entities";
import {
  SCRIPT_STAGES,
  scriptStreamEventSchema,
  type ScriptStreamEvent,
} from "@/lib/types/pipeline";
import { runScriptPipeline } from "@/pipelines/script/pipeline";
import { makeDeps, fixtureCtx } from "./a2-helpers";

async function collectEvents(
  deps: ReturnType<typeof makeDeps>,
  scriptId: string,
): Promise<ScriptStreamEvent[]> {
  const events: ScriptStreamEvent[] = [];
  for await (const event of deps.events.subscribe(scriptId)) {
    events.push(event);
  }
  return events;
}

describe("script pipeline E2E (fixture mode, zero env)", () => {
  it("runs all 7 stages and persists a valid final script", async () => {
    const deps = makeDeps();
    const script = await deps.store.createScript({
      workspaceId: fixtureCtx.workspaceId,
      projectId: fixtureProject.id,
      voiceProfileId: fixtureVoiceProfile.id,
    });

    const result = await runScriptPipeline(deps, {
      input: {
        workspaceId: fixtureCtx.workspaceId,
        projectId: fixtureProject.id,
        frameId: fixtureFrame.id,
        voiceProfileId: fixtureVoiceProfile.id,
        generation: null,
      },
      scriptId: script.id,
      actorUserId: fixtureCtx.userId,
    });
    expect(result.status).toBe("done");

    // Every stage got a done pipeline_runs row, under the frozen stage names.
    const doneStages = deps.runs.rows.filter((r) => r.status === "done").map((r) => r.stage);
    expect(doneStages).toEqual([...SCRIPT_STAGES]);

    // Script persisted, final, with real stats.
    const persisted = await deps.store.getScript(fixtureCtx.workspaceId, script.id);
    expect(persisted?.status).toBe("final");
    expect(persisted?.stats.words).toBeGreaterThan(500);
    expect(persisted?.stats.estRuntimeS).toBeGreaterThan(200);

    // Sections satisfy the frozen entity schema, ordered, hook first.
    const sections = await deps.store.listSections(fixtureCtx.workspaceId, script.id);
    z.array(scriptSectionSchema).parse(sections);
    expect(sections.length).toBeGreaterThanOrEqual(4);
    expect(sections[0]?.kind).toBe("hook");
    expect(sections.map((s) => s.position)).toEqual(sections.map((_, i) => i));
    expect(sections.at(-1)?.kind).toBe("outro");

    // Quality gate passed and was recorded.
    const report = deps.store.getCachedQualityReport(script.id);
    expect(report?.passed).toBe(true);
    expect(report?.hookOk).toBe(true);
    expect(report?.wordCountWithinTolerance).toBe(true);

    // Fact-check matched the research-derived claim to the fixture doc.
    const refs = sections.flatMap((s) => s.factRefs);
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.some((r) => r.researchDocId === fixtureResearchDoc.id)).toBe(true);

    // 6 credits charged exactly once, on completion.
    expect(deps.store.creditEntries).toEqual([
      expect.objectContaining({ delta: -6, reason: "script_generation" }),
    ]);
  });

  it("streams the frozen SSE event sequence", async () => {
    const deps = makeDeps();
    const script = await deps.store.createScript({
      workspaceId: fixtureCtx.workspaceId,
      projectId: fixtureProject.id,
      voiceProfileId: null,
    });
    await runScriptPipeline(deps, {
      input: {
        workspaceId: fixtureCtx.workspaceId,
        projectId: fixtureProject.id,
        frameId: fixtureFrame.id,
        voiceProfileId: null,
        generation: null,
      },
      scriptId: script.id,
      actorUserId: null,
    });

    const events = await collectEvents(deps, script.id);
    for (const event of events) {
      scriptStreamEventSchema.parse(event);
    }

    const types = events.map((e) => e.type);
    expect(types[0]).toBe("stage_started");
    expect(types.at(-1)).toBe("complete");
    expect(types).toContain("outline");
    expect(types).toContain("hooks");
    expect(types).toContain("quality_report");

    // stage_started/stage_done pairs for all seven stages, in order.
    const started = events.filter((e) => e.type === "stage_started").map((e) => e.stage);
    const done = events.filter((e) => e.type === "stage_done").map((e) => e.stage);
    expect(started).toEqual([...SCRIPT_STAGES]);
    expect(done).toEqual([...SCRIPT_STAGES]);

    // Hooks: exactly 3 candidates, exactly one auto-picked, styles tagged.
    const hooks = events.find((e) => e.type === "hooks");
    expect(hooks).toBeDefined();
    if (hooks?.type === "hooks") {
      expect(hooks.candidates).toHaveLength(3);
      expect(hooks.candidates.filter((c) => c.autoPicked)).toHaveLength(1);
    }

    // One section event per outline section, positions sequential.
    const outline = events.find((e) => e.type === "outline");
    const sectionEvents = events.filter((e) => e.type === "section");
    if (outline?.type === "outline") {
      expect(sectionEvents).toHaveLength(outline.outline.sections.length);
    }
    expect(sectionEvents.map((e) => e.position)).toEqual(sectionEvents.map((_, i) => i));
  });

  it("is deterministic: same input twice yields the same script text", async () => {
    const run = async () => {
      const deps = makeDeps();
      const script = await deps.store.createScript({
        workspaceId: fixtureCtx.workspaceId,
        projectId: fixtureProject.id,
        voiceProfileId: fixtureVoiceProfile.id,
      });
      await runScriptPipeline(deps, {
        input: {
          workspaceId: fixtureCtx.workspaceId,
          projectId: fixtureProject.id,
          frameId: fixtureFrame.id,
          voiceProfileId: fixtureVoiceProfile.id,
          generation: null,
        },
        scriptId: script.id,
        actorUserId: null,
      });
      const sections = await deps.store.listSections(fixtureCtx.workspaceId, script.id);
      return sections.map((s) => s.body).join("\n");
    };
    const [first, second] = await Promise.all([run(), run()]);
    expect(first).toBe(second);
  });
});
