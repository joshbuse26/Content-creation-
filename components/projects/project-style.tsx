"use client";

import { useEffect, useMemo, useState } from "react";
import { skipToken } from "@tanstack/react-query";
import type { GenerationTarget } from "@/lib/types/entities";
import type { ProjectId } from "@/lib/types/ids";
import { trpc } from "@/components/providers/trpc";
import { useWorkspace } from "@/components/providers/workspace-context";
import { ArchetypePicker } from "@/components/archetypes/archetype-picker";
import { targetLabel } from "@/components/archetypes/target-summary";
import { Button } from "@/components/ui/button";
import { IconChevronDown, IconChevronUp, IconWarning } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import {
  applyStyleChangeToFlow,
  GENERATION_CHANGED_EVENT,
  resolveGenerationTarget,
  storeGenerationTarget,
} from "@/components/generation/generation-store";

/**
 * Project style row (wave C2) — shows the project's generation target and
 * opens the archetype picker to change it. Lives on the project frame so it
 * is editable from every project screen. Changing the style before a draft
 * re-frames the staged flow (outline/hooks invalidated); after a draft
 * exists it warns that regeneration is needed — existing drafts keep the
 * style they were written with (script rows carry the mode fields).
 */
export function ProjectStyleRow({ projectId }: { projectId: ProjectId }) {
  const { workspaceId } = useWorkspace();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<GenerationTarget | null>(null);

  const utils = trpc.useUtils();
  const archetypesQuery = trpc.archetypes.list.useQuery(
    workspaceId !== null ? { workspaceId } : skipToken,
  );
  const projectQuery = trpc.project.get.useQuery(
    workspaceId !== null ? { workspaceId, projectId } : skipToken,
  );
  const versionsQuery = trpc.script.listVersions.useQuery(
    workspaceId !== null ? { workspaceId, projectId } : skipToken,
  );
  const latestScript = useMemo(
    () => [...(versionsQuery.data ?? [])].sort((a, b) => b.version - a.version)[0] ?? null,
    [versionsQuery.data],
  );
  const hasDraft = latestScript !== null;
  const project = projectQuery.data ?? null;

  useEffect(() => {
    setOpen(false);
    setTarget(resolveGenerationTarget(projectId, project, latestScript));
  }, [projectId, project, latestScript]);

  const archetypes = archetypesQuery.data ?? [];

  // Server persistence (project.setGenerationTarget); the localStorage stash
  // below stays as the fallback if the save fails.
  const saveMutation = trpc.project.setGenerationTarget.useMutation({
    onSuccess: () => {
      if (workspaceId !== null) {
        void utils.project.get.invalidate({ workspaceId, projectId });
        void utils.project.list.invalidate();
      }
    },
    onError: () => {
      toast(
        "Couldn't save the style to the project — it's kept locally and still applies to your next generation.",
        "info",
      );
    },
  });

  const applyChange = (next: GenerationTarget | null) => {
    setTarget(next);
    storeGenerationTarget(projectId, next);
    if (workspaceId !== null) {
      saveMutation.mutate({ workspaceId, projectId, generation: next });
    }
    applyStyleChangeToFlow(projectId);
    window.dispatchEvent(new CustomEvent(GENERATION_CHANGED_EVENT, { detail: { projectId } }));
    if (hasDraft) {
      toast(
        "Style updated. Existing drafts keep their old style — regenerate to apply the new one.",
        "info",
      );
    }
  };

  return (
    <div className="mb-4 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Style</span>
        <span className="text-sm font-medium">{targetLabel(target, archetypes)}</span>
        <span className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={open}
          onClick={() => {
            setOpen((v) => !v);
          }}
        >
          {open ? (
            <>
              Close <IconChevronUp size={13} />
            </>
          ) : (
            <>
              Change style <IconChevronDown size={13} />
            </>
          )}
        </Button>
      </div>
      {open ? (
        <div className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          {hasDraft ? (
            <p className="mb-3 flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              <IconWarning size={13} className="mt-0.5 shrink-0" />
              This project already has a draft. Changing the style only affects future generations —
              regenerate the script to apply it.
            </p>
          ) : (
            <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
              Changing the style re-frames the staged flow: any generated outline and hooks are
              cleared so they can be rewritten in the new style.
            </p>
          )}
          {archetypesQuery.isLoading ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Loading styles…</p>
          ) : archetypesQuery.isError ? (
            <p className="text-xs text-red-600 dark:text-red-400">
              Couldn&rsquo;t load the style catalog — try again in a moment.
            </p>
          ) : (
            <ArchetypePicker
              archetypes={archetypes}
              value={target}
              allowNone
              onChange={applyChange}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
