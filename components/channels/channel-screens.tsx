"use client";

import Link from "next/link";
import { useState } from "react";
import { skipToken } from "@tanstack/react-query";
import type { ChannelId } from "@/lib/types/ids";
import { trpc } from "@/components/providers/trpc";
import { useWorkspace } from "@/components/providers/workspace-context";
import { AvatarReview } from "@/components/avatar/avatar-review";
import { PageHeader } from "@/components/shell/app-shell";
import { SyncStatusBadge } from "@/components/projects/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { TextInput } from "@/components/ui/field";
import { IconRefresh } from "@/components/ui/icons";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/state";
import { fmtCompact, fmtDateTime } from "@/components/lib/format";
import { ConnectChannel } from "./connect-channel";

export function ChannelListScreen() {
  const { workspaceId, channels } = useWorkspace();
  const utils = trpc.useUtils();
  const syncMutation = trpc.channel.sync.useMutation({
    onSuccess: () => {
      if (workspaceId !== null) void utils.channel.list.invalidate({ workspaceId });
    },
  });

  if (workspaceId === null) return <LoadingState label="Loading workspace…" />;

  return (
    <div>
      <PageHeader
        title="Channels"
        subtitle="Connected channels feed research, audience avatars, and voice."
      />
      {channels.length === 0 ? (
        <EmptyState
          title="No channels connected"
          hint="Connect your channel with Google, or track any public channel by URL."
        />
      ) : (
        <ul className="mb-8 divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {channels.map((c) => (
            <li key={c.id} className="flex items-center gap-4 px-4 py-3">
              <Link href={`/channels/${c.id}`} className="min-w-0 flex-1 hover:underline">
                <p className="truncate text-sm font-medium">{c.title}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {c.handle ?? c.youtubeChannelId} · {c.mode === "oauth" ? "connected" : "public"}
                  {c.lastSyncedAt !== null ? ` · synced ${fmtDateTime(c.lastSyncedAt)}` : ""}
                </p>
              </Link>
              <SyncStatusBadge status={c.syncStatus} />
              <Button
                size="sm"
                busy={syncMutation.isPending && syncMutation.variables.channelId === c.id}
                onClick={() => {
                  syncMutation.mutate({ workspaceId, channelId: c.id });
                }}
              >
                <IconRefresh size={12} /> Sync
              </Button>
            </li>
          ))}
        </ul>
      )}
      <h2 className="mb-3 text-sm font-semibold text-zinc-600 dark:text-zinc-400">
        Connect another channel
      </h2>
      <ConnectChannel />
    </div>
  );
}

export function ChannelDetailScreen({ channelId }: { channelId: ChannelId }) {
  const { workspaceId } = useWorkspace();
  const utils = trpc.useUtils();
  const channelQuery = trpc.channel.get.useQuery(
    workspaceId !== null ? { workspaceId, channelId } : skipToken,
  );
  const syncMutation = trpc.channel.sync.useMutation();
  const nicheMutation = trpc.channel.updateNiche.useMutation({
    onSuccess: () => {
      if (workspaceId !== null) {
        void utils.channel.get.invalidate({ workspaceId, channelId });
        void utils.channel.list.invalidate({ workspaceId });
      }
    },
  });

  const [editingNiche, setEditingNiche] = useState(false);
  const [nicheDraft, setNicheDraft] = useState("");

  if (workspaceId === null || channelQuery.isLoading) {
    return <LoadingState label="Loading channel…" />;
  }
  if (channelQuery.isError || channelQuery.data === undefined) {
    return (
      <ErrorState
        onRetry={() => {
          void channelQuery.refetch();
        }}
      />
    );
  }
  const channel = channelQuery.data;
  const snap = channel.latestSnapshot;

  return (
    <div className="space-y-6">
      <PageHeader
        title={channel.title}
        subtitle={
          <span className="flex items-center gap-2">
            {channel.handle ?? channel.youtubeChannelId}
            <SyncStatusBadge status={channel.syncStatus} />
          </span>
        }
        actions={
          <Button
            busy={syncMutation.isPending}
            onClick={() => {
              syncMutation.mutate({ workspaceId, channelId });
            }}
          >
            <IconRefresh size={13} /> Sync now
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Subscribers" value={snap !== null ? fmtCompact(snap.subs) : "—"} />
        <StatTile label="Total views" value={snap !== null ? fmtCompact(snap.totalViews) : "—"} />
        <StatTile
          label="Median views (90d)"
          value={snap !== null ? fmtCompact(snap.medianViews90d) : "—"}
        />
      </div>

      <Card>
        <CardHeader
          title="Niche keywords"
          subtitle="Steer research queries and title patterns (max 6)."
          actions={
            editingNiche ? null : (
              <Button
                size="sm"
                onClick={() => {
                  setNicheDraft(channel.nicheKeywords.join(", "));
                  setEditingNiche(true);
                }}
              >
                Edit
              </Button>
            )
          }
        />
        <CardBody>
          {editingNiche ? (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setEditingNiche(false);
                nicheMutation.mutate({
                  workspaceId,
                  channelId,
                  nicheKeywords: nicheDraft
                    .split(",")
                    .map((k) => k.trim())
                    .filter((k) => k !== "")
                    .slice(0, 6),
                });
              }}
            >
              <TextInput
                autoFocus
                value={nicheDraft}
                onChange={(e) => {
                  setNicheDraft(e.target.value);
                }}
              />
              <Button type="submit" variant="primary" busy={nicheMutation.isPending}>
                Save
              </Button>
            </form>
          ) : channel.nicheKeywords.length === 0 ? (
            <p className="text-sm text-zinc-400 italic">No keywords yet.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {channel.nicheKeywords.map((k) => (
                <span
                  key={k}
                  className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                >
                  {k}
                </span>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <AvatarReview channelId={channelId} />
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}
