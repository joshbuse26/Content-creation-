"use client";

import Link from "next/link";
import { skipToken } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { IntelVerdict, IntelVideo } from "@/lib/intel/stats";
import { trpc } from "@/components/providers/trpc";
import { useWorkspace } from "@/components/providers/workspace-context";
import { PageHeader } from "@/components/shell/app-shell";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconExternal, IconRefresh } from "@/components/ui/icons";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/state";
import { useToast } from "@/components/ui/toast";
import { fmtCompact, fmtDate, fmtDuration } from "@/components/lib/format";

/**
 * Intel = the creator's OWN channel, nothing else: a headline sentence, three
 * hero stats, strong vs weak in plain English, period and length breakdowns,
 * the upload table, and an honest "needs Analytics access" block for the
 * metrics the public Data API cannot give us. Idea mining lives under Tools.
 */
export function ChannelStatsScreen() {
  const { workspaceId, channelId, channels, channelsLoading } = useWorkspace();
  const { toast } = useToast();
  const utils = trpc.useUtils();

  // Intel is per channel: the switcher's pick, else the workspace's first.
  const channel = channels.find((c) => c.id === channelId) ?? channels[0];
  const activeId = channel?.id ?? null;

  const statsQuery = trpc.channel.stats.useQuery(
    workspaceId !== null && activeId !== null ? { workspaceId, channelId: activeId } : skipToken,
    { staleTime: 60_000 },
  );
  const syncMutation = trpc.channel.sync.useMutation({
    onSuccess: () => {
      toast("Sync queued — stats refresh when it finishes.", "success");
      if (workspaceId !== null && activeId !== null) {
        void utils.channel.stats.invalidate({ workspaceId, channelId: activeId });
      }
    },
    onError: () => {
      toast("Could not start the channel sync — try again.");
    },
  });

  if (workspaceId === null || channelsLoading)
    return <LoadingState label="Loading your channel…" />;

  if (channel === undefined || activeId === null) {
    return (
      <div>
        <PageHeader title="Intel" subtitle="Your channel's numbers, in plain English." />
        <EmptyState
          title="Connect your YouTube channel"
          hint="Intel reads your own uploads and subscriber history — nothing shows here until a channel is connected."
          action={
            <Link
              href="/channels"
              className="inline-flex h-9 items-center rounded-md bg-accent-500 px-3.5 text-sm font-medium text-accent-fg hover:bg-accent-400"
            >
              Connect YouTube
            </Link>
          }
        />
      </div>
    );
  }

  if (statsQuery.isLoading) return <LoadingState label="Reading your channel…" />;
  if (statsQuery.isError || statsQuery.data === undefined) {
    return (
      <ErrorState
        message="Couldn't load your channel stats."
        onRetry={() => {
          void statsQuery.refetch();
        }}
      />
    );
  }
  const stats = statsQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Intel"
        subtitle={
          <>
            {stats.channel.title}
            {stats.channel.handle !== null ? ` · ${stats.channel.handle}` : ""}
            {stats.syncedAt !== null ? ` · synced ${fmtDate(stats.syncedAt)}` : " · never synced"}
          </>
        }
        actions={
          <Button
            size="sm"
            busy={syncMutation.isPending}
            onClick={() => {
              syncMutation.mutate({ workspaceId, channelId: activeId });
            }}
          >
            <IconRefresh size={12} /> Sync now
          </Button>
        }
      />

      <p className="max-w-3xl text-lg leading-snug font-medium">{stats.headline}</p>

      <section aria-label="Key numbers" className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Subscribers"
          value={stats.kpis.subs === null ? "—" : fmtCompact(stats.kpis.subs)}
          delta={stats.kpis.subsDelta}
        />
        <StatTile
          label="Median views per video"
          value={stats.videos.length === 0 ? "—" : fmtCompact(stats.kpis.medianViews)}
          hint={
            stats.videos.length === 0
              ? undefined
              : `avg ${fmtCompact(Math.round(stats.kpis.avgViews))}`
          }
        />
        <StatTile
          label="Uploads, last 30 days"
          value={String(stats.kpis.uploadsLast30d)}
          hint={
            stats.kpis.uploadsLast30d > 0
              ? `about one every ${String(Math.max(1, Math.round(30 / stats.kpis.uploadsLast30d)))} days`
              : undefined
          }
        />
      </section>

      <section aria-label="Secondary numbers" className="grid gap-3 sm:grid-cols-4">
        <StatTile
          small
          label="Lifetime views"
          value={stats.kpis.totalViews === null ? "—" : fmtCompact(stats.kpis.totalViews)}
          delta={stats.kpis.totalViewsDelta}
        />
        <StatTile small label="Like rate" value={pct(stats.kpis.avgLikeRate)} />
        <StatTile small label="Comment rate" value={pct(stats.kpis.avgCommentRate)} />
        <StatTile small label="Synced uploads" value={String(stats.videos.length)} />
      </section>

      <section aria-label="Strong and weak" className="grid gap-3 md:grid-cols-2">
        <InsightList title="What's working" tone="good" items={stats.strengths} />
        <InsightList title="What's not" tone="bad" items={stats.weaknesses} />
      </section>

      <section aria-label="Breakdowns" className="grid gap-3 md:grid-cols-2">
        <Panel title="By period">
          <table className="w-full text-sm">
            <thead className="text-xs text-zinc-500 dark:text-muted">
              <tr>
                <th className="py-1 text-left font-medium">Period</th>
                <th className="py-1 text-right font-medium">Videos</th>
                <th className="py-1 text-right font-medium">Views</th>
                <th className="py-1 text-right font-medium">Avg / video</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {stats.periods.map((p) => (
                <tr key={p.label} className="border-t border-zinc-200 dark:border-line">
                  <td className="py-1.5">{p.label}</td>
                  <td className="py-1.5 text-right">{p.videos}</td>
                  <td className="py-1.5 text-right">{fmtCompact(p.views)}</td>
                  <td className="py-1.5 text-right">{fmtCompact(Math.round(p.avgViews))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="By length">
          <table className="w-full text-sm">
            <thead className="text-xs text-zinc-500 dark:text-muted">
              <tr>
                <th className="py-1 text-left font-medium">Length</th>
                <th className="py-1 text-right font-medium">Videos</th>
                <th className="py-1 text-right font-medium">Avg views</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {stats.byBand.map((b) => (
                <tr key={b.band} className="border-t border-zinc-200 dark:border-line">
                  <td className="py-1.5">{b.label}</td>
                  <td className="py-1.5 text-right">{b.videos}</td>
                  <td className="py-1.5 text-right">
                    {b.videos === 0 ? "—" : fmtCompact(Math.round(b.avgViews))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </section>

      <Panel title="Your uploads">
        {stats.videos.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-muted">
            No uploads synced yet — run a sync to pull your recent videos.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-zinc-500 dark:text-muted">
              <tr>
                <th className="py-1 text-left font-medium">Video</th>
                <th className="py-1 text-left font-medium">Published</th>
                <th className="py-1 text-right font-medium">Length</th>
                <th className="py-1 text-right font-medium">Views</th>
                <th className="py-1 text-right font-medium">vs median</th>
                <th className="py-1 text-right font-medium">Views / day</th>
                <th className="py-1 text-right font-medium">Likes</th>
                <th className="py-1 pl-3 text-left font-medium">Read</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {stats.videos.map((v) => (
                <VideoRow key={v.youtubeVideoId} video={v} />
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="Needs YouTube Analytics access">
        <p className="mb-3 text-sm text-zinc-600 dark:text-muted">{stats.analytics.reason}</p>
        <ul className="grid gap-2 sm:grid-cols-5" aria-label="Unavailable metrics">
          {stats.analytics.fields.map((f) => (
            <li
              key={f.key}
              className="rounded-md border border-dashed border-zinc-300 px-3 py-2 dark:border-line"
            >
              <p className="text-xs text-zinc-500 dark:text-muted">{f.label}</p>
              <p className="text-sm font-medium text-zinc-400 dark:text-muted">N/A</p>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-zinc-500 dark:text-muted">
          Revenue and cost metrics (RPM, CPM, cost per acquisition) are not available to this app.
        </p>
      </Panel>

      <p className="text-xs text-zinc-500 dark:text-muted">
        Looking for video ideas? They live under{" "}
        <Link href="/toolkit" className="font-medium text-accent-400 hover:underline">
          Tools
        </Link>
        .
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

function pct(rate: number | null): string {
  return rate === null ? "—" : `${(rate * 100).toFixed(1)}%`;
}

function StatTile({
  label,
  value,
  delta,
  hint,
  small = false,
}: {
  label: string;
  value: string;
  delta?: { value: number; sinceDays: number } | null;
  hint?: string;
  small?: boolean;
}) {
  return (
    <div className="rounded-card border border-zinc-200 bg-white p-4 dark:border-line dark:bg-surface">
      <p className="text-xs text-zinc-500 dark:text-muted">{label}</p>
      <p className={`mt-1 font-semibold ${small ? "text-xl" : "text-3xl"}`}>{value}</p>
      {delta !== undefined && delta !== null ? (
        <p
          className={`mt-1 text-xs font-medium ${
            delta.value > 0
              ? "text-success"
              : delta.value < 0
                ? "text-danger"
                : "text-zinc-500 dark:text-muted"
          }`}
        >
          {delta.value > 0 ? "▲ +" : delta.value < 0 ? "▼ " : ""}
          {fmtCompact(delta.value)} in {Math.max(1, Math.round(delta.sinceDays))}d
        </p>
      ) : hint !== undefined ? (
        <p className="mt-1 text-xs text-zinc-500 dark:text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      aria-label={title}
      className="rounded-card border border-zinc-200 bg-white p-4 dark:border-line dark:bg-surface"
    >
      <h2 className="mb-3 text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

function InsightList({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "good" | "bad";
  items: string[];
}) {
  return (
    <Panel title={title}>
      {items.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-muted">
          {tone === "good"
            ? "Nothing stands out yet — a few more uploads will show a pattern."
            : "Nothing worrying in the synced uploads."}
        </p>
      ) : (
        <ul className="space-y-2 text-sm">
          {items.map((item) => (
            <li key={item} className="flex gap-2">
              <span
                aria-hidden="true"
                className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${tone === "good" ? "bg-success" : "bg-danger"}`}
              />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

const VERDICT: Record<IntelVerdict, { label: string; tone: BadgeTone }> = {
  strong: { label: "Strong", tone: "green" },
  typical: { label: "Typical", tone: "neutral" },
  weak: { label: "Weak", tone: "red" },
  too_early: { label: "Too early", tone: "neutral" },
};

function VideoRow({ video: v }: { video: IntelVideo }) {
  const verdict = VERDICT[v.verdict];
  return (
    <tr className="border-t border-zinc-200 dark:border-line">
      <td className="max-w-md py-2 pr-3">
        <a
          href={`https://www.youtube.com/watch?v=${encodeURIComponent(v.youtubeVideoId)}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 hover:underline"
        >
          <span className="truncate">{v.title}</span>
          <IconExternal size={11} className="shrink-0 text-zinc-400 dark:text-muted" />
        </a>
      </td>
      <td className="py-2 pr-3 whitespace-nowrap text-zinc-500 dark:text-muted">
        {fmtDate(v.publishedAt)}
      </td>
      <td className="py-2 text-right">{fmtDuration(v.durationSeconds)}</td>
      <td className="py-2 text-right">{fmtCompact(v.viewCount)}</td>
      <td className="py-2 text-right">{v.vsMedian.toFixed(1)}×</td>
      <td className="py-2 text-right">{fmtCompact(Math.round(v.viewsPerDay))}</td>
      <td className="py-2 text-right">{pct(v.likeRate)}</td>
      <td className="py-2 pl-3">
        <Badge tone={verdict.tone}>{verdict.label}</Badge>
      </td>
    </tr>
  );
}
