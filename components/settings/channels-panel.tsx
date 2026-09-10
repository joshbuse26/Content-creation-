"use client";

import Link from "next/link";
import { trpc } from "@/components/providers/trpc";
import { useWorkspace } from "@/components/providers/workspace-context";
import { ConnectChannel } from "@/components/channels/connect-channel";
import { SyncStatusBadge } from "@/components/projects/status-badge";
import { Button } from "@/components/ui/button";
import { IconRefresh, IconTrash } from "@/components/ui/icons";
import { LoadingState } from "@/components/ui/state";
import { PipelineStatusNote } from "@/components/ui/pipeline-note";
import { useToast } from "@/components/ui/toast";
import { fmtDateTime } from "@/components/lib/format";
import { usePipelinePoll } from "@/components/lib/use-pipeline-poll";

export function ChannelsSettingsPanel() {
  const { workspaceId, channels, selectChannel } = useWorkspace();
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const invalidate = () => {
    if (workspaceId !== null) void utils.channel.list.invalidate({ workspaceId });
  };
  // Channel sync runs as a queued pipeline — poll until statuses change.
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
  const disconnectMutation = trpc.channel.disconnect.useMutation({
    onSuccess: () => {
      selectChannel(null);
      invalidate();
    },
    onError: () => {
      toast("Could not disconnect the channel — it is still connected.");
    },
  });

  if (workspaceId === null) return <LoadingState />;

  return (
    <div className="space-y-6">
      <PipelineStatusNote
        poll={syncPoll}
        working="Sync queued — statuses refresh when the pipeline finishes."
      />
      <ul className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        {channels.length === 0 ? (
          <li className="px-4 py-6 text-center text-sm text-zinc-400">No channels connected.</li>
        ) : (
          channels.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <Link
                  href={`/channels/${c.id}`}
                  className="truncate text-sm font-medium hover:underline"
                >
                  {c.title}
                </Link>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {c.mode === "oauth" ? "Google-connected" : "public mode"} ·{" "}
                  {c.lastSyncedAt !== null
                    ? `synced ${fmtDateTime(c.lastSyncedAt)}`
                    : "never synced"}
                </p>
              </div>
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
              <Button
                size="sm"
                variant="danger"
                busy={
                  disconnectMutation.isPending && disconnectMutation.variables.channelId === c.id
                }
                onClick={() => {
                  disconnectMutation.mutate({ workspaceId, channelId: c.id });
                }}
              >
                <IconTrash size={12} /> Disconnect
              </Button>
            </li>
          ))
        )}
      </ul>
      <div>
        <h3 className="mb-3 text-sm font-semibold text-zinc-600 dark:text-zinc-400">
          Add a channel
        </h3>
        <ConnectChannel />
      </div>
    </div>
  );
}
