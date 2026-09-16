"use client";

import Link from "next/link";
import { SCRIPT_STAGES, type ScriptStage } from "@/lib/types/pipeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { IconCheck, IconWarning } from "@/components/ui/icons";
import { fmtDuration } from "@/components/lib/format";
import type { StageStatus, StreamState } from "./stream-reducer";

/**
 * Shared rendering of a running script pipeline (SSE): stage rail, hook
 * candidates, streamed sections, quality report. Used by both the staged
 * flow's draft step and the "Generate all" orchestrator path.
 */

export const stageLabels: Record<ScriptStage, string> = {
  assemble_context: "Assemble context",
  outline: "Outline",
  draft_sections: "Draft sections",
  retention_pass: "Retention pass",
  voice_pass: "Voice pass",
  fact_check: "Fact-check",
  quality_gate: "Quality gate",
};

export function StreamView({
  state,
  projectId,
  retry,
}: {
  state: StreamState;
  projectId: string;
  retry: () => void;
}) {
  const running = state.phase === "running";
  const totalDrafted = state.sections.reduce(
    (acc, s) => acc + s.body.split(/\s+/).filter((w) => w !== "").length,
    0,
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
      {/* Stage progress */}
      <ol className="space-y-1 self-start rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        {SCRIPT_STAGES.map((stage, i) => (
          <StageRow
            key={stage}
            index={i + 1}
            label={stageLabels[stage]}
            status={state.stages[stage]}
          />
        ))}
        {state.phase === "complete" ? (
          <li className="mt-2 border-t border-zinc-200 pt-2 dark:border-zinc-800">
            <Link
              href={`/projects/${projectId}/editor`}
              className="block rounded-md bg-accent-700 px-3 py-2 text-center text-sm font-medium text-white hover:bg-accent-600 dark:bg-accent-600"
            >
              Open in editor →
            </Link>
          </li>
        ) : null}
      </ol>

      {/* Streaming sections */}
      <div className="space-y-3">
        {state.phase === "stalled" ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <IconWarning size={16} className="mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="font-medium">Live connection lost</p>
              <p className="mt-0.5">
                The pipeline may still be running server-side. Reconnect to pick up where it left
                off — no credits are charged for reconnecting.
              </p>
              <Button size="sm" variant="primary" className="mt-2" onClick={retry}>
                Reconnect
              </Button>
            </div>
          </div>
        ) : null}
        {state.failure !== null ? (
          <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            <IconWarning size={16} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">Generation failed at {stageLabels[state.failure.stage]}</p>
              <p className="mt-0.5">{state.failure.message} Credits are refunded automatically.</p>
            </div>
          </div>
        ) : null}

        {state.hooks.length > 0 ? (
          <Card>
            <CardBody>
              <p className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
                Hook candidates
              </p>
              <div className="space-y-2">
                {state.hooks.map((h) => (
                  <div
                    key={h.style}
                    className={`rounded-md border p-3 text-sm ${
                      h.autoPicked
                        ? "border-accent-400 bg-accent-50/60 dark:border-accent-700 dark:bg-accent-950/40"
                        : "border-zinc-200 dark:border-zinc-800"
                    }`}
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <Badge tone={h.autoPicked ? "accent" : "neutral"}>
                        {h.style.replace(/_/g, " ")}
                      </Badge>
                      {h.autoPicked ? (
                        <span className="text-[11px] text-accent-700 dark:text-accent-400">
                          picked — switch any time in the editor
                        </span>
                      ) : null}
                    </div>
                    {h.body}
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        ) : null}

        {state.sections.map((s) => (
          <Card key={s.position} className="animate-[fadeIn_0.4s_ease]">
            <CardBody>
              <div className="mb-1.5 flex items-center gap-2">
                <Badge tone="neutral">{s.kind}</Badge>
                <h3 className="text-sm font-semibold">{s.heading}</h3>
                <span className="ml-auto text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
                  ~{fmtDuration(s.estSeconds)}
                </span>
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
                {s.body}
              </p>
            </CardBody>
          </Card>
        ))}

        {running ? (
          <div className="flex items-center gap-2 py-2 text-sm text-zinc-500 dark:text-zinc-400">
            <Spinner size={13} />
            {state.stages.draft_sections === "running" ? "Drafting next section…" : "Working…"}
            {totalDrafted > 0 ? (
              <span className="text-xs">({totalDrafted} words so far)</span>
            ) : null}
          </div>
        ) : null}

        {state.report !== null ? (
          <div
            className={`rounded-lg border p-4 text-sm ${
              state.report.passed
                ? "border-accent-300 bg-accent-50 text-accent-900 dark:border-accent-800 dark:bg-accent-950 dark:text-accent-200"
                : "border-yellow-300 bg-yellow-50 text-yellow-900 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-200"
            }`}
          >
            <p className="flex items-center gap-1.5 font-medium">
              {state.report.passed ? <IconCheck size={14} /> : <IconWarning size={14} />}
              Quality gate {state.report.passed ? "passed" : "flagged issues"}
            </p>
            <p className="mt-1 text-xs">
              {state.report.wordCount} words (target {state.report.targetWordCount}) · Flesch{" "}
              {state.report.fleschReadingEase.toFixed(1)} · est runtime{" "}
              {fmtDuration(state.report.estRuntimeSeconds)} · hook {state.report.hookSeconds}s
            </p>
            {state.report.warnings.length > 0 ? (
              <ul className="mt-2 list-disc pl-5 text-xs">
                {state.report.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : null}
            {state.report.styleGates !== null ? (
              <p className="mt-2 text-xs">
                Style gates ran against this script&rsquo;s style card — the full per-gate report is
                in the editor.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StageRow({ index, label, status }: { index: number; label: string; status: StageStatus }) {
  return (
    <li
      className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm ${
        status === "running"
          ? "bg-accent-50 font-medium text-accent-800 dark:bg-accent-950/60 dark:text-accent-300"
          : status === "done"
            ? "text-zinc-700 dark:text-zinc-300"
            : status === "failed"
              ? "text-red-700 dark:text-red-400"
              : "text-zinc-500 dark:text-zinc-400"
      }`}
    >
      <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center">
        {status === "done" ? (
          <IconCheck size={13} className="text-accent-600 dark:text-accent-400" />
        ) : status === "running" ? (
          <Spinner size={12} />
        ) : status === "failed" ? (
          <IconWarning size={13} />
        ) : (
          <span className="text-[10px] tabular-nums">{index}</span>
        )}
      </span>
      {label}
    </li>
  );
}
