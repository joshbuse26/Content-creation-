"use client";

import type { NicheVideo } from "@/lib/types/entities";
import { Badge } from "@/components/ui/badge";
import { IconClock, IconExternal, IconPlay, IconSparkle } from "@/components/ui/icons";
import { scoreTone, youtubeWatchUrl } from "@/components/ideas/feed-logic";
import {
  enrichOutlier,
  recencyLabel,
  viewMultipleLabel,
  viewsPerDayLabel,
} from "./discovery-logic";

/**
 * A richer proven-video card (Wave-D E3): the enriched outlier signals a
 * creator reads when validating a concept before writing — the view multiple
 * vs. the channel baseline, the view velocity (momentum), a recency badge, the
 * format/niche tags as chips, and a cached "why it worked" one-liner. Evidence
 * opens the REAL YouTube video (stored youtubeVideoId → watch URL).
 */
export function OutlierCard({
  video,
  why,
  now,
}: {
  video: NicheVideo;
  /** The cached "why it worked" blurb for this video, when loaded. */
  why: string | null;
  /** Injected for deterministic enrichment (velocity/recency) in tests/SSR. */
  now?: Date;
}) {
  const e = enrichOutlier(video, now ?? new Date());
  const tags = [...e.formatTags, ...e.nicheKeywords];

  return (
    <article
      aria-label={`Proven video: ${video.title}`}
      className="rounded-lg border border-zinc-200 bg-white p-3.5 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 text-sm font-medium text-zinc-800 dark:text-zinc-200">
          {video.title}
        </h3>
        <a
          href={youtubeWatchUrl(video.youtubeVideoId)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Watch ${video.title} on YouTube (opens in a new tab)`}
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-accent-700 hover:underline dark:text-accent-400"
        >
          <IconPlay size={11} /> Watch <IconExternal size={10} />
        </a>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {e.viewMultiple !== null ? (
          <Badge
            tone={scoreTone(Math.min(100, e.viewMultiple * 10))}
            title="Views vs. channel median"
          >
            <IconSparkle size={10} /> {viewMultipleLabel(e.viewMultiple)}
          </Badge>
        ) : null}
        <Badge tone="blue" title="View velocity since publish">
          <IconClock size={10} /> {viewsPerDayLabel(e.viewsPerDay)}
        </Badge>
        <Badge
          tone={e.recency === "older" ? "neutral" : "accent"}
          title="How recently it published"
        >
          {recencyLabel(e.recency)}
        </Badge>
      </div>

      {tags.length > 0 ? (
        <ul aria-label="Format and niche tags" className="mt-2 flex flex-wrap gap-1">
          {tags.map((tag) => (
            <li
              key={tag}
              className="rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
            >
              {tag}
            </li>
          ))}
        </ul>
      ) : null}

      {why !== null ? (
        <p className="mt-2.5 rounded-md bg-zinc-50 px-3 py-2 text-xs leading-5 text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">Why it worked: </span>
          {why}
        </p>
      ) : null}
    </article>
  );
}
