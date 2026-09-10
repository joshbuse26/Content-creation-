"use client";

import Link from "next/link";
import { skipToken } from "@tanstack/react-query";
import { SCRIPT_STAGES, type ScriptStage } from "@/lib/types/pipeline";
import { trpc } from "@/components/providers/trpc";
import { useWorkspace } from "@/components/providers/workspace-context";
import { useProjectId } from "@/components/projects/project-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { IconCheck, IconClock, IconPlay, IconWarning } from "@/components/ui/icons";
import { ErrorState, LoadingState } from "@/components/ui/state";
import { fmtDuration } from "@/components/lib/format";
import { useScriptStream } from "./use-script-stream";
import type { StageStatus } from "./stream-reducer";

const stageLabels: Record<ScriptStage, string> = {
  assemble_context: "Assemble context",
  outline: "Outline",
  draft_sections: "Draft sections",
  retention_pass: "Retention pass",
  voice_pass: "Voice pass",
  fact_check: "Fact-check",
  quality_gate: "Quality gate",
};

export function GeneratePanel() {
  const { workspaceId } = useWorkspace();
  const projectId = useProjectId();
  const { state, elapsedS, simulated, start } = useScriptStream();

  const framesQuery = trpc.frame.list.useQuery(
    workspaceId !== null ? { workspaceId, projectId } : skipToken,
  );
  const generateMutation = trpc.script.generate.useMutation({
    onSuccess: (res) => {
      start(res.scriptId);
    },
  });

  if (workspaceId === null || framesQuery.isLoading) return <LoadingState />;
  if (framesQuery.isError) {
    return (
      <ErrorState
        onRetry={() => {
          void framesQuery.refetch();
        }}
      />
    );
  }

  const chosenFrame = (framesQuery.data ?? []).find((f) => f.chosen);

  if (chosenFrame === undefined) {
    return (
      <Card>
        <CardBody className="py-10 text-center">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Pick a frame first — the script engine writes against it.
          </p>
          <Link
            href={`/projects/${projectId}/framing`}
            className="mt-3 inline-block text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400"
          >
            Go to framing →
          </Link>
        </CardBody>
      </Card>
    );
  }

  const running = state.phase === "running";
  const totalDrafted = state.sections.reduce((acc, s) => acc + s.body.split(/\s+/).filter((w) => w !== "").length, 0);

  return (
    <div className="space-y-6">
      {/* Control bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{chosenFrame.angle}</p>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {chosenFrame.format} · {chosenFrame.targetMinutes} min target · optimizing{" "}
            {chosenFrame.outcome.replace("_", " ")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {state.phase !== "idle" ? (
            <span className="inline-flex items-center gap-1.5 font-mono text-sm text-zinc-600 tabular-nums dark:text-zinc-300">
              <IconClock size={14} className={running ? "text-emerald-600" : "text-zinc-400"} />
              {fmtDuration(elapsedS)}
            </span>
          ) : null}
          <Button
            variant="primary"
            busy={generateMutation.isPending || running}
            onClick={() => {
              generateMutation.mutate({
                workspaceId,
                projectId,
                frameId: chosenFrame.id,
                voiceProfileId: null,
              });
            }}
          >
            <IconPlay size={14} />
            {state.phase === "complete" || state.phase === "failed"
              ? "Generate again (6 credits)"
              : running
                ? "Writing…"
                : "Generate script (6 credits)"}
          </Button>
        </div>
      </div>

      {generateMutation.isError ? (
        <p className="text-sm text-red-600 dark:text-red-400">
          Could not start generation — check your credit balance and try again.
        </p>
      ) : null}
      {simulated ? (
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          Fixture replay — live stream endpoint not available in this environment.
        </p>
      ) : null}

      {state.phase !== "idle" ? (
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
                  className="block rounded-md bg-emerald-700 px-3 py-2 text-center text-sm font-medium text-white hover:bg-emerald-600 dark:bg-emerald-600"
                >
                  Open in editor →
                </Link>
              </li>
            ) : null}
          </ol>

          {/* Streaming sections */}
          <div className="space-y-3">
            {state.failure !== null ? (
              <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                <IconWarning size={16} className="mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">
                    Generation failed at {stageLabels[state.failure.stage]}
                  </p>
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
                            ? "border-emerald-400 bg-emerald-50/60 dark:border-emerald-700 dark:bg-emerald-950/40"
                            : "border-zinc-200 dark:border-zinc-800"
                        }`}
                      >
                        <div className="mb-1 flex items-center gap-2">
                          <Badge tone={h.autoPicked ? "emerald" : "neutral"}>
                            {h.style.replace(/_/g, " ")}
                          </Badge>
                          {h.autoPicked ? (
                            <span className="text-[11px] text-emerald-700 dark:text-emerald-400">
                              auto-picked — switch any time in the editor
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
                    <span className="ml-auto text-xs text-zinc-400 tabular-nums">
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
                {state.stages.draft_sections === "running"
                  ? "Drafting next section…"
                  : "Working…"}
                {totalDrafted > 0 ? <span className="text-xs">({totalDrafted} words so far)</span> : null}
              </div>
            ) : null}

            {state.report !== null ? (
              <div
                className={`rounded-lg border p-4 text-sm ${
                  state.report.passed
                    ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
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
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <Card>
          <CardBody className="py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
            <p>
              Seven stages: context → outline → drafts (streamed live) → retention → voice →
              fact-check → quality gate.
            </p>
            <p className="mt-1">Typical wall-clock: under 3 minutes for a 10-minute video.</p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function StageRow({ index, label, status }: { index: number; label: string; status: StageStatus }) {
  return (
    <li
      className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm ${
        status === "running"
          ? "bg-emerald-50 font-medium text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
          : status === "done"
            ? "text-zinc-700 dark:text-zinc-300"
            : status === "failed"
              ? "text-red-700 dark:text-red-400"
              : "text-zinc-400 dark:text-zinc-500"
      }`}
    >
      <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center">
        {status === "done" ? (
          <IconCheck size={13} className="text-emerald-600 dark:text-emerald-400" />
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
