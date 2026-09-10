import type { BadgeTone } from "@/components/ui/badge";
import type { Idea } from "@/lib/types/entities";
import type { IdeaStatus } from "@/lib/types/enums";

/**
 * Pure feed logic — separated from the screen component so the status
 * filter, optimistic transitions and evidence-link building are unit
 * testable without a DOM.
 */

export type FeedFilter = "new" | "saved" | "all";

export const FEED_FILTERS: { id: FeedFilter; label: string }[] = [
  { id: "new", label: "New" },
  { id: "saved", label: "Saved" },
  { id: "all", label: "Everything" },
];

/** The status the server is asked for; undefined = no status filter. */
export function filterToStatus(filter: FeedFilter): IdeaStatus | undefined {
  return filter === "all" ? undefined : filter;
}

/** Evidence ids are YouTube video ids — never stored media (spec §0). */
export function youtubeWatchUrl(youtubeVideoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(youtubeVideoId)}`;
}

/** Optimistic cache update: flip one idea's status in a feed snapshot. */
export function applyStatusChange(ideas: Idea[], ideaId: string, status: IdeaStatus): Idea[] {
  return ideas.map((idea) => (idea.id === ideaId ? { ...idea, status } : idea));
}

/**
 * Whether an idea stays visible under a filter after an optimistic status
 * flip (a dismissed idea leaves the "new" tab immediately).
 */
export function matchesFilter(status: IdeaStatus, filter: FeedFilter): boolean {
  return filter === "all" || status === filter;
}

/** Save/dismiss are one-way once an idea became a project. */
export function canChangeStatus(status: IdeaStatus): boolean {
  return status !== "promoted";
}

export function scoreTone(score: number): BadgeTone {
  if (score >= 80) return "emerald";
  if (score >= 60) return "blue";
  if (score >= 40) return "yellow";
  return "neutral";
}

/** Group a feed by generatedOn (ISO date), newest day first. */
export function groupByDay(ideas: Idea[]): { day: string; ideas: Idea[] }[] {
  const groups = new Map<string, Idea[]>();
  for (const idea of ideas) {
    const bucket = groups.get(idea.generatedOn);
    if (bucket !== undefined) bucket.push(idea);
    else groups.set(idea.generatedOn, [idea]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([day, dayIdeas]) => ({ day, ideas: dayIdeas }));
}
