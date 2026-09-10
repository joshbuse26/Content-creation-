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
    <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50/50 p-2.5 dark:border-emerald-900 dark:bg-emerald-950/30">
      <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-emerald-800 uppercase dark:text-emerald-300">
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
                  ? "border-emerald-600 bg-emerald-600 text-white dark:border-emerald-500 dark:bg-emerald-500"
                  : "border-emerald-300 bg-white text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-zinc-900 dark:text-emerald-300 dark:hover:bg-emerald-950"
              }`}
            >
              {c.style.replace(/_/g, " ")}
              {c.autoPicked ? " ★" : ""}
            </button>
          );
        })}
      </div>
      {activeIndex === -1 ? (
        <p className="mt-1.5 text-[11px] text-emerald-700/80 dark:text-emerald-400/80">
          Custom hook in use — pick a candidate to swap it in.
        </p>
      ) : null}
    </div>
  );
}
