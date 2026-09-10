"use client";

import { useState } from "react";
import { skipToken } from "@tanstack/react-query";
import { DESCRIPTION_MODES, type DescriptionMode } from "@/lib/types/enums";
import { trpc } from "@/components/providers/trpc";
import { useWorkspace } from "@/components/providers/workspace-context";
import { useProjectId } from "@/components/projects/project-frame";
import { Button } from "@/components/ui/button";
import { TextArea } from "@/components/ui/field";
import { Tabs } from "@/components/ui/tabs";
import { IconCopy, IconSparkle } from "@/components/ui/icons";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/state";
import { useToast } from "@/components/ui/toast";

const modeLabels: Record<DescriptionMode, string> = {
  informative: "Informative",
  narrative: "Narrative",
  seo: "SEO",
};

/** Three description modes as tabs; generate per mode, edit in place. */
export function DescriptionsPanel() {
  const { workspaceId } = useWorkspace();
  const projectId = useProjectId();
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const [mode, setMode] = useState<DescriptionMode>("informative");
  const [draft, setDraft] = useState<string | null>(null);

  const listQuery = trpc.description.list.useQuery(
    workspaceId !== null ? { workspaceId, projectId } : skipToken,
  );
  const invalidate = () => {
    if (workspaceId !== null) void utils.description.list.invalidate({ workspaceId, projectId });
  };
  const generateMutation = trpc.description.generate.useMutation({
    onSuccess: invalidate,
    onError: () => {
      toast("Could not generate the description — try again.");
    },
  });
  const updateMutation = trpc.description.update.useMutation({
    onSuccess: () => {
      setDraft(null);
      invalidate();
      toast("Description saved.", "success");
    },
    onError: () => {
      toast("Could not save the description — your draft is still in the editor.");
    },
  });

  if (workspaceId === null || listQuery.isLoading) return <LoadingState />;
  if (listQuery.isError) {
    return (
      <ErrorState
        onRetry={() => {
          void listQuery.refetch();
        }}
      />
    );
  }

  const current = (listQuery.data ?? []).find((d) => d.mode === mode);
  const body = draft ?? current?.body ?? "";

  return (
    <div className="space-y-4">
      <Tabs
        tabs={DESCRIPTION_MODES.map((m) => ({ id: m, label: modeLabels[m] }))}
        active={mode}
        onChange={(m) => {
          setMode(m);
          setDraft(null);
        }}
      />
      {current === undefined ? (
        <EmptyState
          title={`No ${modeLabels[mode].toLowerCase()} description yet`}
          hint="Generated from the finished script, not from scratch."
          action={
            <Button
              variant="primary"
              busy={generateMutation.isPending}
              onClick={() => {
                generateMutation.mutate({ workspaceId, projectId, mode, templateId: null });
              }}
            >
              <IconSparkle size={13} /> Generate
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          <TextArea
            aria-label={`${modeLabels[mode]} description`}
            className="min-h-56 font-mono text-[13px]"
            value={body}
            onChange={(e) => {
              setDraft(e.target.value);
            }}
          />
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={draft === null || draft === current.body}
              busy={updateMutation.isPending}
              onClick={() => {
                if (draft !== null) {
                  updateMutation.mutate({ workspaceId, descriptionId: current.id, body: draft });
                }
              }}
            >
              Save changes
            </Button>
            <Button
              size="sm"
              busy={generateMutation.isPending}
              onClick={() => {
                generateMutation.mutate({ workspaceId, projectId, mode, templateId: null });
              }}
            >
              <IconSparkle size={12} /> Regenerate
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void navigator.clipboard.writeText(body).catch(() => undefined);
              }}
            >
              <IconCopy size={12} /> Copy
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
