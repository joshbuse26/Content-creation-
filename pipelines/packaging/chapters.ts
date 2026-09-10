import type { ChapterEntry } from "@/lib/types/entities";
import type { SectionKind } from "@/lib/types/enums";

/**
 * Chapter derivation — spec §5.11.
 *
 * Chapters are derived from the script sections' est_seconds: each section
 * starts where the previous one ended (cumulative sum), the first entry is
 * always 0:00, and labels come from section headings. Pure functions — no DB,
 * no LLM — so the math is trivially testable and the result is editable
 * afterwards without re-derivation.
 */

export interface ChapterSourceSection {
  kind: SectionKind;
  heading: string;
  estSeconds: number;
}

export interface DeriveChaptersOptions {
  /**
   * YouTube ignores chapters shorter than 10 seconds; sections under this
   * threshold are folded into the preceding chapter instead of getting their
   * own entry. The first section is always kept. Default 10.
   */
  minChapterSeconds?: number;
  /** Section kinds that never get their own chapter entry (folded into the previous). */
  excludeKinds?: readonly SectionKind[];
}

/** mm:ss under an hour, h:mm:ss at or above. Matches YouTube description format. */
export function formatTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const two = (n: number) => n.toString().padStart(2, "0");
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}

/**
 * Derive chapter entries from sections in position order.
 *
 * - Timestamps are the cumulative sum of preceding sections' estSeconds.
 * - The first entry is always at tsSeconds 0.
 * - Sections shorter than minChapterSeconds (or of an excluded kind) are
 *   folded into the preceding chapter — no entry is emitted for them, but
 *   their duration still advances the clock.
 */
export function deriveChapters(
  sections: readonly ChapterSourceSection[],
  options: DeriveChaptersOptions = {},
): ChapterEntry[] {
  const minSeconds = options.minChapterSeconds ?? 10;
  const excluded = new Set(options.excludeKinds ?? []);

  const entries: ChapterEntry[] = [];
  let cursor = 0;
  for (const [index, section] of sections.entries()) {
    const keep = index === 0 || (!excluded.has(section.kind) && section.estSeconds >= minSeconds);
    if (keep) {
      entries.push({
        tsSeconds: index === 0 ? 0 : cursor,
        label: section.heading.trim() === "" ? section.kind : section.heading.trim(),
      });
    }
    cursor += Math.max(0, section.estSeconds);
  }
  return entries;
}

/** Render entries as the copy-pastable YouTube description block. */
export function renderChapterList(entries: readonly ChapterEntry[]): string {
  return entries.map((e) => `${formatTimestamp(e.tsSeconds)} ${e.label}`).join("\n");
}
