"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { skipToken } from "@tanstack/react-query";
import type { Idea } from "@/lib/types/entities";
import type { IdeaStatus } from "@/lib/types/enums";
import { trpc } from "@/components/providers/trpc";
import { useWorkspace } from "@/components/providers/workspace-context";
import { PageHeader } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { IconSparkle } from "@/components/ui/icons";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/state";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { fmtDate } from "@/components/lib/format";
import {
  FEED_FILTERS,
  applyStatusChange,
  filterToStatus,
  groupByDay,
  type FeedFilter,
} from "./feed-logic";
import { IdeaCard } from "./idea-card";

/**
 * The daily idea feed (§5.4): 5 fresh ideas per day per channel, mined
 * from the niche outlier index. Save/dismiss are optimistic with rollback
 * + toast on failure; promote creates a project and navigates to it.
 */
export function IdeasFeedScreen() {
  const { workspaceId, channelId, channel, channels, channelsLoading } = useWorkspace();
  const router = useRouter();
  const { toast } = useToast();
  const [filter, setFilter] = useState<FeedFilter>("new");
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const status = filterToStatus(filter);
  const feedInput =
    workspaceId !== null && channelId !== null
      ? {
          workspaceId,
          channelId,
          ...(status !== undefined ? { status } : {}),
          limit: 100 as const,
        }
      : null;
  const feedQuery = trpc.ideas.feed.useQuery(feedInput ?? skipToken);

  /** Optimistically flip one idea's status in the current feed snapshot. */
  const optimistic = (ideaId: string, next: IdeaStatus): Idea[] | undefined => {
    if (feedInput === null) return undefined;
    const previous = utils.ideas.feed.getData(feedInput);
    if (previous !== undefined) {
      utils.ideas.feed.setData(feedInput, applyStatusChange(previous, ideaId, next));
    }
    return previous;
  };
  const rollback = (previous: Idea[] | undefined) => {
    if (feedInput !== null && previous !== undefined) {
      utils.ideas.feed.setData(feedInput, previous);
    }
  };
  const refresh = () => {
    void utils.ideas.feed.invalidate();
  };

  const saveMutation = trpc.ideas.save.useMutation({ onSettled: refresh });
  const dismissMutation = trpc.ideas.dismiss.useMutation({ onSettled: refresh });
  const promoteMutation = trpc.ideas.promote.useMutation();
  const batchMutation = trpc.ideas.requestBatch.useMutation({
    onSuccess: () => {
      toast("Fresh ideas requested — they'll appear here in a moment.", "success");
      refresh();
    },
    onError: (err) => {
      toast(
        err.data?.code === "PRECONDITION_FAILED"
          ? err.message
          : "Could not request new ideas — try again.",
      );
    },
  });

  const onSave = (idea: Idea) => {
    if (workspaceId === null) return;
    const previous = optimistic(idea.id, "saved");
    saveMutation.mutate(
      { workspaceId, ideaId: idea.id },
      {
        onError: () => {
          rollback(previous);
          toast("Could not save the idea — it was left unchanged.");
        },
      },
    );
  };

  const onDismiss = (idea: Idea) => {
    if (workspaceId === null) return;
    const previous = optimistic(idea.id, "dismissed");
    dismissMutation.mutate(
      { workspaceId, ideaId: idea.id },
      {
        onError: () => {
          rollback(previous);
          toast("Could not dismiss the idea — it was left unchanged.");
        },
      },
    );
  };

  const onPromote = (idea: Idea) => {
    if (workspaceId === null || promotingId !== null) return;
    setPromotingId(idea.id);
    promoteMutation.mutate(
      { workspaceId, ideaId: idea.id },
      {
        onSuccess: ({ project }) => {
          refresh();
          toast("Project created from the idea.", "success");
          router.push(`/projects/${project.id}/research`);
        },
        onError: () => {
          setPromotingId(null);
          toast("Could not promote the idea — no project was created.");
        },
      },
    );
  };

  if (workspaceId === null) return <LoadingState label="Loading workspace…" />;

  const header = (
    <PageHeader
      title="Ideas"
      subtitle="Five fresh, evidence-backed video ideas per channel, every morning."
      actions={
        channelId !== null ? (
          <Button
            variant="primary"
            busy={batchMutation.isPending}
            aria-label="Request a fresh batch of ideas (costs 1 credit)"
            onClick={() => {
              batchMutation.mutate({ workspaceId, channelId });
            }}
          >
            <IconSparkle size={14} /> New batch · 1 credit
          </Button>
        ) : undefined
      }
    />
  );

  // The feed is per-channel; "all channels" has no feed to show.
  if (channelId === null) {
    return (
      <div>
        {header}
        {channelsLoading ? (
          <LoadingState label="Loading channels…" />
        ) : channels.length === 0 ? (
          <EmptyState
            title="Connect a channel to get ideas"
            hint="The idea feed is mined from a channel's niche — connect one first."
            action={
              <Link
                href="/channels"
                className="text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400"
              >
                Connect a channel →
              </Link>
            }
          />
        ) : (
          <EmptyState
            title="Pick a channel"
            hint="Ideas are generated per channel — choose one in the channel switcher above."
          />
        )}
      </div>
    );
  }

  // A channel without niche keywords has nothing to mine — point at settings.
  if (channel !== null && channel.nicheKeywords.length === 0) {
    return (
      <div>
        {header}
        <EmptyState
          title="This channel has no niche keywords yet"
          hint="Niche keywords tell the outlier index where to look. Add a few (e.g. “home espresso, coffee gear”) and ideas start arriving with the next daily run."
          action={
            <Link
              href={`/channels/${channelId}`}
              className="text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400"
            >
              Set niche keywords →
            </Link>
          }
        />
      </div>
    );
  }

  const ideas = feedQuery.data ?? [];
  const groups = groupByDay(ideas);

  return (
    <div>
      {header}

      <Tabs
        className="mb-4"
        tabs={FEED_FILTERS.map((f) => ({ id: f.id, label: f.label }))}
        active={filter}
        onChange={setFilter}
      />

      {feedQuery.isLoading ? (
        <LoadingState label="Loading the idea feed…" />
      ) : feedQuery.isError ? (
        <ErrorState
          message="Couldn't load the idea feed — check your connection and retry."
          onRetry={() => {
            void feedQuery.refetch();
          }}
        />
      ) : ideas.length === 0 ? (
        <EmptyState
          title={filter === "new" ? "No new ideas right now" : "Nothing here yet"}
          hint={
            filter === "new"
              ? "The daily run delivers 5 ideas each morning — or request a batch now for 1 credit."
              : "Ideas you save or act on will show up under this tab."
          }
          action={
            filter === "new" ? (
              <Button
                variant="primary"
                busy={batchMutation.isPending}
                onClick={() => {
                  batchMutation.mutate({ workspaceId, channelId });
                }}
              >
                <IconSparkle size={14} /> Get ideas now · 1 credit
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.day} aria-label={`Ideas from ${group.day}`}>
              <h2 className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
                {fmtDate(new Date(`${group.day}T00:00:00`))}
              </h2>
              <div className="space-y-3">
                {group.ideas.map((idea) => (
                  <IdeaCard
                    key={idea.id}
                    idea={idea}
                    onSave={onSave}
                    onDismiss={onDismiss}
                    onPromote={onPromote}
                    promoting={promotingId === idea.id}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
