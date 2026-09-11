"use client";

import { useState } from "react";
import type { DemandSignal, Idea } from "@/lib/types/entities";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconCheck, IconExternal, IconPlay, IconSparkle, IconX } from "@/components/ui/icons";
import { canChangeStatus, scoreTone, youtubeWatchUrl } from "@/components/ideas/feed-logic";
import { demandLabel, demandTone, ratioLabel } from "./discovery-logic";

/**
 * One high-performing concept on the discovery surface: the idea's title,
 * angle (editable — the steerable unique angle you can sharpen before writing),
 * why-now rationale, its score, the search-demand signal, the outlier
 * performance ratio, evidence links to the proven videos, and the one-click
 * "Use this idea" (→ framing) / "Ask Coach" (→ the project's Coach thread).
 */
export function DiscoveryCard({
  idea,
  demand,
  outlierRatio,
  onUse,
  onAskCoach,
  onSave,
  onDismiss,
  busy,
}: {
  idea: Idea;
  demand: DemandSignal | null;
  outlierRatio: number | null;
  /** Fired with the (possibly sharpened) unique angle. */
  onUse: (idea: Idea, angle: string) => void;
  onAskCoach: (idea: Idea, angle: string) => void;
  onSave: (idea: Idea) => void;
  onDismiss: (idea: Idea) => void;
  /** True while THIS card's use/ask mutation is in flight. */
  busy: boolean;
}) {
  const [angle, setAngle] = useState(idea.angle);
  const [editing, setEditing] = useState(false);
  const actionable = canChangeStatus(idea.status);
  const score = Math.round(idea.score);
  const trimmed = angle.trim();
  const useAngle = trimmed === "" ? idea.angle : trimmed;

  return (
    <article
      aria-label={`Concept: ${idea.title}`}
      className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{idea.title}</h3>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {idea.status !== "new" ? (
            <Badge tone={idea.status === "dismissed" ? "neutral" : "purple"}>{idea.status}</Badge>
          ) : null}
          {demand !== null ? (
            <Badge
              tone={demandTone(demand.level)}
              title={`Search demand ${demand.score} of 100 (${demand.sampleCount} results)`}
            >
              {demandLabel(demand.level)}
            </Badge>
          ) : null}
          <Badge tone={scoreTone(score)} title={`Idea score ${score} out of 100`}>
            <span aria-hidden="true">{score}</span>
            <span className="sr-only">Idea score {score} out of 100</span>
          </Badge>
        </div>
      </div>

      {/* Steerable unique angle */}
      <div className="mt-2">
        {editing ? (
          <div>
            <label htmlFor={`angle-${idea.id}`} className="sr-only">
              Unique angle for {idea.title}
            </label>
            <textarea
              id={`angle-${idea.id}`}
              rows={2}
              value={angle}
              onChange={(e) => {
                setAngle(e.target.value);
              }}
              className="w-full resize-none rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
              placeholder="Sharpen the unique angle before you write…"
            />
          </div>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">Angle: </span>
            {useAngle}
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            setEditing((v) => !v);
          }}
          className="mt-1 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
        >
          {editing ? "Done" : "Sharpen angle"}
        </button>
      </div>

      <p className="mt-3 rounded-md bg-zinc-50 px-3 py-2 text-xs leading-5 text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">Why now: </span>
        {idea.rationale}
      </p>

      {outlierRatio !== null ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          <IconSparkle size={12} /> Proven concept — {ratioLabel(outlierRatio)}
        </p>
      ) : null}

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
          busy={busy}
          disabled={!actionable}
          aria-label={`Use "${idea.title}" — start framing with this unique angle`}
          onClick={() => {
            onUse(idea, useAngle);
          }}
        >
          <IconSparkle size={12} /> Use this idea
        </Button>
        <Button
          size="sm"
          disabled={!actionable || busy}
          aria-label={`Ask Coach about "${idea.title}"`}
          onClick={() => {
            onAskCoach(idea, useAngle);
          }}
        >
          Ask Coach
        </Button>
        {idea.status !== "saved" ? (
          <Button
            variant="ghost"
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
