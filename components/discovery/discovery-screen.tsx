"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { skipToken } from "@tanstack/react-query";
import type { Idea } from "@/lib/types/entities";
import type { IdeaStatus } from "@/lib/types/enums";
import { trpc } from "@/components/providers/trpc";
import { useWorkspace } from "@/components/providers/workspace-context";
import { PageHeader } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconExternal, IconPlay, IconSparkle } from "@/components/ui/icons";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/state";
import { useToast } from "@/components/ui/toast";
import { applyStatusChange, scoreTone, youtubeWatchUrl } from "@/components/ideas/feed-logic";
import { coachSeedKey } from "@/components/chat/coach-seed";
import { DiscoveryCard } from "./discovery-card";
import {
  demandByTopic,
  demandTopics,
  ideaMatchesNiche,
  ideaOutlierRatio,
  indexOutliers,
  ratioLabel,
} from "./discovery-logic";

/**
 * The pre-write trend/discovery surface (Wave-D D3). Fronts the existing
 * outlier index + ideas feed as high-performing concept cards, layers on a
 * keyless search-demand signal, and one-clicks any concept into framing (or
 * the project's Coach thread) with a steerable unique angle. Generating a
 * fresh batch reuses the existing 1-credit requestBatch — metering unchanged.
 */
export function DiscoveryScreen() {
  const { workspaceId, channelId, channel, channels, channelsLoading } = useWorkspace();
  const router = useRouter();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [niche, setNiche] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const feedInput =
    workspaceId !== null && channelId !== null
      ? { workspaceId, channelId, limit: 100 as const }
      : null;
  const feedQuery = trpc.ideas.feed.useQuery(feedInput ?? skipToken);

  const outliersInput =
    workspaceId !== null && channelId !== null
      ? { workspaceId, channelId, nicheKeyword: niche, limit: 40 as const }
      : null;
  const outliersQuery = trpc.ideas.outliers.useQuery(outliersInput ?? skipToken);

  const allIdeas = useMemo(() => feedQuery.data ?? [], [feedQuery.data]);
  const outlierIndex = useMemo(() => indexOutliers(outliersQuery.data ?? []), [outliersQuery.data]);

  // Concepts on show: everything not dismissed, within the selected niche.
  const visible = useMemo(
    () =>
      allIdeas.filter((i) => i.status !== "dismissed" && ideaMatchesNiche(i, niche, outlierIndex)),
    [allIdeas, niche, outlierIndex],
  );

  const topics = useMemo(() => demandTopics(visible), [visible]);
  const demandInput =
    workspaceId !== null && channelId !== null && topics.length > 0
      ? { workspaceId, channelId, topics }
      : null;
  const demandQuery = trpc.ideas.searchDemand.useQuery(demandInput ?? skipToken);
  const demand = useMemo(() => demandByTopic(demandQuery.data ?? []), [demandQuery.data]);

  const refresh = () => {
    void utils.ideas.feed.invalidate();
  };

  const optimisticStatus = (ideaId: string, next: IdeaStatus): Idea[] | undefined => {
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

  const saveMutation = trpc.ideas.save.useMutation({ onSettled: refresh });
  const dismissMutation = trpc.ideas.dismiss.useMutation({ onSettled: refresh });
  const useIdeaMutation = trpc.ideas.useIdea.useMutation();
  const batchMutation = trpc.ideas.requestBatch.useMutation({
    onSuccess: () => {
      toast("Fresh concepts requested — they'll appear here in a moment.", "success");
      refresh();
    },
    onError: (err) => {
      toast(
        err.data?.code === "PRECONDITION_FAILED"
          ? err.message
          : "Could not request new concepts — try again.",
      );
    },
  });

  const onSave = (idea: Idea) => {
    if (workspaceId === null) return;
    const previous = optimisticStatus(idea.id, "saved");
    saveMutation.mutate(
      { workspaceId, ideaId: idea.id },
      {
        onError: () => {
          rollback(previous);
          toast("Could not save the concept — it was left unchanged.");
        },
      },
    );
  };

  const onDismiss = (idea: Idea) => {
    if (workspaceId === null) return;
    const previous = optimisticStatus(idea.id, "dismissed");
    dismissMutation.mutate(
      { workspaceId, ideaId: idea.id },
      {
        onError: () => {
          rollback(previous);
          toast("Could not dismiss the concept — it was left unchanged.");
        },
      },
    );
  };

  const runUse = (idea: Idea, angle: string, dest: "framing" | "coach") => {
    if (workspaceId === null || busyId !== null) return;
    setBusyId(idea.id);
    useIdeaMutation.mutate(
      { workspaceId, ideaId: idea.id, angle },
      {
        onSuccess: ({ project }) => {
          refresh();
          if (dest === "coach") {
            try {
              sessionStorage.setItem(
                coachSeedKey(project.id),
                JSON.stringify({ title: idea.title, angle }),
              );
            } catch {
              // best-effort: the Coach still has the angle via project context
            }
            router.push(`/projects/${project.id}/chat`);
          } else {
            toast("Started framing from this idea — sharpen the angle and write.", "success");
            router.push(`/projects/${project.id}/framing`);
          }
        },
        onError: () => {
          setBusyId(null);
          toast("Couldn't start from this concept — try again.");
        },
      },
    );
  };

  if (workspaceId === null) return <LoadingState label="Loading workspace…" />;

  const header = (
    <PageHeader
      title="Discovery"
      subtitle="High-performing concepts and live demand for your niche — one click to start writing."
      actions={
        channelId !== null ? (
          <Button
            variant="primary"
            busy={batchMutation.isPending}
            aria-label="Generate a fresh batch of concepts (costs 1 credit)"
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

  // The surface is per-channel; "all channels" has nothing to mine.
  if (channelId === null) {
    return (
      <div>
        {header}
        {channelsLoading ? (
          <LoadingState label="Loading channels…" />
        ) : channels.length === 0 ? (
          <EmptyState
            title="Connect a channel to discover concepts"
            hint="Discovery is mined from a channel's niche — connect one first."
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
            hint="Concepts are mined per channel — choose one in the channel switcher above."
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
          hint="Niche keywords tell the outlier index where to look. Add a few (e.g. “home espresso, coffee gear”) and concepts start arriving with the next daily run."
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

  const nicheKeywords = channel?.nicheKeywords ?? [];
  const topOutliers = (outliersQuery.data ?? []).slice(0, 6);

  return (
    <div>
      {header}

      {nicheKeywords.length > 0 ? (
        <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Filter by niche">
          <NicheChip
            label="All niches"
            active={niche === null}
            onClick={() => {
              setNiche(null);
            }}
          />
          {nicheKeywords.map((k) => (
            <NicheChip
              key={k}
              label={k}
              active={niche === k}
              onClick={() => {
                setNiche(k);
              }}
            />
          ))}
        </div>
      ) : null}

      {feedQuery.isLoading ? (
        <LoadingState label="Loading concepts…" />
      ) : feedQuery.isError ? (
        <ErrorState
          message="Couldn't load discovery — check your connection and retry."
          onRetry={() => {
            void feedQuery.refetch();
          }}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          title={niche === null ? "No concepts yet" : `Nothing in “${niche}” yet`}
          hint="The daily run surfaces fresh concepts each morning — or generate a batch now for 1 credit."
          action={
            <Button
              variant="primary"
              busy={batchMutation.isPending}
              onClick={() => {
                batchMutation.mutate({ workspaceId, channelId });
              }}
            >
              <IconSparkle size={14} /> Get concepts now · 1 credit
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {visible.map((idea) => (
            <DiscoveryCard
              key={idea.id}
              idea={idea}
              demand={demand.get(idea.title) ?? null}
              outlierRatio={ideaOutlierRatio(idea, outlierIndex)}
              busy={busyId === idea.id}
              onUse={(i, angle) => {
                runUse(i, angle, "framing");
              }}
              onAskCoach={(i, angle) => {
                runUse(i, angle, "coach");
              }}
              onSave={onSave}
              onDismiss={onDismiss}
            />
          ))}
        </div>
      )}

      {topOutliers.length > 0 ? (
        <section aria-label="Proven videos in your niche" className="mt-8">
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
            Proven videos in your niche
          </h2>
          <ul className="space-y-2">
            {topOutliers.map((o) => (
              <li
                key={o.id}
                className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <span className="min-w-0 truncate text-sm text-zinc-700 dark:text-zinc-300">
                  {o.title}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Badge tone={scoreTone(Math.min(100, o.outlierRatio * 10))} title="Outlier ratio">
                    {ratioLabel(o.outlierRatio)}
                  </Badge>
                  <a
                    href={youtubeWatchUrl(o.youtubeVideoId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Watch ${o.title} on YouTube (opens in a new tab)`}
                    className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
                  >
                    <IconPlay size={11} /> Watch <IconExternal size={10} />
                  </a>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function NicheChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "border-emerald-600 bg-emerald-50 text-emerald-800 dark:border-emerald-500 dark:bg-emerald-950/60 dark:text-emerald-300"
          : "border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600"
      }`}
    >
      {label}
    </button>
  );
}
