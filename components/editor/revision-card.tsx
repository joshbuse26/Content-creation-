"use client";

import type { Revision } from "@/lib/types/entities";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconCheck, IconX } from "@/components/ui/icons";
import { revisionDiffRows } from "./logic/diff";
import type { Decision } from "./logic/revision-state";

/**
 * One revision suggestion: rationale, red/green line diff against the
 * current section body, per-suggestion accept/reject.
 */
export function RevisionCard({
  revision,
  sectionHeading,
  sectionBody,
  decision,
  busy = false,
  onAccept,
  onReject,
}: {
  revision: Revision;
  sectionHeading: string;
  sectionBody: string;
  decision: Decision;
  busy?: boolean;
  onAccept: () => void;
  onReject: () => void;
}) {
  const rows = revisionDiffRows(sectionBody, revision.diff);

  return (
    <div
      data-testid={`revision-${revision.id}`}
      className={`rounded-lg border bg-white dark:bg-zinc-900 ${
        decision === "accepted"
          ? "border-emerald-300 dark:border-emerald-800"
          : decision === "rejected"
            ? "border-zinc-200 opacity-60 dark:border-zinc-800"
            : "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-zinc-400 uppercase">{sectionHeading}</p>
          <p className="mt-0.5 text-sm font-medium" title={revision.rationale}>
            {revision.suggestion}
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400" title={revision.rationale}>
            Why: {revision.rationale}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {decision === "pending" ? (
            <>
              <Button
                size="sm"
                variant="primary"
                busy={busy}
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
            <Badge tone={decision === "accepted" ? "emerald" : "neutral"}>{decision}</Badge>
          )}
        </div>
      </div>
      {decision !== "accepted" ? (
        <div className="border-t border-zinc-100 font-mono text-[13px] leading-relaxed dark:border-zinc-800/60">
          {rows.map((row, i) => (
            <div
              key={i}
              className={`flex gap-2 px-4 py-0.5 whitespace-pre-wrap ${
                row.type === "added"
                  ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200"
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
