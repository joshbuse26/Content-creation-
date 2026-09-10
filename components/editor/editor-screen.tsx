"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { skipToken } from "@tanstack/react-query";
import type { Revision, ScriptSection } from "@/lib/types/entities";
import type { ScriptId } from "@/lib/types/ids";
import { trpc } from "@/components/providers/trpc";
import { useWorkspace } from "@/components/providers/workspace-context";
import { useProjectId } from "@/components/projects/project-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownItem } from "@/components/ui/dropdown";
import { IconHistory, IconSparkle, IconWarning } from "@/components/ui/icons";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/state";
import { PipelineStatusNote } from "@/components/ui/pipeline-note";
import { fmtDate, fmtDuration, fmtNumber } from "@/components/lib/format";
import { usePipelinePoll } from "@/components/lib/use-pipeline-poll";
import { loadHookCandidates } from "./hook-store";
import { ExportMenu } from "./export-menu";
import { HookSwitcher } from "./hook-switcher";
import { RevisionCard } from "./revision-card";
import { SectionCard } from "./section-card";
import { moveSection } from "./logic/reorder";
import {
  initReviewState,
  isRevisionStale,
  pendingCount,
  previewBodyFor,
  reviewReducer,
  type Decision,
  type RevisionLite,
  type RevisionReviewState,
} from "./logic/revision-state";
import { totalsFor } from "./logic/stats";

type Mode = "write" | "review";

export function EditorScreen() {
  const { workspaceId } = useWorkspace();
  const projectId = useProjectId();
  const utils = trpc.useUtils();

  // ---- versions -----------------------------------------------------------
  const versionsQuery = trpc.script.listVersions.useQuery(
    workspaceId !== null ? { workspaceId, projectId } : skipToken,
  );
  const versions = useMemo(
    () => [...(versionsQuery.data ?? [])].sort((a, b) => b.version - a.version),
    [versionsQuery.data],
  );
  const [pickedScriptId, setPickedScriptId] = useState<ScriptId | null>(null);
  const scriptId = pickedScriptId ?? versions[0]?.id ?? null;

  // ---- script + sections (local overlay for reorder/edits) ---------------
  const scriptQuery = trpc.script.get.useQuery(
    workspaceId !== null && scriptId !== null ? { workspaceId, scriptId } : skipToken,
  );
  const [sections, setSections] = useState<ScriptSection[]>([]);
  useEffect(() => {
    if (scriptQuery.data !== undefined) {
      setSections([...scriptQuery.data.sections].sort((a, b) => a.position - b.position));
    }
  }, [scriptQuery.data]);

  // ---- mode + revisions ---------------------------------------------------
  const [mode, setMode] = useState<Mode>("write");
  const revisionsQuery = trpc.revision.list.useQuery(
    workspaceId !== null && scriptId !== null ? { workspaceId, scriptId } : skipToken,
  );
  const revisions = useMemo(() => revisionsQuery.data ?? [], [revisionsQuery.data]);
  const [review, setReview] = useState<RevisionReviewState | null>(null);
  // Latest review state for mutation callbacks (avoids side effects inside
  // setState updaters and stale closures across sequential accepts).
  const reviewRef = useRef<RevisionReviewState | null>(null);
  useEffect(() => {
    reviewRef.current = review;
  }, [review]);
  useEffect(() => {
    if (revisions.length === 0 || scriptQuery.data === undefined) {
      setReview(null);
      return;
    }
    // Baseline bodies come from the server payload: revision diff ops target
    // the persisted section bodies, and already-accepted revisions are baked
    // into them server-side.
    const bodies = Object.fromEntries(
      scriptQuery.data.sections.map((s) => [s.id as string, s.body]),
    );
    const serverDecisions = Object.fromEntries(revisions.map((r) => [r.id as string, r.status]));
    setReview(
      initReviewState(
        revisions.map((r) => ({ id: r.id, sectionId: r.sectionId, diff: r.diff })),
        bodies,
        serverDecisions,
      ),
    );
  }, [revisions, scriptQuery.data]);

  // ---- mutations ----------------------------------------------------------
  const invalidateScript = () => {
    if (workspaceId !== null && scriptId !== null) {
      void utils.script.get.invalidate({ workspaceId, scriptId });
    }
  };
  const invalidateRevisions = () => {
    if (workspaceId !== null && scriptId !== null) {
      void utils.revision.list.invalidate({ workspaceId, scriptId });
    }
  };
  // Section regeneration and revision passes run as queued pipelines — poll
  // until their results land (fixture mode updates synchronously; the
  // invalidate covers that, the poll covers queued mode).
  const regenPoll = usePipelinePoll(invalidateScript, scriptQuery.data);
  const revisionPoll = usePipelinePoll(invalidateRevisions, revisionsQuery.data);

  const updateSectionMutation = trpc.script.updateSection.useMutation({
    onError: () => {
      invalidateScript();
    },
  });
  const lockMutation = trpc.script.setSectionLock.useMutation();
  const reorderMutation = trpc.script.reorderSections.useMutation({
    onError: () => {
      invalidateScript();
    },
  });
  const regenMutation = trpc.script.regenerateSection.useMutation({
    onSuccess: () => {
      invalidateScript();
      regenPoll.begin();
    },
  });
  const runRevisionMutation = trpc.revision.run.useMutation({
    onSuccess: () => {
      invalidateRevisions();
      revisionPoll.begin();
    },
  });
  const acceptMutation = trpc.revision.accept.useMutation();
  const rejectMutation = trpc.revision.reject.useMutation();

  if (workspaceId === null || versionsQuery.isLoading)
    return <LoadingState label="Loading script…" />;
  if (versionsQuery.isError) {
    return (
      <ErrorState
        onRetry={() => {
          void versionsQuery.refetch();
        }}
      />
    );
  }
  if (scriptId === null) {
    return (
      <EmptyState
        title="No script yet"
        hint="Generate one from your chosen frame — sections stream in live."
        action={
          <Link
            href={`/projects/${projectId}/generate`}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-emerald-700 px-3.5 text-sm font-medium text-white hover:bg-emerald-600 dark:bg-emerald-600"
          >
            <IconSparkle size={14} /> Generate script
          </Link>
        }
      />
    );
  }
  if (scriptQuery.isLoading || scriptQuery.data === undefined) {
    return <LoadingState label="Loading script…" />;
  }

  const { script, qualityReport } = scriptQuery.data;
  const totals = totalsFor(sections.map((s) => s.body));
  // Server-persisted candidates first (script.get), then the localStorage
  // bridge (survives web-process restarts). NEVER fixture defaults: demo
  // copy must not be one click away from persisting into a real script.
  const hookCandidates = scriptQuery.data.hookCandidates ?? loadHookCandidates(scriptId) ?? [];
  const pending = review !== null ? pendingCount(review) : 0;

  const saveSection = (section: ScriptSection, fields: { heading?: string; body?: string }) => {
    setSections((prev) => prev.map((s) => (s.id === section.id ? { ...s, ...fields } : s)));
    updateSectionMutation.mutate({ workspaceId, sectionId: section.id, ...fields });
  };

  const decide = (revision: Revision, decision: "accepted" | "rejected") => {
    const lite: RevisionLite = {
      id: revision.id,
      sectionId: revision.sectionId,
      diff: revision.diff,
    };
    if (decision === "accepted") {
      // Never send an accept for a suggestion that no longer applies cleanly.
      if (reviewRef.current !== null && isRevisionStale(reviewRef.current, lite)) return;
      acceptMutation.mutate(
        { workspaceId, revisionId: revision.id },
        {
          onSuccess: () => {
            const current = reviewRef.current;
            if (current === null) return;
            // The reducer rebases: it reapplies all accepted ops (original
            // line coordinates) against the original body, so earlier
            // accepts never shift this one's line numbers.
            const next = reviewReducer(current, { type: "accept", revision: lite });
            setReview(next);
            const body = next.bodies[lite.sectionId];
            if (body !== undefined) {
              setSections((prev) =>
                prev.map((s) => (s.id === revision.sectionId ? { ...s, body } : s)),
              );
            }
          },
        },
      );
    } else {
      rejectMutation.mutate(
        { workspaceId, revisionId: revision.id },
        {
          onSuccess: () => {
            setReview((s) =>
              s !== null ? reviewReducer(s, { type: "reject", revisionId: lite.id }) : s,
            );
          },
        },
      );
    }
  };

  return (
    <div className="space-y-4">
      {/* Stats + actions bar */}
      <div className="sticky top-0 z-10 -mx-2 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-zinc-200 bg-white/95 px-4 py-2.5 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
        <div className="flex items-center gap-3 text-sm text-zinc-600 tabular-nums dark:text-zinc-300">
          <span>
            <strong className="font-semibold text-zinc-900 dark:text-zinc-100">
              {fmtNumber(totals.words)}
            </strong>{" "}
            words
          </span>
          <span>
            <strong className="font-semibold text-zinc-900 dark:text-zinc-100">
              {fmtDuration(totals.estSeconds)}
            </strong>{" "}
            est runtime
          </span>
          <span>{totals.sections} sections</span>
          <span title="Flesch reading ease">Flesch {script.stats.readability.toFixed(0)}</span>
        </div>
        <span className="flex-1" />

        {/* Version history */}
        <Dropdown
          align="right"
          trigger={
            <span className="inline-flex items-center gap-1.5">
              <IconHistory size={13} /> v{script.version}
            </span>
          }
        >
          {(close) => (
            <>
              {versions.map((v) => (
                <DropdownItem
                  key={v.id}
                  selected={v.id === scriptId}
                  onSelect={() => {
                    setPickedScriptId(v.id);
                    setMode("write");
                    close();
                  }}
                >
                  <span>Version {v.version}</span>
                  <span className="ml-auto text-[11px] text-zinc-400">
                    {v.status} · {fmtDate(v.updatedAt)}
                  </span>
                </DropdownItem>
              ))}
            </>
          )}
        </Dropdown>

        {/* Revision mode toggle */}
        <Button
          size="sm"
          variant={mode === "review" ? "primary" : "secondary"}
          onClick={() => {
            setMode(mode === "review" ? "write" : "review");
          }}
        >
          Revision mode
          {pending > 0 ? (
            <span className="ml-1 rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
              {pending}
            </span>
          ) : null}
        </Button>

        <Button
          size="sm"
          busy={runRevisionMutation.isPending}
          onClick={() => {
            runRevisionMutation.mutate({ workspaceId, scriptId });
          }}
        >
          <IconSparkle size={13} /> Run revision pass (2)
        </Button>

        <ExportMenu workspaceId={workspaceId} scriptId={scriptId} />
      </div>

      <PipelineStatusNote
        poll={revisionPoll}
        working="Revision pass queued — suggestions appear in revision mode when ready."
      />

      {/* Quality gate warnings */}
      {qualityReport !== null && (!qualityReport.passed || qualityReport.warnings.length > 0) ? (
        <div className="flex items-start gap-2 rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-900 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-200">
          <IconWarning size={15} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">
              Quality gate {qualityReport.passed ? "notes" : "did not pass"}
            </p>
            <ul className="mt-1 list-disc pl-5 text-xs">
              {!qualityReport.wordCountWithinTolerance ? (
                <li>
                  Word count {qualityReport.wordCount} vs target {qualityReport.targetWordCount}{" "}
                  (±15%)
                </li>
              ) : null}
              {!qualityReport.readabilityOk ? (
                <li>Flesch reading ease {qualityReport.fleschReadingEase.toFixed(1)} below 60</li>
              ) : null}
              {!qualityReport.hookOk ? (
                <li>Hook runs {qualityReport.hookSeconds}s (max 30s)</li>
              ) : null}
              {qualityReport.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {mode === "review" ? (
        /* ---- Revision mode ---- */
        <div className="space-y-3">
          {revisionsQuery.isLoading ? (
            <LoadingState label="Loading suggestions…" />
          ) : revisions.length === 0 ? (
            <EmptyState
              title="No revision suggestions"
              hint="Run a revision pass — suggestions arrive as line-level diffs you accept or reject one by one."
            />
          ) : (
            revisions.map((rev) => {
              const lite: RevisionLite = {
                id: rev.id,
                sectionId: rev.sectionId,
                diff: rev.diff,
              };
              const section = sections.find((s) => s.id === rev.sectionId);
              const body = review?.bodies[rev.sectionId as string] ?? section?.body ?? "";
              const decision: Decision = review?.decisions[rev.id as string] ?? "pending";
              const stale =
                decision === "pending" && review !== null && isRevisionStale(review, lite);
              const busy =
                (acceptMutation.isPending && acceptMutation.variables.revisionId === rev.id) ||
                (rejectMutation.isPending && rejectMutation.variables.revisionId === rev.id);
              return (
                <RevisionCard
                  key={rev.id}
                  revision={rev}
                  sectionHeading={section?.heading ?? "Section"}
                  sectionBody={body}
                  revisedBody={review !== null && !stale ? previewBodyFor(review, lite) : undefined}
                  decision={decision}
                  stale={stale}
                  busy={busy}
                  onAccept={() => {
                    decide(rev, "accepted");
                  }}
                  onReject={() => {
                    decide(rev, "rejected");
                  }}
                />
              );
            })
          )}
        </div>
      ) : (
        /* ---- Write mode ---- */
        <div className="space-y-3">
          <PipelineStatusNote
            poll={regenPoll}
            working="Section regeneration queued — it refreshes in place when the pipeline finishes."
          />
          {sections.map((section, i) => (
            <SectionCard
              key={section.id}
              section={section}
              isFirst={i === 0}
              isLast={i === sections.length - 1}
              regenBusy={
                regenMutation.isPending && regenMutation.variables.sectionId === section.id
              }
              onMove={(direction) => {
                setSections((prev) => {
                  const moved = moveSection(prev, section.id as string, direction);
                  if (moved === prev) return prev; // no-op (already at an edge)
                  reorderMutation.mutate({
                    workspaceId,
                    scriptId,
                    sectionIds: [...moved].sort((a, b) => a.position - b.position).map((s) => s.id),
                  });
                  return [...moved];
                });
              }}
              onToggleLock={() => {
                const locked = !section.locked;
                setSections((prev) =>
                  prev.map((s) => (s.id === section.id ? { ...s, locked } : s)),
                );
                lockMutation.mutate({ workspaceId, sectionId: section.id, locked });
              }}
              onSaveEdit={(fields) => {
                saveSection(section, fields);
              }}
              onRegenerate={(guidance) => {
                regenMutation.mutate({
                  workspaceId,
                  sectionId: section.id,
                  ...(guidance !== undefined ? { guidance } : {}),
                });
              }}
              hookSlot={
                section.kind === "hook" ? (
                  hookCandidates.length > 0 ? (
                    <HookSwitcher
                      candidates={hookCandidates}
                      currentBody={section.body}
                      onPick={(candidate) => {
                        saveSection(section, { body: candidate.body });
                      }}
                    />
                  ) : (
                    <p className="mb-3 text-xs text-zinc-400 dark:text-zinc-500">
                      Hook candidates unavailable for this script — they are captured during
                      generation and will appear after the next run.
                    </p>
                  )
                ) : undefined
              }
            />
          ))}
          <p className="pt-1 text-xs text-zinc-400 dark:text-zinc-500">
            Locked sections are skipped by regeneration. Alt+↑/↓ reorders the focused section.{" "}
            <Badge tone="neutral">Tip</Badge> Cmd/Ctrl+Enter saves while editing.
          </p>
        </div>
      )}
    </div>
  );
}
