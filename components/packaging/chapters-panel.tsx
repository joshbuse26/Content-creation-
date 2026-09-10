"use client";

import { useState } from "react";
import { skipToken } from "@tanstack/react-query";
import type { ChapterEntry } from "@/lib/types/entities";
import { trpc } from "@/components/providers/trpc";
import { useWorkspace } from "@/components/providers/workspace-context";
import { useProjectId } from "@/components/projects/project-frame";
import { Button, IconButton } from "@/components/ui/button";
import { TextInput } from "@/components/ui/field";
import { IconCopy, IconPlus, IconSparkle, IconTrash } from "@/components/ui/icons";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/state";
import { fmtDuration, parseDuration } from "@/components/lib/format";

/** Editable chapter list (derived from section runtimes, then hand-tuned). */
export function ChaptersPanel() {
  const { workspaceId } = useWorkspace();
  const projectId = useProjectId();
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState<{ ts: string; label: string }[] | null>(null);
  const [parseError, setParseError] = useState(false);

  const latestQuery = trpc.chapters.latest.useQuery(
    workspaceId !== null ? { workspaceId, projectId } : skipToken,
  );
  const invalidate = () => {
    if (workspaceId !== null) void utils.chapters.latest.invalidate({ workspaceId, projectId });
  };
  const deriveMutation = trpc.chapters.derive.useMutation({
    onSuccess: () => {
      setDraft(null);
      invalidate();
    },
  });
  const updateMutation = trpc.chapters.update.useMutation({
    onSuccess: () => {
      setDraft(null);
      invalidate();
    },
  });

  if (workspaceId === null || latestQuery.isLoading) return <LoadingState />;
  if (latestQuery.isError) {
    return (
      <ErrorState
        onRetry={() => {
          void latestQuery.refetch();
        }}
      />
    );
  }

  const chapterSet = latestQuery.data ?? null;
  const rows =
    draft ??
    chapterSet?.entries.map((e) => ({ ts: fmtDuration(e.tsSeconds), label: e.label })) ??
    [];

  const setRow = (i: number, patch: Partial<{ ts: string; label: string }>) => {
    const next = rows.map((r, j) => (j === i ? { ...r, ...patch } : r));
    setDraft(next);
  };

  const save = () => {
    if (chapterSet === null || draft === null) return;
    setParseError(false);
    const entries: ChapterEntry[] = [];
    for (const row of draft) {
      const ts = parseDuration(row.ts);
      if (ts === null || row.label.trim() === "") {
        setParseError(true);
        return;
      }
      entries.push({ tsSeconds: ts, label: row.label.trim().slice(0, 120) });
    }
    entries.sort((a, b) => a.tsSeconds - b.tsSeconds);
    updateMutation.mutate({ workspaceId, chapterSetId: chapterSet.id, entries });
  };

  const youtubeText = rows.map((r) => `${r.ts} ${r.label}`).join("\n");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Derived from section runtimes — adjust timestamps after your edit.
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void navigator.clipboard.writeText(youtubeText).catch(() => undefined);
            }}
          >
            <IconCopy size={12} /> Copy for YouTube
          </Button>
          <Button
            size="sm"
            busy={deriveMutation.isPending}
            onClick={() => {
              deriveMutation.mutate({ workspaceId, projectId });
            }}
          >
            <IconSparkle size={12} /> {chapterSet !== null ? "Re-derive" : "Derive chapters"}
          </Button>
        </div>
      </div>

      {chapterSet === null && rows.length === 0 ? (
        <EmptyState title="No chapters yet" hint="Derive them from the script's section timings." />
      ) : (
        <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {rows.map((row, i) => (
              <li key={i} className="flex items-center gap-2 px-3 py-2">
                <TextInput
                  aria-label={`Chapter ${i + 1} timestamp`}
                  className="h-8 w-20 text-center font-mono text-xs tabular-nums"
                  value={row.ts}
                  onChange={(e) => {
                    setRow(i, { ts: e.target.value });
                  }}
                />
                <TextInput
                  aria-label={`Chapter ${i + 1} label`}
                  className="h-8 flex-1 text-sm"
                  value={row.label}
                  onChange={(e) => {
                    setRow(i, { label: e.target.value });
                  }}
                />
                <IconButton
                  label="Remove chapter"
                  onClick={() => {
                    setDraft(rows.filter((_, j) => j !== i));
                  }}
                >
                  <IconTrash size={12} />
                </IconButton>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2 border-t border-zinc-100 px-3 py-2 dark:border-zinc-800/60">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft([...rows, { ts: rows.length === 0 ? "0:00" : "", label: "" }]);
              }}
            >
              <IconPlus size={12} /> Add chapter
            </Button>
            <span className="flex-1" />
            {parseError ? (
              <span className="text-xs text-red-600 dark:text-red-400">
                Timestamps must be m:ss and labels non-empty.
              </span>
            ) : null}
            <Button
              size="sm"
              variant="primary"
              disabled={draft === null}
              busy={updateMutation.isPending}
              onClick={save}
            >
              Save chapters
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
