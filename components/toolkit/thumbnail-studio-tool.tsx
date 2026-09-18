"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { skipToken } from "@tanstack/react-query";
import type { Project } from "@/lib/types/entities";
import type { ProjectId } from "@/lib/types/ids";
import { trpc } from "@/components/providers/trpc";
import { useWorkspace } from "@/components/providers/workspace-context";
import { ThumbnailBoard } from "@/components/packaging/thumbnail-board";
import { PageHeader } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Label, Select, TextInput } from "@/components/ui/field";
import { IconPlus } from "@/components/ui/icons";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/state";
import { useToast } from "@/components/ui/toast";

/**
 * Thumbnail Studio as a Tool (Tools → Thumbnail Studio). Thumbnails belong
 * to a video, so the surface is: pick the video (project) — or name a new
 * one in one field — then the same whiteboard the packaging stage uses:
 * real 1280×720 images, star the keepers, pick a winner, export. All the
 * controls are on this screen; nothing routes through a chat questionnaire.
 */
export function ThumbnailStudioTool() {
  const { workspaceId, channelId, channels, channelsLoading } = useWorkspace();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<ProjectId | null>(null);
  const [newTitle, setNewTitle] = useState("");

  const projectsQuery = trpc.project.list.useQuery(
    workspaceId !== null
      ? { workspaceId, ...(channelId !== null ? { channelId } : {}), limit: 50 }
      : skipToken,
  );
  const projects = projectsQuery.data ?? [];

  // Default to the most recent video once the list loads.
  useEffect(() => {
    const first = projects[0];
    if (selectedId === null && first !== undefined) setSelectedId(first.id);
  }, [projects, selectedId]);

  const createMutation = trpc.project.create.useMutation({
    onSuccess: (project: Project) => {
      setNewTitle("");
      setSelectedId(project.id);
      void projectsQuery.refetch();
    },
    onError: () => {
      toast("Couldn't create that video.");
    },
  });

  const createChannel = channels.find((c) => c.id === channelId) ?? channels[0];

  if (workspaceId === null || projectsQuery.isLoading || channelsLoading) {
    return <LoadingState label="Loading your videos…" />;
  }
  if (projectsQuery.isError) {
    return (
      <ErrorState
        message="Couldn't load your videos."
        onRetry={() => {
          void projectsQuery.refetch();
        }}
      />
    );
  }

  const quickCreate = (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const title = newTitle.trim();
        if (title === "" || createChannel === undefined) return;
        createMutation.mutate({ workspaceId, channelId: createChannel.id, title, ideaId: null });
      }}
    >
      <div className="min-w-64 flex-1">
        <Label htmlFor="thumb-new-title">New video</Label>
        <TextInput
          id="thumb-new-title"
          placeholder="Working title, e.g. The cheap phone that beats the flagships"
          value={newTitle}
          onChange={(e) => {
            setNewTitle(e.target.value);
          }}
        />
      </div>
      <Button
        type="submit"
        variant="primary"
        busy={createMutation.isPending}
        disabled={newTitle.trim() === "" || createChannel === undefined}
      >
        <IconPlus size={13} /> Start thumbnails
      </Button>
    </form>
  );

  return (
    <div>
      <PageHeader
        title="Thumbnail Studio"
        subtitle="Generate real 1280×720 thumbnails for a video — star the keepers, pick a winner, export."
      />
      {createChannel === undefined ? (
        <EmptyState
          title="Connect a channel first"
          hint="Thumbnails are styled from your channel's niche and voice."
          action={
            <Link href="/channels" className="text-sm font-medium text-accent-400 hover:underline">
              Connect a channel →
            </Link>
          }
        />
      ) : (
        <div className="space-y-5">
          <div className="grid gap-3 rounded-card border border-zinc-200 bg-white p-4 md:grid-cols-2 dark:border-line dark:bg-surface">
            <div>
              <Label htmlFor="thumb-project">Video</Label>
              <Select
                id="thumb-project"
                value={selectedId ?? ""}
                disabled={projects.length === 0}
                onChange={(e) => {
                  setSelectedId(e.target.value === "" ? null : (e.target.value as ProjectId));
                }}
              >
                {projects.length === 0 ? (
                  <option value="">No videos yet — name one →</option>
                ) : (
                  projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))
                )}
              </Select>
            </div>
            {quickCreate}
          </div>
          {selectedId !== null ? (
            <ThumbnailBoard key={selectedId} projectId={selectedId} />
          ) : (
            <EmptyState
              title="Name a video to start"
              hint="Every thumbnail board belongs to a video, so its title and style carry into the images."
            />
          )}
        </div>
      )}
    </div>
  );
}
