"use client";

import type { HookCandidate } from "@/lib/types/pipeline";

/**
 * Hook candidate switcher: 3 tagged candidates from the draft stage; the
 * active one is whichever currently matches the hook section body. Picking a
 * candidate rewrites the hook section.
 */
export function HookSwitcher({
  candidates,
  currentBody,
  onPick,
}: {
  candidates: HookCandidate[];
  currentBody: string;
  onPick: (candidate: HookCandidate) => void;
}) {
  if (candidates.length === 0) return null;
  const activeIndex = candidates.findIndex((c) => c.body.trim() === currentBody.trim());

  return (
    <div className="mb-3 rounded-md border border-accent-200 bg-accent-50/50 p-2.5 dark:border-accent-900 dark:bg-accent-950/30">
      <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-accent-800 uppercase dark:text-accent-300">
        Hook candidates
      </p>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Hook candidates">
        {candidates.map((c, i) => {
          const active = i === activeIndex;
          return (
            <button
              key={c.style + String(i)}
              type="button"
              role="radio"
              aria-checked={i === activeIndex}
              title={c.body}
              onClick={() => {
                onPick(c);
              }}
              className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                active
                  ? "border-accent-600 bg-accent-600 text-white dark:border-accent-500 dark:bg-accent-500"
                  : "border-accent-300 bg-white text-accent-800 hover:bg-accent-100 dark:border-accent-800 dark:bg-zinc-900 dark:text-accent-300 dark:hover:bg-accent-950"
              }`}
            >
              {c.style.replace(/_/g, " ")}
              {c.autoPicked ? " ★" : ""}
            </button>
          );
        })}
      </div>
      {activeIndex === -1 ? (
        <p className="mt-1.5 text-[11px] text-accent-800 dark:text-accent-300">
          Custom hook in use — pick a candidate to swap it in.
        </p>
      ) : null}
    </div>
  );
}
