"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { skipToken } from "@tanstack/react-query";
import type { GenerationTarget } from "@/lib/types/entities";
import type { Outline } from "@/lib/types/pipeline";
import { trpc } from "@/components/providers/trpc";
import { useWorkspace } from "@/components/providers/workspace-context";
import { useProjectId } from "@/components/projects/project-frame";
import { targetLabel } from "@/components/archetypes/target-summary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { TextInput } from "@/components/ui/field";
import { IconCheck, IconClock, IconPlay, IconRefresh, IconSparkle } from "@/components/ui/icons";
import { ErrorState, LoadingState } from "@/components/ui/state";
import { useToast } from "@/components/ui/toast";
import { fmtDuration } from "@/components/lib/format";
import { creditCostLabel, isUiCreditExempt } from "@/components/lib/credits-ui";
import { HOOK_STYLE_LABELS } from "@/components/archetypes/presentation";
import { useScriptStream } from "./use-script-stream";
import { StreamView } from "./stream-view";
import {
  currentStep,
  flowReducer,
  GENERATE_ALL_COST,
  initialFlowState,
  restoreFlow,
  serializeFlow,
  STEP_COSTS,
  STEP_ORDER,
  stepStatus,
  type FlowEvent,
  type StagedFlowState,
  type StepId,
} from "./staged-flow";
import {
  GENERATION_CHANGED_EVENT,
  loadStagedFlowRaw,
  resolveGenerationTarget,
  storeStagedFlow,
} from "./generation-store";

const STEP_TITLES: Record<StepId, string> = {
  topics: "Topic",
  outline: "Outline",
  hooks: "Hook",
  draft: "Draft",
};

const STEP_BLURBS: Record<StepId, string> = {
  topics: "Pick a generated candidate or type your own — typing is free.",
  outline: "Sections with target seconds; tweak headings and lengths inline.",
  hooks: "Three openers, tagged by technique. Pick the one you'd say.",
  draft: "The full script, streamed section by section.",
};

export function StagedGeneratePanel() {
  const { workspaceId, workspace } = useWorkspace();
  const creditExempt = isUiCreditExempt(workspace?.role);
  const projectId = useProjectId();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const { state: streamState, elapsedS, simulated, start, retry } = useScriptStream();
  const [resuming, setResuming] = useState(false);
  const resumeTriedRef = useRef(false);

  // ---- flow state (persisted per project for refresh-resume) --------------
  const [flow, setFlow] = useState<StagedFlowState>(initialFlowState);
  const flowRef = useRef(flow);
  const flowLoadedForRef = useRef<string | null>(null);
  const reloadFlow = useCallback(() => {
    const restored = restoreFlow(loadStagedFlowRaw(projectId)) ?? initialFlowState();
    flowRef.current = restored;
    setFlow(restored);
  }, [projectId]);
  useEffect(() => {
    if (flowLoadedForRef.current === projectId) return;
    flowLoadedForRef.current = projectId;
    resumeTriedRef.current = false;
    reloadFlow();
  }, [projectId, reloadFlow]);

  const dispatch = useCallback(
    (event: FlowEvent) => {
      const next = flowReducer(flowRef.current, event);
      flowRef.current = next;
      setFlow(next);
      storeStagedFlow(projectId, serializeFlow(next));
    },
    [projectId],
  );

  // ---- queries -------------------------------------------------------------
  const projectQuery = trpc.project.get.useQuery(
    workspaceId !== null ? { workspaceId, projectId } : skipToken,
  );
  const framesQuery = trpc.frame.list.useQuery(
    workspaceId !== null ? { workspaceId, projectId } : skipToken,
  );
  const archetypesQuery = trpc.archetypes.list.useQuery(
    workspaceId !== null ? { workspaceId } : skipToken,
  );
  const versionsQuery = trpc.script.listVersions.useQuery(
    workspaceId !== null ? { workspaceId, projectId } : skipToken,
  );
  const latestScript = useMemo(
    () => [...(versionsQuery.data ?? [])].sort((a, b) => b.version - a.version)[0] ?? null,
    [versionsQuery.data],
  );

  // ---- generation target (local stash → project row → latest script) ------
  const project = projectQuery.data ?? null;
  const [generation, setGeneration] = useState<GenerationTarget | null>(null);
  useEffect(() => {
    setGeneration(resolveGenerationTarget(projectId, project, latestScript));
  }, [projectId, project, latestScript]);
  // The style editor on the project frame broadcasts changes; pick them up
  // (and drop stale outline/hooks state) without a refresh.
  useEffect(() => {
    const onChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ projectId?: string } | undefined>).detail;
      if (detail?.projectId !== projectId) return;
      setGeneration(resolveGenerationTarget(projectId, project, latestScript));
      reloadFlow();
    };
    window.addEventListener(GENERATION_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener(GENERATION_CHANGED_EVENT, onChanged);
    };
  }, [projectId, project, latestScript, reloadFlow]);

  // ---- resume an in-flight generation (SSE replay restores history) -------
  useEffect(() => {
    if (resumeTriedRef.current || workspaceId === null || streamState.phase !== "idle") return;
    if (
      latestScript !== null &&
      (latestScript.status === "outlining" || latestScript.status === "drafting")
    ) {
      resumeTriedRef.current = true;
      setResuming(true);
      start(latestScript.id, workspaceId);
    }
  }, [latestScript, workspaceId, streamState.phase, start]);

  // ---- mutations -----------------------------------------------------------
  const creditFailToast = (what: string) => {
    toast(`Could not run ${what} — check your credit balance and try again.`, "error");
  };
  const topicsMutation = trpc.script.topics.useMutation({
    onSuccess: (res) => {
      dispatch({ type: "topics_generated", topics: res.topics });
    },
    onError: () => {
      creditFailToast("topic generation");
    },
  });
  const outlineMutation = trpc.script.outline.useMutation({
    onSuccess: (res) => {
      dispatch({ type: "outline_generated", outline: res.outline });
    },
    onError: () => {
      creditFailToast("the outline");
    },
  });
  const hooksMutation = trpc.script.hooks.useMutation({
    onSuccess: (res) => {
      dispatch({ type: "hooks_generated", hooks: res.hooks });
    },
    onError: () => {
      creditFailToast("hook generation");
    },
  });
  const draftMutation = trpc.script.draft.useMutation({
    onSuccess: (res, variables) => {
      dispatch({ type: "draft_started" });
      resumeTriedRef.current = true; // a fresh run supersedes any resume
      setResuming(false);
      void utils.script.listVersions.invalidate({ workspaceId: variables.workspaceId, projectId });
      start(res.scriptId, variables.workspaceId);
    },
    onError: () => {
      creditFailToast("the draft");
    },
  });
  const generateAllMutation = trpc.script.generate.useMutation({
    onSuccess: (res, variables) => {
      resumeTriedRef.current = true;
      setResuming(false);
      void utils.script.listVersions.invalidate({ workspaceId: variables.workspaceId, projectId });
      start(res.scriptId, variables.workspaceId);
    },
    onError: () => {
      creditFailToast("the full generation");
    },
  });

  // ---- guards --------------------------------------------------------------
  if (workspaceId === null || framesQuery.isLoading || projectQuery.isLoading) {
    return <LoadingState />;
  }
  if (framesQuery.isError || projectQuery.isError) {
    return (
      <ErrorState
        message="Couldn't load this project's frame — the script engine needs it to start."
        onRetry={() => {
          void framesQuery.refetch();
          void projectQuery.refetch();
        }}
      />
    );
  }

  const chosenFrame = (framesQuery.data ?? []).find((f) => f.chosen) ?? null;
  const channelId = projectQuery.data?.channelId ?? null;
  const streaming = streamState.phase !== "idle";
  const running = streamState.phase === "running";
  const styleLabel = targetLabel(generation, archetypesQuery.data ?? []);

  return (
    <div className="space-y-5">
      {/* Control bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {chosenFrame !== null ? chosenFrame.angle : "No frame chosen yet"}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            Style: <span className="font-medium">{styleLabel}</span>
            {chosenFrame !== null
              ? ` · ${chosenFrame.format} · ${chosenFrame.targetMinutes} min target`
              : ""}
            {" · "}
            {creditExempt ? (
              <span>Unlimited generation on this account</span>
            ) : (
              <>
                <span className="tabular-nums">{flow.creditsSpent}</span> credits charged this flow
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {streaming ? (
            <span className="inline-flex items-center gap-1.5 font-mono text-sm text-zinc-600 tabular-nums dark:text-zinc-300">
              <IconClock size={14} className={running ? "text-accent-600" : "text-zinc-400"} />
              {fmtDuration(elapsedS)}
            </span>
          ) : null}
          <Button
            variant="secondary"
            busy={generateAllMutation.isPending || running}
            disabled={chosenFrame === null || streamState.phase === "stalled"}
            title="Runs outline, hooks and draft in order — same stages, one click, summed cost."
            onClick={() => {
              if (chosenFrame === null) return;
              generateAllMutation.mutate({
                workspaceId,
                projectId,
                frameId: chosenFrame.id,
                voiceProfileId: null,
                generation,
              });
            }}
          >
            <IconPlay size={14} /> Generate all
            {creditExempt ? "" : ` (${GENERATE_ALL_COST} credits)`}
          </Button>
        </div>
      </div>

      {chosenFrame === null ? (
        <Card>
          <CardBody className="py-6 text-center">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Outline, hooks and draft write against your chosen frame — pick one first. (Topic
              ideas work without it.)
            </p>
            <Link
              href={`/projects/${projectId}/framing`}
              className="mt-2 inline-block text-sm font-medium text-accent-700 hover:underline dark:text-accent-400"
            >
              Go to framing →
            </Link>
          </CardBody>
        </Card>
      ) : null}

      {simulated ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Fixture replay — live stream endpoint not available in this environment.
        </p>
      ) : null}
      {resuming && running ? (
        <p className="text-xs text-accent-700 dark:text-accent-400">
          Resuming — reconnected to a generation that was already in progress.
        </p>
      ) : null}

      {/* Step rail */}
      <ol className="flex flex-wrap items-center gap-2" aria-label="Generation steps">
        {STEP_ORDER.map((step, i) => {
          const status = stepStatus(flow, step);
          const active = currentStep(flow) === step && !streaming;
          return (
            <li key={step} className="flex items-center gap-2">
              <span
                aria-current={active ? "step" : undefined}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
                  status === "done"
                    ? "border-accent-300 bg-accent-50 text-accent-800 dark:border-accent-800 dark:bg-accent-950 dark:text-accent-300"
                    : active
                      ? "border-accent-600 text-accent-700 dark:border-accent-500 dark:text-accent-400"
                      : "border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400"
                }`}
              >
                {status === "done" ? <IconCheck size={12} /> : <span>{i + 1}.</span>}
                {STEP_TITLES[step]}
                <span className="text-[10px] opacity-70">{STEP_COSTS[step]}cr</span>
              </span>
              {i < STEP_ORDER.length - 1 ? (
                <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-600">
                  →
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>

      {/* Steps */}
      {!streaming ? (
        <div className="space-y-4">
          <TopicsStep
            flow={flow}
            dispatch={dispatch}
            busy={topicsMutation.isPending}
            canGenerate={channelId !== null}
            onGenerate={() => {
              if (channelId === null) return;
              topicsMutation.mutate({ workspaceId, channelId, generation, count: 5 });
            }}
          />
          <OutlineStep
            flow={flow}
            dispatch={dispatch}
            busy={outlineMutation.isPending}
            onGenerate={() => {
              outlineMutation.mutate({
                workspaceId,
                projectId,
                frameId: null,
                topic: flow.chosenTopic,
                generation,
              });
            }}
          />
          <HooksStep
            flow={flow}
            dispatch={dispatch}
            busy={hooksMutation.isPending}
            onGenerate={() => {
              hooksMutation.mutate({
                workspaceId,
                projectId,
                outline: flow.outline,
                generation,
              });
            }}
          />
          <DraftStep
            flow={flow}
            busy={draftMutation.isPending}
            latestFinal={latestScript !== null && latestScript.status === "final"}
            projectId={projectId}
            onStart={() => {
              if (chosenFrame === null) return;
              draftMutation.mutate({
                workspaceId,
                projectId,
                frameId: chosenFrame.id,
                outline: flow.outline,
                hook: flow.chosenHook,
                voiceProfileId: null,
                generation,
              });
            }}
            onReset={() => {
              dispatch({ type: "reset" });
            }}
          />
        </div>
      ) : (
        <div className="space-y-3">
          <StreamView state={streamState} projectId={projectId} retry={retry} />
          {streamState.phase === "complete" || streamState.phase === "failed" ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                dispatch({ type: "reset" });
                window.location.reload();
              }}
            >
              <IconRefresh size={13} /> Start a fresh staged run
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step cards
// ---------------------------------------------------------------------------

function useCreditSuffix(cost: number): string {
  const { workspace } = useWorkspace();
  if (isUiCreditExempt(workspace?.role)) return "";
  return ` (${creditCostLabel(cost, false)})`;
}

function StepCostLabel({ step }: { step: StepId }) {
  const { workspace } = useWorkspace();
  const exempt = isUiCreditExempt(workspace?.role);
  return (
    <span className="ml-auto text-[11px] text-zinc-500 dark:text-zinc-400">
      {exempt
        ? "Included — not billed"
        : `${STEP_COSTS[step]} credit${STEP_COSTS[step] === 1 ? "" : "s"} — charged when you run it`}
    </span>
  );
}

function StepCard({
  step,
  flow,
  children,
}: {
  step: StepId;
  flow: StagedFlowState;
  children: React.ReactNode;
}) {
  const status = stepStatus(flow, step);
  return (
    <Card className={status === "locked" ? "opacity-60" : ""}>
      <CardBody>
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-sm font-semibold">{STEP_TITLES[step]}</h3>
          <Badge tone={status === "done" ? "accent" : "neutral"}>
            {status === "done" ? "done" : status}
          </Badge>
          <StepCostLabel step={step} />
        </div>
        <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">{STEP_BLURBS[step]}</p>
        {children}
      </CardBody>
    </Card>
  );
}

function TopicsStep({
  flow,
  dispatch,
  busy,
  canGenerate,
  onGenerate,
}: {
  flow: StagedFlowState;
  dispatch: (e: FlowEvent) => void;
  busy: boolean;
  canGenerate: boolean;
  onGenerate: () => void;
}) {
  const [draftTitle, setDraftTitle] = useState("");
  const costSuffix = useCreditSuffix(1);
  return (
    <StepCard step="topics" flow={flow}>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          busy={busy}
          disabled={!canGenerate}
          onClick={onGenerate}
        >
          <IconSparkle size={13} />
          {flow.topics === null ? `Generate topics${costSuffix}` : `Regenerate topics${costSuffix}`}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            dispatch({ type: "skip_topics" });
          }}
        >
          Skip — write from the chosen frame (free)
        </Button>
        {flow.topicsSkipped ? <Badge tone="accent">Using the chosen frame</Badge> : null}
      </div>

      {flow.topics !== null ? (
        <div role="radiogroup" aria-label="Topic candidates" className="mt-3 space-y-2">
          {flow.topics.map((t) => {
            const selected = !flow.customTopic && flow.chosenTopic?.title === t.title;
            return (
              <button
                key={t.title}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => {
                  dispatch({ type: "topic_picked", topic: { title: t.title, angle: t.angle } });
                }}
                className={`block w-full cursor-pointer rounded-md border p-3 text-left text-sm transition-colors ${
                  selected
                    ? "border-accent-500 bg-accent-50/60 dark:border-accent-600 dark:bg-accent-950/40"
                    : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
                }`}
              >
                <span className="font-medium">{t.title}</span>
                <span className="mt-0.5 block text-xs text-zinc-600 dark:text-zinc-400">
                  {t.angle}
                </span>
                <span className="mt-0.5 block text-[11px] text-zinc-500 dark:text-zinc-500">
                  {t.rationale}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      <form
        className="mt-3 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (draftTitle.trim() === "") return;
          dispatch({ type: "custom_topic", title: draftTitle });
          setDraftTitle("");
        }}
      >
        <label htmlFor="own-topic" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Or type your own
        </label>
        <TextInput
          id="own-topic"
          className="max-w-md flex-1"
          maxLength={120}
          placeholder="Your topic — using your own skips the charge"
          value={draftTitle}
          onChange={(e) => {
            setDraftTitle(e.target.value);
          }}
        />
        <Button type="submit" size="sm" disabled={draftTitle.trim() === ""}>
          Use this topic (free)
        </Button>
      </form>

      {flow.chosenTopic !== null ? (
        <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
          Chosen: <span className="font-medium">{flow.chosenTopic.title}</span>{" "}
          {flow.customTopic ? <Badge tone="accent">your own — no charge</Badge> : null}
        </p>
      ) : null}
    </StepCard>
  );
}

function OutlineStep({
  flow,
  dispatch,
  busy,
  onGenerate,
}: {
  flow: StagedFlowState;
  dispatch: (e: FlowEvent) => void;
  busy: boolean;
  onGenerate: () => void;
}) {
  const locked = stepStatus(flow, "outline") === "locked";
  const editSection = (index: number, fields: { heading?: string; targetSeconds?: number }) => {
    if (flow.outline === null) return;
    const sections = flow.outline.sections.map((s, i) => (i === index ? { ...s, ...fields } : s));
    const outline: Outline = { sections };
    dispatch({ type: "outline_edited", outline });
  };
  const totalSeconds = flow.outline?.sections.reduce((acc, s) => acc + s.targetSeconds, 0) ?? 0;
  const costSuffix = useCreditSuffix(1);
  return (
    <StepCard step="outline" flow={flow}>
      {locked ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Pick (or type, or skip) a topic first.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <Button variant="primary" size="sm" busy={busy} onClick={onGenerate}>
              <IconSparkle size={13} />
              {flow.outline === null
                ? `Generate outline${costSuffix}`
                : `Regenerate outline${costSuffix}`}
            </Button>
            {flow.outline !== null ? (
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {flow.outline.sections.length} sections · ~{fmtDuration(totalSeconds)} planned
                {" · regenerating clears your hooks"}
              </span>
            ) : null}
          </div>
          {flow.outline !== null ? (
            <ol className="mt-3 space-y-2">
              {flow.outline.sections.map((s, i) => (
                <li
                  key={`${i}-${s.kind}`}
                  className="rounded-md border border-zinc-200 p-2.5 dark:border-zinc-800"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="neutral">{s.kind}</Badge>
                    <input
                      aria-label={`Section ${i + 1} heading`}
                      className="min-w-40 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium hover:border-zinc-300 focus:border-accent-500 focus:outline-none dark:hover:border-zinc-700"
                      value={s.heading}
                      onChange={(e) => {
                        editSection(i, { heading: e.target.value });
                      }}
                    />
                    <label className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                      <input
                        aria-label={`Section ${i + 1} target seconds`}
                        type="number"
                        min={5}
                        max={600}
                        className="w-16 rounded border border-zinc-300 bg-transparent px-1 py-0.5 text-right text-xs tabular-nums dark:border-zinc-700"
                        value={s.targetSeconds}
                        onChange={(e) => {
                          const v = Math.max(1, Math.round(Number(e.target.value) || 0));
                          editSection(i, { targetSeconds: v });
                        }}
                      />
                      sec
                    </label>
                  </div>
                  <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{s.purpose}</p>
                  {s.retentionNote !== "" ? (
                    <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-500">
                      Retention: {s.retentionNote}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : null}
        </>
      )}
    </StepCard>
  );
}

function HooksStep({
  flow,
  dispatch,
  busy,
  onGenerate,
}: {
  flow: StagedFlowState;
  dispatch: (e: FlowEvent) => void;
  busy: boolean;
  onGenerate: () => void;
}) {
  const locked = stepStatus(flow, "hooks") === "locked";
  const costSuffix = useCreditSuffix(1);
  return (
    <StepCard step="hooks" flow={flow}>
      {locked ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Generate the outline first.</p>
      ) : (
        <>
          <Button variant="primary" size="sm" busy={busy} onClick={onGenerate}>
            <IconSparkle size={13} />
            {flow.hooks === null
              ? `Generate 3 hooks${costSuffix}`
              : `Regenerate hooks${costSuffix}`}
          </Button>
          {flow.hooks !== null ? (
            <div
              role="radiogroup"
              aria-label="Hook candidates"
              className="mt-3 grid gap-2 lg:grid-cols-3"
            >
              {flow.hooks.map((h) => {
                const selected = flow.chosenHook?.style === h.style;
                return (
                  <button
                    key={h.style}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => {
                      dispatch({ type: "hook_picked", hook: h });
                    }}
                    className={`cursor-pointer rounded-md border p-3 text-left text-sm transition-colors ${
                      selected
                        ? "border-accent-500 bg-accent-50/60 dark:border-accent-600 dark:bg-accent-950/40"
                        : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
                    }`}
                  >
                    <Badge tone={selected ? "accent" : "blue"}>{HOOK_STYLE_LABELS[h.style]}</Badge>
                    <p className="mt-1.5 text-sm leading-relaxed">{h.body}</p>
                  </button>
                );
              })}
            </div>
          ) : null}
        </>
      )}
    </StepCard>
  );
}

function DraftStep({
  flow,
  busy,
  latestFinal,
  projectId,
  onStart,
  onReset,
}: {
  flow: StagedFlowState;
  busy: boolean;
  latestFinal: boolean;
  projectId: string;
  onStart: () => void;
  onReset: () => void;
}) {
  const locked = stepStatus(flow, "draft") === "locked";
  const costSuffix = useCreditSuffix(4);
  return (
    <StepCard step="draft" flow={flow}>
      {locked ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Pick a hook first.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" busy={busy} onClick={onStart}>
            <IconPlay size={14} /> Write the draft{costSuffix}
          </Button>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            Sections stream in live; retention, voice and fact-check passes run inside.
          </span>
        </div>
      )}
      {latestFinal ? (
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          A finished draft already exists —{" "}
          <Link
            href={`/projects/${projectId}/editor`}
            className="font-medium text-accent-700 hover:underline dark:text-accent-400"
          >
            open it in the editor
          </Link>{" "}
          or{" "}
          <button
            type="button"
            onClick={onReset}
            className="cursor-pointer font-medium text-accent-700 hover:underline dark:text-accent-400"
          >
            start this flow over
          </button>
          .
        </p>
      ) : null}
    </StepCard>
  );
}
