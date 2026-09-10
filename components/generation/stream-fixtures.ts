import { fixtureQualityReport, fixtureScript, fixtureSections } from "@/lib/fixtures";
import type { HookCandidate, ScriptStreamEvent } from "@/lib/types/pipeline";

/**
 * Simulated stream for fixture mode: replays the frozen SSE event union with
 * realistic pacing so the generation screen works before the real
 * /api/script/stream endpoint exists (REQUESTS-A3.md #2). The real endpoint
 * is always tried first; this only runs when it is unreachable.
 */

export const fixtureHookCandidates: HookCandidate[] = [
  {
    style: "open_loop",
    body: fixtureSections[0]?.body ?? "",
    autoPicked: true,
  },
  {
    style: "bold_claim",
    body: "Ninety percent of what you spent on espresso gear did nothing for the cup. Today I prove it with a $200 stack and three blind judges.",
    autoPicked: false,
  },
  {
    style: "stakes",
    body: "If the cheap setup wins this blind test, I'm selling my two-thousand-dollar machine on camera. No re-shoots, no mercy.",
    autoPicked: false,
  },
];

export interface TimedEvent {
  delayMs: number;
  event: ScriptStreamEvent;
}

export function buildFixtureStream(): TimedEvent[] {
  const events: TimedEvent[] = [];
  const push = (delayMs: number, event: ScriptStreamEvent) => {
    events.push({ delayMs, event });
  };

  push(300, { type: "stage_started", stage: "assemble_context" });
  push(900, { type: "stage_done", stage: "assemble_context" });
  push(100, { type: "stage_started", stage: "outline" });
  push(1600, {
    type: "outline",
    outline: {
      sections: fixtureSections.map((s) => ({
        kind: s.kind,
        heading: s.heading,
        purpose: s.retentionNote ?? "Advance the argument",
        retentionNote: s.retentionNote ?? "",
        targetSeconds: Math.max(1, s.estSeconds),
      })),
    },
  });
  push(200, { type: "stage_done", stage: "outline" });
  push(100, { type: "stage_started", stage: "draft_sections" });
  push(900, { type: "hooks", candidates: fixtureHookCandidates });
  fixtureSections.forEach((s, i) => {
    push(i === 0 ? 400 : 1100, {
      type: "section",
      position: s.position,
      section: {
        kind: s.kind,
        heading: s.heading,
        body: s.body,
        estSeconds: Math.max(1, s.estSeconds),
        retentionNote: s.retentionNote,
      },
    });
  });
  push(300, { type: "stage_done", stage: "draft_sections" });
  push(100, { type: "stage_started", stage: "retention_pass" });
  push(1400, { type: "stage_done", stage: "retention_pass" });
  push(100, { type: "stage_started", stage: "voice_pass" });
  push(1400, { type: "stage_done", stage: "voice_pass" });
  push(100, { type: "stage_started", stage: "fact_check" });
  push(1500, { type: "stage_done", stage: "fact_check" });
  push(100, { type: "stage_started", stage: "quality_gate" });
  push(700, { type: "quality_report", report: fixtureQualityReport });
  push(200, { type: "stage_done", stage: "quality_gate" });
  push(300, { type: "complete", scriptId: fixtureScript.id });

  return events;
}
