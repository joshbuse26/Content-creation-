"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
import { IconRefresh, IconX } from "@/components/ui/icons";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/state";
import { PipelineStatusNote } from "@/components/ui/pipeline-note";
import { useToast } from "@/components/ui/toast";
import { fmtCompact, fmtDateTime } from "@/components/lib/format";
import { usePipelinePoll } from "@/components/lib/use-pipeline-poll";
import { ConnectChannel } from "./connect-channel";

/** Human copy for the OAuth callback's connectError redirect flag. */
const CONNECT_ERROR_COPY: Record<string, string> = {
  missing_code: "Google did not return an authorization code — the consent flow was interrupted.",
  bad_state: "The sign-in state check failed — please start the connect flow again.",
  oauth_not_configured: "YouTube OAuth is not configured for this deployment.",
  no_refresh_token:
    "Google did not grant offline access. Remove the app from your Google account permissions and connect again.",
  no_channel: "That Google account has no YouTube channel to connect.",
  channel_limit:
    "This workspace has reached its plan's channel limit. Upgrade the plan to connect more channels.",
  connect_failed: "Connecting the channel failed partway through — please try again.",
};

export function ChannelListScreen() {
  const { workspaceId, channels, channelsLoading, channelsError, refetchChannels } = useWorkspace();
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const connectError = searchParams.get("connectError");
  const [errorDismissed, setErrorDismissed] = useState(false);
  const dismissConnectError = () => {
    setErrorDismissed(true);
    // Strip the flag from the URL so a reload doesn't resurrect it.
    const params = new URLSearchParams(searchParams);
    params.delete("connectError");
    const query = params.toString();
    router.replace(query === "" ? pathname : `${pathname}?${query}`);
  };
  const invalidate = () => {
    if (workspaceId !== null) void utils.channel.list.invalidate({ workspaceId });
  };
  // Channel sync runs as a queued pipeline — poll the list until sync
  // status/timestamps change.
  const syncPoll = usePipelinePoll(invalidate, channels);
  const syncMutation = trpc.channel.sync.useMutation({
    onSuccess: () => {
      invalidate();
      syncPoll.begin();
    },
    onError: () => {
      toast("Could not start the channel sync — try again.");
    },
  });

  if (workspaceId === null) return <LoadingState label="Loading workspace…" />;

  return (
    <div>
      <PageHeader
        title="Channels"
        subtitle="Connected channels feed research, audience avatars, and voice."
      />
      {connectError !== null && !errorDismissed ? (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          <div className="flex-1">
            <p className="font-medium">Channel connect failed</p>
            <p className="mt-0.5">
              {CONNECT_ERROR_COPY[connectError] ??
                "Something went wrong completing the Google connect flow — please try again."}
            </p>
          </div>
          <button
            type="button"
            aria-label="Dismiss connect error"
            className="shrink-0 cursor-pointer rounded p-1 text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-900"
            onClick={dismissConnectError}
          >
            <IconX size={13} />
          </button>
        </div>
      ) : null}
      <div className="mb-3">
        <PipelineStatusNote
          poll={syncPoll}
          working="Sync queued — stats refresh when the pipeline finishes."
        />
      </div>
      {channelsLoading ? (
        <LoadingState label="Loading channels…" />
      ) : channelsError ? (
        <ErrorState
          message="Couldn't load your channels — check your connection and retry."
          onRetry={refetchChannels}
        />
      ) : channels.length === 0 ? (
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
      {/* Anchor target for the shell's "Connect channel" CTA (/channels#connect). */}
      <h2 id="connect" className="mb-3 text-sm font-semibold text-zinc-600 dark:text-zinc-400">
        Connect another channel
      </h2>
      <ConnectChannel />
    </div>
  );
}

export function ChannelDetailScreen({ channelId }: { channelId: ChannelId }) {
  const { workspaceId } = useWorkspace();
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const channelQuery = trpc.channel.get.useQuery(
    workspaceId !== null ? { workspaceId, channelId } : skipToken,
  );
  const invalidateChannel = () => {
    if (workspaceId !== null) {
      void utils.channel.get.invalidate({ workspaceId, channelId });
      void utils.channel.list.invalidate({ workspaceId });
    }
  };
  const syncPoll = usePipelinePoll(invalidateChannel, channelQuery.data);
  const syncMutation = trpc.channel.sync.useMutation({
    onSuccess: () => {
      invalidateChannel();
      syncPoll.begin();
    },
    onError: () => {
      toast("Could not start the channel sync — try again.");
    },
  });
  const nicheMutation = trpc.channel.updateNiche.useMutation({
    onSuccess: () => {
      invalidateChannel();
      toast("Niche keywords saved — research and titles will use them.", "success");
    },
    onError: () => {
      invalidateChannel();
      toast("Could not save the niche keywords — they were not changed.");
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
        message="Couldn't load this channel — it may have been disconnected, or the connection dropped."
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

      <PipelineStatusNote
        poll={syncPoll}
        working="Sync queued — stats refresh when the pipeline finishes."
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
                aria-label="Niche keywords, comma-separated"
                placeholder="e.g. home espresso, coffee gear"
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
            <p className="text-sm text-zinc-500 italic dark:text-zinc-400">
              No keywords yet — add up to six to steer research and title patterns.
            </p>
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
