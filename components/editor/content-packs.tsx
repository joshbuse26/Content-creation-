"use client";

import { useMemo, useState } from "react";
import { skipToken } from "@tanstack/react-query";
import type { HookCandidate } from "@/lib/types/pipeline";
import type { ScriptSection } from "@/lib/types/entities";
import type { WorkspaceId, ProjectId } from "@/lib/types/ids";
import { trpc } from "@/components/providers/trpc";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { IconX } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";

/**
 * Reusable content packs (E4) — save the current script's outline or hook set
 * as a pack, and manage the channel's packs. Scoped to the project's channel
 * (channel isolation: only this channel's packs + workspace-wide packs show).
 * Admin+ save/remove; writer+ apply; viewers see a read-only list.
 */
export function ContentPacks({
  workspaceId,
  projectId,
  sections,
  hookCandidates,
  canWrite,
  canManage,
}: {
  workspaceId: WorkspaceId;
  projectId: ProjectId;
  sections: ScriptSection[];
  hookCandidates: HookCandidate[];
  canWrite: boolean;
  canManage: boolean;
}) {
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const projectQuery = trpc.project.get.useQuery(open ? { workspaceId, projectId } : skipToken);
  const channelId = projectQuery.data?.channelId ?? null;

  const packsQuery = trpc.templates.listContentPacks.useQuery(
    open ? { workspaceId, channelId, kind: null } : skipToken,
  );
  const packs = packsQuery.data ?? [];

  const invalidate = () => {
    void utils.templates.listContentPacks.invalidate({ workspaceId, channelId, kind: null });
  };

  const saveMutation = trpc.templates.saveContentPack.useMutation({
    onSuccess: () => {
      invalidate();
      toast("Saved as a reusable pack.");
    },
    onError: () => {
      toast("Could not save the pack — try again.");
    },
  });
  const removeMutation = trpc.templates.removeContentPack.useMutation({
    onSuccess: invalidate,
    onError: () => {
      toast("Could not remove the pack.");
    },
  });
  const applyMutation = trpc.templates.applyContentPack.useMutation({
    onSuccess: (res) => {
      const count =
        res.payload.kind === "outline"
          ? res.payload.outline.sections.length
          : res.payload.hooks.length;
      toast(`Loaded "${res.contentTemplate.name}" (${count} items) — use it to seed a new draft.`);
    },
    onError: () => {
      toast("Could not apply the pack.");
    },
  });

  // Derive an outline pack from the current section structure.
  const outlinePayload = useMemo(() => {
    const ordered = [...sections].sort((a, b) => a.position - b.position);
    return {
      kind: "outline" as const,
      outline: {
        sections: ordered.map((s) => ({
          kind: s.kind,
          heading: s.heading,
          purpose: "",
          retentionNote: s.retentionNote ?? "",
          targetSeconds: Math.max(1, s.estSeconds),
        })),
      },
    };
  }, [sections]);

  const hookPayload = useMemo(
    () =>
      hookCandidates.length > 0
        ? { kind: "hook_pack" as const, hooks: hookCandidates.slice(0, 6) }
        : null,
    [hookCandidates],
  );

  return (
    <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium"
        onClick={() => {
          setOpen((v) => !v);
        }}
      >
        Reusable packs
        <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">
          save this shape · reuse it on the next video
        </span>
        <span className="ml-auto text-zinc-400">{open ? "▾" : "▸"}</span>
      </button>

      {open ? (
        <div className="space-y-3 border-t border-zinc-100 px-4 py-3 dark:border-zinc-800/60">
          {canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                busy={saveMutation.isPending}
                disabled={outlinePayload.outline.sections.length < 3}
                onClick={() => {
                  saveMutation.mutate({
                    workspaceId,
                    channelId,
                    name: `Outline — ${new Date().toLocaleDateString()}`,
                    payload: outlinePayload,
                  });
                }}
              >
                Save outline as pack
              </Button>
              <Button
                size="sm"
                variant="secondary"
                busy={saveMutation.isPending}
                disabled={hookPayload === null}
                onClick={() => {
                  if (hookPayload !== null) {
                    saveMutation.mutate({
                      workspaceId,
                      channelId,
                      name: `Hooks — ${new Date().toLocaleDateString()}`,
                      payload: hookPayload,
                    });
                  }
                }}
              >
                Save hooks as pack
              </Button>
            </div>
          ) : (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Admins save and remove packs. You can apply an existing pack to seed a new draft.
            </p>
          )}

          {packsQuery.isLoading ? (
            <p className="text-xs text-zinc-400">Loading packs…</p>
          ) : packs.length === 0 ? (
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              No packs for this channel yet — save one above to reuse it later.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {packs.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-2 rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs dark:border-zinc-800"
                >
                  <Badge tone={p.kind === "outline" ? "neutral" : "emerald"}>
                    {p.kind === "outline" ? "outline" : "hooks"}
                  </Badge>
                  <span className="truncate font-medium">{p.name}</span>
                  {p.channelId === null ? (
                    <Badge tone="neutral" title="Available on every channel">
                      workspace-wide
                    </Badge>
                  ) : null}
                  <span className="flex-1" />
                  {canWrite ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      busy={
                        applyMutation.isPending &&
                        applyMutation.variables.contentTemplateId === p.id
                      }
                      onClick={() => {
                        applyMutation.mutate({
                          workspaceId,
                          contentTemplateId: p.id,
                          projectId,
                        });
                      }}
                    >
                      Apply
                    </Button>
                  ) : null}
                  {canManage ? (
                    <IconButton
                      label={`Remove ${p.name}`}
                      disabled={
                        removeMutation.isPending &&
                        removeMutation.variables.contentTemplateId === p.id
                      }
                      onClick={() => {
                        removeMutation.mutate({ workspaceId, contentTemplateId: p.id });
                      }}
                    >
                      <IconX size={12} />
                    </IconButton>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
