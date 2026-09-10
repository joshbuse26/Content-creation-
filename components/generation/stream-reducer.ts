import {
  SCRIPT_STAGES,
  type HookCandidate,
  type QualityGateReport,
  type ScriptStage,
  type ScriptStreamEvent,
  type DraftOutput,
} from "@/lib/types/pipeline";

/** Pure reducer over the frozen SSE event union (lib/types/pipeline.ts). */

export type StageStatus = "pending" | "running" | "done" | "failed";
/**
 * "stalled": the SSE connection died mid-run (or could not be established in
 * live mode) — the pipeline may still be running server-side; the UI offers a
 * retry that re-opens the stream (the replay endpoint restores history).
 */
export type StreamPhase = "idle" | "running" | "complete" | "failed" | "stalled";

export type StreamedSection = DraftOutput["sections"][number] & { position: number };

export interface StreamState {
  phase: StreamPhase;
  stages: Record<ScriptStage, StageStatus>;
  sections: StreamedSection[];
  hooks: HookCandidate[];
  report: QualityGateReport | null;
  failure: { stage: ScriptStage; message: string } | null;
  scriptId: string | null;
}

export function initialStreamState(): StreamState {
  return {
    phase: "idle",
    stages: Object.fromEntries(SCRIPT_STAGES.map((s) => [s, "pending"])) as Record<
      ScriptStage,
      StageStatus
    >,
    sections: [],
    hooks: [],
    report: null,
    failure: null,
    scriptId: null,
  };
}

export function applyStreamEvent(state: StreamState, event: ScriptStreamEvent): StreamState {
  switch (event.type) {
    case "stage_started":
      return {
        ...state,
        phase: "running",
        stages: { ...state.stages, [event.stage]: "running" },
      };
    case "stage_done":
      return { ...state, stages: { ...state.stages, [event.stage]: "done" } };
    case "outline":
      return state; // outline drives the section skeleton server-side; sections stream next
    case "section": {
      const next = state.sections.filter((s) => s.position !== event.position);
      next.push({ ...event.section, position: event.position });
      next.sort((a, b) => a.position - b.position);
      return { ...state, sections: next };
    }
    case "hooks":
      return { ...state, hooks: event.candidates };
    case "quality_report":
      return { ...state, report: event.report };
    case "failed":
      return {
        ...state,
        phase: "failed",
        stages: { ...state.stages, [event.stage]: "failed" },
        failure: { stage: event.stage, message: event.message },
      };
    case "complete":
      return { ...state, phase: "complete", scriptId: event.scriptId };
  }
}
