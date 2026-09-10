"use client";

import type { Idea } from "@/lib/types/entities";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconCheck, IconExternal, IconPlay, IconX } from "@/components/ui/icons";
import { canChangeStatus, scoreTone, youtubeWatchUrl } from "./feed-logic";

/**
 * One idea in the daily feed: title, angle, why-now rationale, evidence
 * links to the outlier videos on YouTube (metadata + URLs only — never
 * re-hosted media), and the save / dismiss / promote actions.
 */
export function IdeaCard({
  idea,
  onSave,
  onDismiss,
  onPromote,
  promoting,
}: {
  idea: Idea;
  onSave: (idea: Idea) => void;
  onDismiss: (idea: Idea) => void;
  onPromote: (idea: Idea) => void;
  /** True while THIS idea's promote mutation is in flight. */
  promoting: boolean;
}) {
  const actionable = canChangeStatus(idea.status);
  const score = Math.round(idea.score);

  return (
    <article
      aria-label={`Idea: ${idea.title}`}
      className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{idea.title}</h3>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{idea.angle}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {idea.status !== "new" ? (
            <Badge tone={idea.status === "dismissed" ? "neutral" : "purple"}>{idea.status}</Badge>
          ) : null}
          <Badge tone={scoreTone(score)} title={`Idea score ${score} out of 100`}>
            <span aria-hidden="true">{score}</span>
            <span className="sr-only">Idea score {score} out of 100</span>
          </Badge>
        </div>
      </div>

      <p className="mt-3 rounded-md bg-zinc-50 px-3 py-2 text-xs leading-5 text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">Why now: </span>
        {idea.rationale}
      </p>

      {idea.evidenceVideoIds.length > 0 ? (
        <ul aria-label="Evidence videos" className="mt-3 flex flex-wrap gap-2">
          {idea.evidenceVideoIds.map((videoId) => (
            <li key={videoId}>
              <a
                href={youtubeWatchUrl(videoId)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Watch evidence video ${videoId} on YouTube (opens in a new tab)`}
                className="inline-flex items-center gap-1 rounded-full border border-zinc-300 px-2 py-0.5 text-[11px] font-medium text-zinc-600 transition-colors hover:border-emerald-500 hover:text-emerald-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-emerald-500 dark:hover:text-emerald-400"
              >
                <IconPlay size={10} /> {videoId} <IconExternal size={10} />
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          busy={promoting}
          disabled={!actionable}
          aria-label={`Promote "${idea.title}" to a project`}
          onClick={() => {
            onPromote(idea);
          }}
        >
          Promote to project
        </Button>
        {idea.status !== "saved" ? (
          <Button
            size="sm"
            disabled={!actionable}
            aria-label={`Save "${idea.title}" for later`}
            onClick={() => {
              onSave(idea);
            }}
          >
            <IconCheck size={12} /> Save
          </Button>
        ) : null}
        {idea.status !== "dismissed" ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={!actionable}
            aria-label={`Dismiss "${idea.title}"`}
            onClick={() => {
              onDismiss(idea);
            }}
          >
            <IconX size={12} /> Dismiss
          </Button>
        ) : null}
      </div>
    </article>
  );
}
