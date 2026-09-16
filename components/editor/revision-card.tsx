"use client";

import type { Revision } from "@/lib/types/entities";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconCheck, IconWarning, IconX } from "@/components/ui/icons";
import { applyDiffOps, computeLineDiff } from "./logic/diff";
import type { Decision } from "./logic/revision-state";

/**
 * One revision suggestion: rationale, red/green line diff against the
 * current section body, per-suggestion accept/reject.
 *
 * `revisedBody` is the preview target — the section body with this
 * suggestion applied on top of any already-accepted ones (rebased by the
 * caller). Without it, the diff falls back to applying the ops directly to
 * `sectionBody`, which is only correct when nothing else was accepted.
 * `stale` marks a suggestion that no longer applies cleanly (its lines were
 * changed by an accepted suggestion): actions are disabled except reject.
 */
export function RevisionCard({
  revision,
  sectionHeading,
  sectionBody,
  revisedBody,
  decision,
  stale = false,
  busy = false,
  onAccept,
  onReject,
}: {
  revision: Revision;
  sectionHeading: string;
  sectionBody: string;
  revisedBody?: string;
  decision: Decision;
  stale?: boolean;
  busy?: boolean;
  onAccept: () => void;
  onReject: () => void;
}) {
  const rows = stale
    ? []
    : computeLineDiff(sectionBody, revisedBody ?? applyDiffOps(sectionBody, revision.diff));

  return (
    <div
      data-testid={`revision-${revision.id}`}
      className={`rounded-lg border bg-white dark:bg-zinc-900 ${
        decision === "accepted"
          ? "border-accent-300 dark:border-accent-800"
          : decision === "rejected"
            ? "border-zinc-200 opacity-60 dark:border-zinc-800"
            : "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-zinc-500 uppercase dark:text-zinc-400">
            {sectionHeading}
          </p>
          <p className="mt-0.5 text-sm font-medium" title={revision.rationale}>
            {revision.suggestion}
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400" title={revision.rationale}>
            Why: {revision.rationale}
          </p>
          {stale && decision === "pending" ? (
            <p className="mt-1.5 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
              <IconWarning size={12} /> Outdated — an accepted suggestion changed these lines, so
              this one no longer applies cleanly.
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {decision === "pending" ? (
            <>
              <Button
                size="sm"
                variant="primary"
                busy={busy}
                disabled={stale}
                onClick={onAccept}
                aria-label="Accept suggestion"
              >
                <IconCheck size={12} /> Accept
              </Button>
              <Button size="sm" busy={busy} onClick={onReject} aria-label="Reject suggestion">
                <IconX size={12} /> Reject
              </Button>
            </>
          ) : (
            <Badge tone={decision === "accepted" ? "accent" : "neutral"}>{decision}</Badge>
          )}
        </div>
      </div>
      {decision !== "accepted" && rows.length > 0 ? (
        <div className="border-t border-zinc-100 font-mono text-[13px] leading-relaxed dark:border-zinc-800/60">
          {rows.map((row, i) => (
            <div
              key={i}
              className={`flex gap-2 px-4 py-0.5 whitespace-pre-wrap ${
                row.type === "added"
                  ? "bg-accent-50 text-accent-900 dark:bg-accent-950/50 dark:text-accent-200"
                  : row.type === "removed"
                    ? "bg-red-50 text-red-900 line-through decoration-red-400/60 dark:bg-red-950/40 dark:text-red-300"
                    : "text-zinc-500 dark:text-zinc-400"
              }`}
            >
              <span className="w-3 shrink-0 select-none">
                {row.type === "added" ? "+" : row.type === "removed" ? "−" : " "}
              </span>
              <span>{row.text}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
