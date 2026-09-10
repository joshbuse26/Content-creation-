"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { skipToken } from "@tanstack/react-query";
import { PROJECT_STATUSES, type ProjectStatus } from "@/lib/types/enums";
import { trpc } from "@/components/providers/trpc";
import { useWorkspace } from "@/components/providers/workspace-context";
import { PageHeader } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Select, TextInput, Label } from "@/components/ui/field";
import { IconPlus } from "@/components/ui/icons";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/state";
import { fmtDate } from "@/components/lib/format";
import { ProjectStatusBadge } from "./status-badge";

export function ProjectListScreen() {
  const { workspaceId, channelId, channels } = useWorkspace();
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | "all">("all");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [newChannelId, setNewChannelId] = useState<string>("");

  const listQuery = trpc.project.list.useQuery(
    workspaceId !== null
      ? {
          workspaceId,
          ...(channelId !== null ? { channelId } : {}),
          ...(statusFilter !== "all" ? { status: statusFilter } : {}),
          limit: 50,
        }
      : skipToken,
  );

  const createMutation = trpc.project.create.useMutation({
    onSuccess: (project) => {
      setCreating(false);
      setTitle("");
      router.push(`/projects/${project.id}/research`);
    },
  });

  if (workspaceId === null) return <LoadingState label="Loading workspace…" />;

  const createChannel =
    channels.find((c) => c.id === newChannelId) ??
    channels.find((c) => c.id === channelId) ??
    channels[0];
  const projects = listQuery.data ?? [];

  return (
    <div>
      <PageHeader
        title="Projects"
        subtitle="Every video, from idea to published script."
        actions={
          <Button
            variant="primary"
            onClick={() => {
              setCreating((v) => !v);
            }}
          >
            <IconPlus size={14} /> New project
          </Button>
        }
      />

      {creating && channels.length === 0 ? (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Every project belongs to a channel — connect a channel first.{" "}
          <Link
            href="/channels"
            className="font-medium underline hover:no-underline dark:text-amber-100"
          >
            Connect a channel →
          </Link>
        </div>
      ) : null}
      {creating && channels.length > 0 ? (
        <form
          className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
          onSubmit={(e) => {
            e.preventDefault();
            if (createChannel === undefined || title.trim() === "") return;
            createMutation.mutate({
              workspaceId,
              channelId: createChannel.id,
              title: title.trim(),
              ideaId: null,
            });
          }}
        >
          <div className="min-w-64 flex-1">
            <Label htmlFor="np-title">Working title</Label>
            <TextInput
              id="np-title"
              autoFocus
              placeholder="e.g. Budget espresso setup vs. the $2k rig"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
              }}
            />
          </div>
          <div>
            <Label htmlFor="np-channel">Channel</Label>
            <Select
              id="np-channel"
              value={createChannel?.id ?? ""}
              onChange={(e) => {
                setNewChannelId(e.target.value);
              }}
            >
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="primary" busy={createMutation.isPending}>
            Create
          </Button>
          {createMutation.isError ? (
            <p className="w-full text-sm text-red-600 dark:text-red-400">
              Could not create the project — try again.
            </p>
          ) : null}
        </form>
      ) : null}

      <div className="mb-4 flex items-center gap-2">
        <Label htmlFor="status-filter" className="mb-0">
          Status
        </Label>
        <Select
          id="status-filter"
          className="w-40"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as ProjectStatus | "all");
          }}
        >
          <option value="all">All statuses</option>
          {PROJECT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </div>

      {listQuery.isLoading ? (
        <LoadingState label="Loading projects…" />
      ) : listQuery.isError ? (
        <ErrorState
          onRetry={() => {
            void listQuery.refetch();
          }}
        />
      ) : projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          hint="Create a project to start the research → frame → script pipeline."
          action={
            <Button
              variant="primary"
              onClick={() => {
                setCreating(true);
              }}
            >
              <IconPlus size={14} /> New project
            </Button>
          }
        />
      ) : (
        <ul className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {projects.map((p) => {
            const channelTitle = channels.find((c) => c.id === p.channelId)?.title;
            return (
              <li key={p.id}>
                <Link
                  href={`/projects/${p.id}`}
                  className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p.title}</p>
                    <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                      {channelTitle ?? "—"}
                      {p.targetPublishDate !== null
                        ? ` · target ${fmtDate(new Date(`${p.targetPublishDate}T00:00:00`))}`
                        : ""}
                    </p>
                  </div>
                  <ProjectStatusBadge status={p.status} />
                  <span className="w-24 text-right text-xs text-zinc-400">
                    {fmtDate(p.updatedAt)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
