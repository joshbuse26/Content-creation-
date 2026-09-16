"use client";

import { useMemo, useState } from "react";
import { skipToken } from "@tanstack/react-query";
import { trpc } from "@/components/providers/trpc";
import { useWorkspace } from "@/components/providers/workspace-context";
import { IconSparkle } from "@/components/ui/icons";
import { coachSeedPrompt } from "./coach-seed";

/**
 * Trending/outliers launcher for the Coach (Wave-D E3). A zero-cost surface
 * that READS the existing ideas feed (no new business logic, no charge) and
 * lets the creator pipe a chosen concept straight into the thread composer —
 * reusing the same coach-seed prompt the discovery "Ask Coach" hand-off uses.
 * Collapsed by default so it never crowds the conversation.
 */
export function OutliersLauncher({ onPick }: { onPick: (prompt: string) => void }) {
  const { workspaceId, channelId } = useWorkspace();
  const [open, setOpen] = useState(false);

  const feedQuery = trpc.ideas.feed.useQuery(
    open && workspaceId !== null && channelId !== null
      ? { workspaceId, channelId, limit: 6 }
      : skipToken,
  );
  const concepts = useMemo(
    () => (feedQuery.data ?? []).filter((i) => i.status !== "dismissed").slice(0, 6),
    [feedQuery.data],
  );

  if (channelId === null) return null;

  return (
    <div className="border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
        }}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-accent-700 hover:underline dark:text-accent-400"
      >
        <IconSparkle size={12} /> {open ? "Hide trending concepts" : "Trending in your niche"}
      </button>
      {open ? (
        feedQuery.isLoading ? (
          <p className="mt-2 text-xs text-zinc-400">Loading concepts…</p>
        ) : concepts.length === 0 ? (
          <p className="mt-2 text-xs text-zinc-400">
            No concepts yet — generate a batch on the Discover page.
          </p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Trending concepts">
            {concepts.map((idea) => (
              <li key={idea.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(coachSeedPrompt({ title: idea.title, angle: idea.angle }));
                    setOpen(false);
                  }}
                  className="rounded-full border border-zinc-300 px-2.5 py-1 text-[11px] font-medium text-zinc-600 transition-colors hover:border-accent-500 hover:text-accent-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-accent-500 dark:hover:text-accent-400"
                  title={idea.angle}
                >
                  {idea.title}
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
