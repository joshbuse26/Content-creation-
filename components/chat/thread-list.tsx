"use client";

import type { ChatThread } from "@/lib/types/entities";
import type { ChatThreadId } from "@/lib/types/ids";

/**
 * The conversation list — one component rendered in two places: the chat
 * panel's inline sidebar (project chat) and the app shell's left rail
 * (Coach). Both feed it from the same ChatThreadsProvider selection.
 */
export function ThreadList({
  threads,
  loading,
  selectedId,
  onSelect,
}: {
  threads: ChatThread[];
  loading: boolean;
  selectedId: ChatThreadId | null;
  onSelect: (id: ChatThreadId) => void;
}) {
  return (
    <ul className="flex flex-col gap-0.5" aria-label="Conversations">
      {loading ? (
        <li className="px-2.5 py-2 text-xs text-zinc-400 dark:text-muted">Loading…</li>
      ) : threads.length === 0 ? (
        <li className="px-2.5 py-2 text-xs text-zinc-400 dark:text-muted">No conversations yet.</li>
      ) : (
        threads.map((t) => {
          const active = t.id === selectedId;
          return (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => {
                  onSelect(t.id);
                }}
                aria-current={active ? "true" : undefined}
                className={`w-full truncate rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
                  active
                    ? "bg-accent-50 font-medium text-accent-800 dark:bg-surface-2 dark:text-ink"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-muted dark:hover:bg-surface-2 dark:hover:text-ink"
                }`}
              >
                {t.title}
              </button>
            </li>
          );
        })
      )}
    </ul>
  );
}
