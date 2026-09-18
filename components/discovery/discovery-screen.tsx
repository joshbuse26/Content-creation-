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
import { Button } from "@/components/ui/button";
import { IconSparkle } from "@/components/ui/icons";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/state";
import { useToast } from "@/components/ui/toast";
import { applyStatusChange } from "@/components/ideas/feed-logic";
import { coachSeedKey } from "@/components/chat/coach-seed";
import { CompetitorCompare } from "./competitor-compare";
import { DiscoveryCard } from "./discovery-card";
import { OutlierCard } from "./outlier-card";
import {
  demandByTopic,
  demandTopics,
  ideaMatchesNiche,
  ideaOutlierRatio,
  indexOutliers,
  whyByVideo,
} from "./discovery-logic";

type RecencyBand = "all" | "month" | "week";
type Shelf = "discover" | "validated";

/**
 * The pre-write trend/discovery surface. Fronts the existing outlier index +
 * ideas feed as high-performing concept cards, enriches the proven videos with
 * deterministic signals + a cached "why it worked" blurb (E3), layers a keyless
 * search-demand signal, filters by niche / view-multiple / recency, compares
 * competitor channels into original concepts, and one-clicks any concept into
 * framing or the project's Coach thread. A "Validated" shelf keeps saved
 * concepts with evidence links to the real videos.
 */
export function DiscoveryScreen() {
  const { workspaceId, channelId, channel, channels, channelsLoading } = useWorkspace();
  const router = useRouter();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [niche, setNiche] = useState<string | null>(null);
  const [minRatio, setMinRatio] = useState<number | null>(null);
  const [recency, setRecency] = useState<RecencyBand>("all");
  const [shelf, setShelf] = useState<Shelf>("discover");
  const [busyId, setBusyId] = useState<string | null>(null);
  const now = useMemo(() => new Date(), []);

  const feedInput =
    workspaceId !== null && channelId !== null
      ? { workspaceId, channelId, limit: 100 as const }
      : null;
  const feedQuery = trpc.ideas.feed.useQuery(feedInput ?? skipToken);

  const outliersInput =
    workspaceId !== null && channelId !== null
      ? {
          workspaceId,
          channelId,
          nicheKeyword: niche,
          limit: 40 as const,
          minOutlierRatio: minRatio,
          recency,
        }
      : null;
  const outliersQuery = trpc.ideas.outliers.useQuery(outliersInput ?? skipToken);

  const whyInput =
    workspaceId !== null && channelId !== null
      ? { workspaceId, channelId, nicheKeyword: niche, limit: 12 as const }
      : null;
  const whyQuery = trpc.ideas.whyItWorked.useQuery(whyInput ?? skipToken);
  const why = useMemo(() => whyByVideo(whyQuery.data ?? []), [whyQuery.data]);

  const allIdeas = useMemo(() => feedQuery.data ?? [], [feedQuery.data]);
  const outlierIndex = useMemo(() => indexOutliers(outliersQuery.data ?? []), [outliersQuery.data]);

  // Concepts on show: the Discover shelf shows everything not dismissed; the
  // Validated shelf shows only saved concepts. Both respect the niche filter.
  const visible = useMemo(
    () =>
      allIdeas
        .filter((i) => (shelf === "validated" ? i.status === "saved" : i.status !== "dismissed"))
        .filter((i) => ideaMatchesNiche(i, niche, outlierIndex)),
    [allIdeas, niche, outlierIndex, shelf],
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
      title="Intel"
      subtitle="High-performing concepts and live demand for your niche — one click to start writing."
      actions={
        channelId !== null ? (
          <Button
            variant="primary"
            busy={batchMutation.isPending}
            aria-label="Generate a fresh batch of concepts"
            onClick={() => {
              batchMutation.mutate({ workspaceId, channelId });
            }}
          >
            <IconSparkle size={14} /> New batch
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
                className="text-sm font-medium text-accent-700 hover:underline dark:text-accent-400"
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
              className="text-sm font-medium text-accent-700 hover:underline dark:text-accent-400"
            >
              Set niche keywords →
            </Link>
          }
        />
      </div>
    );
  }

  const nicheKeywords = channel?.nicheKeywords ?? [];
  const topOutliers = outliersQuery.data ?? [];
  const savedCount = allIdeas.filter((i) => i.status === "saved").length;

  return (
    <div>
      {header}

      {/* Shelf toggle: Discover vs. the validated (saved) shelf */}
      <div
        className="mb-4 flex flex-wrap items-center gap-2"
        role="tablist"
        aria-label="Discovery shelves"
      >
        <ShelfTab
          label="Discover"
          active={shelf === "discover"}
          onClick={() => {
            setShelf("discover");
          }}
        />
        <ShelfTab
          label={savedCount > 0 ? `Validated · ${savedCount}` : "Validated"}
          active={shelf === "validated"}
          onClick={() => {
            setShelf("validated");
          }}
        />
      </div>

      {nicheKeywords.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter by niche">
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

      {/* E3 filters: min view-multiple + recency band */}
      <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <label className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
          Min view multiple
          <select
            value={minRatio === null ? "any" : String(minRatio)}
            onChange={(e) => {
              setMinRatio(e.target.value === "any" ? null : Number(e.target.value));
            }}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
            aria-label="Minimum view multiple"
          >
            <option value="any">Any</option>
            <option value="3">3×+</option>
            <option value="5">5×+</option>
            <option value="10">10×+</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
          Recency
          <select
            value={recency}
            onChange={(e) => {
              setRecency(e.target.value as RecencyBand);
            }}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
            aria-label="Recency band"
          >
            <option value="all">All time</option>
            <option value="month">This month</option>
            <option value="week">This week</option>
          </select>
        </label>
      </div>

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
        shelf === "validated" ? (
          <EmptyState
            title="No validated concepts yet"
            hint="Save a concept from Discover and it lands here — with evidence links to the real videos — so you can come back and write it."
          />
        ) : (
          <EmptyState
            title={niche === null ? "No concepts yet" : `Nothing in “${niche}” yet`}
            hint="The daily run surfaces fresh concepts each morning — or generate a batch now."
            action={
              <Button
                variant="primary"
                busy={batchMutation.isPending}
                onClick={() => {
                  batchMutation.mutate({ workspaceId, channelId });
                }}
              >
                <IconSparkle size={14} /> Get concepts now
              </Button>
            }
          />
        )
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

      {shelf === "discover" ? (
        <CompetitorCompare workspaceId={workspaceId} channelId={channelId} onDone={refresh} />
      ) : null}

      {topOutliers.length > 0 ? (
        <section aria-label="Proven videos in your niche" className="mt-8">
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
            Proven videos in your niche
          </h2>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {topOutliers.slice(0, 8).map((o) => (
              <OutlierCard key={o.id} video={o} why={why.get(o.youtubeVideoId) ?? null} now={now} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ShelfTab({
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
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-accent-600 text-white"
          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
      }`}
    >
      {label}
    </button>
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
          ? "border-accent-600 bg-accent-50 text-accent-800 dark:border-accent-500 dark:bg-accent-950/60 dark:text-accent-300"
          : "border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600"
      }`}
    >
      {label}
    </button>
  );
}
