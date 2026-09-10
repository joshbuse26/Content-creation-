"use client";

import { useState } from "react";
import { skipToken } from "@tanstack/react-query";
import { trpc } from "@/components/providers/trpc";
import { useWorkspace } from "@/components/providers/workspace-context";
import { useProjectId } from "@/components/projects/project-frame";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { IconCheck, IconCopy, IconSparkle } from "@/components/ui/icons";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/state";
import { PipelineStatusNote } from "@/components/ui/pipeline-note";
import { useToast } from "@/components/ui/toast";
import { usePipelinePoll } from "@/components/lib/use-pipeline-poll";

/** 25 scored title options grouped by pattern family, with copy buttons. */
export function TitlesPanel() {
  const { workspaceId } = useWorkspace();
  const projectId = useProjectId();
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const [copied, setCopied] = useState<string | null>(null);

  const latestQuery = trpc.titles.latest.useQuery(
    workspaceId !== null ? { workspaceId, projectId } : skipToken,
  );
  const invalidate = () => {
    if (workspaceId !== null) void utils.titles.latest.invalidate({ workspaceId, projectId });
  };
  // Title generation is a queued pipeline — poll until the set lands.
  const generatePoll = usePipelinePoll(invalidate, latestQuery.data);
  const generateMutation = trpc.titles.generate.useMutation({
    onSuccess: () => {
      invalidate();
      generatePoll.begin();
    },
    onError: () => {
      toast("Could not queue the title generation — try again.");
    },
  });

  if (workspaceId === null || latestQuery.isLoading)
    return <LoadingState label="Loading titles…" />;
  if (latestQuery.isError) {
    return (
      <ErrorState
        onRetry={() => {
          void latestQuery.refetch();
        }}
      />
    );
  }

  const titleSet = latestQuery.data ?? null;
  const groups = new Map<string, { text: string; score: number }[]>();
  if (titleSet !== null) {
    for (const opt of titleSet.options) {
      const list = groups.get(opt.patternFamily) ?? [];
      list.push({ text: opt.text, score: opt.score });
      groups.set(opt.patternFamily, list);
    }
    for (const list of groups.values()) list.sort((a, b) => b.score - a.score);
  }

  const copy = (text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(text);
        window.setTimeout(() => {
          setCopied((c) => (c === text ? null : c));
        }, 1500);
      })
      .catch(() => undefined);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {titleSet !== null
            ? `${titleSet.options.length} options across ${groups.size} pattern families, scored against your niche's outlier titles.`
            : "Generate titles from the chosen frame and niche title patterns. 1 credit."}
        </p>
        <Button
          busy={generateMutation.isPending}
          onClick={() => {
            generateMutation.mutate({ workspaceId, projectId });
          }}
        >
          <IconSparkle size={13} /> {titleSet !== null ? "Regenerate" : "Generate titles"}
        </Button>
      </div>
      <PipelineStatusNote
        poll={generatePoll}
        working="Title generation queued — options appear below when ready."
      />

      {titleSet === null ? (
        <EmptyState
          title="No titles yet"
          hint="Generate 25 options across at least 5 pattern families."
        />
      ) : (
        <div className="space-y-6">
          {[...groups.entries()].map(([family, options]) => (
            <div key={family}>
              <h3 className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
                {family.replace(/_/g, " ")}
              </h3>
              <ul className="divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800/60 dark:border-zinc-800 dark:bg-zinc-900">
                {options.map((opt) => (
                  <li key={opt.text} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="flex-1 text-sm">{opt.text}</span>
                    <Badge
                      tone={opt.score >= 85 ? "emerald" : opt.score >= 70 ? "yellow" : "neutral"}
                    >
                      {Math.round(opt.score)}
                    </Badge>
                    <IconButton
                      label="Copy title"
                      onClick={() => {
                        copy(opt.text);
                      }}
                    >
                      {copied === opt.text ? (
                        <IconCheck size={13} className="text-emerald-600" />
                      ) : (
                        <IconCopy size={13} />
                      )}
                    </IconButton>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
