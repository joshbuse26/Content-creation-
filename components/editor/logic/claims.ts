import type { FactRef } from "@/lib/types/entities";

/**
 * Unsupported-claim highlighting (spec §5.7.6): claims whose fact_ref has no
 * research doc are marked in the section body. Claims are matched
 * case-insensitively; claims that don't appear verbatim are returned
 * separately so the UI can list them under the section instead.
 */

export interface BodySegment {
  text: string;
  unsupported: boolean;
}

export interface ClaimHighlightResult {
  segments: BodySegment[];
  /** Unsupported claims that could not be located in the body text. */
  unmatchedUnsupported: string[];
}

export function highlightClaims(body: string, factRefs: readonly FactRef[]): ClaimHighlightResult {
  const unsupported = factRefs.filter((f) => f.researchDocId === null && f.claim.trim() !== "");
  if (unsupported.length === 0) {
    return { segments: [{ text: body, unsupported: false }], unmatchedUnsupported: [] };
  }

  const lower = body.toLowerCase();
  const ranges: { start: number; end: number }[] = [];
  const unmatched: string[] = [];

  for (const ref of unsupported) {
    const needle = ref.claim.toLowerCase();
    const at = lower.indexOf(needle);
    if (at === -1) {
      unmatched.push(ref.claim);
    } else {
      ranges.push({ start: at, end: at + needle.length });
    }
  }

  if (ranges.length === 0) {
    return { segments: [{ text: body, unsupported: false }], unmatchedUnsupported: unmatched };
  }

  // Merge overlapping ranges, then slice the body into segments.
  ranges.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last !== undefined && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ ...r });
    }
  }

  const segments: BodySegment[] = [];
  let cursor = 0;
  for (const r of merged) {
    if (r.start > cursor) segments.push({ text: body.slice(cursor, r.start), unsupported: false });
    segments.push({ text: body.slice(r.start, r.end), unsupported: true });
    cursor = r.end;
  }
  if (cursor < body.length) segments.push({ text: body.slice(cursor), unsupported: false });

  return { segments, unmatchedUnsupported: unmatched };
}
