/**
 * Cheap deterministic text similarity for idea dedup (build spec §5.4).
 *
 * The spec's embedding-cosine dedup (>0.85 = dup) needs an embedding
 * provider that is not part of the v1 provider set, so v1.1 ships a
 * trigram Jaccard on normalized titles instead: similarity >= 0.6 = dup.
 * Deterministic, dependency-free, and mirrors pg_trgm's padded-trigram
 * scheme so a future move to `similarity()` in Postgres keeps behavior.
 * Embedding-based dedup is deferred (see OPEN-ITEMS.md).
 */

/** Duplicate threshold on trigram Jaccard similarity of normalized titles. */
export const TITLE_SIMILARITY_THRESHOLD = 0.6;

/** Lowercase, strip accents/punctuation, collapse whitespace. */
export function normalizeTitle(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Niche keywords share the same normalization so equal niches cache-hit. */
export function normalizeKeyword(keyword: string): string {
  return normalizeTitle(keyword);
}

/** Unique, sorted, normalized keyword set — the identity of a niche. */
export function normalizeKeywordSet(keywords: readonly string[]): string[] {
  const set = new Set<string>();
  for (const keyword of keywords) {
    const normalized = normalizeKeyword(keyword);
    if (normalized.length > 0) set.add(normalized);
  }
  return [...set].sort();
}

/** Character trigrams with pg_trgm-style padding ("  word "). */
export function trigrams(normalized: string): Set<string> {
  const grams = new Set<string>();
  if (normalized.length === 0) return grams;
  const padded = `  ${normalized} `;
  for (let i = 0; i + 3 <= padded.length; i += 1) {
    grams.add(padded.slice(i, i + 3));
  }
  return grams;
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const gram of a) {
    if (b.has(gram)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Similarity in [0, 1] between two raw titles. */
export function titleSimilarity(a: string, b: string): number {
  return jaccard(trigrams(normalizeTitle(a)), trigrams(normalizeTitle(b)));
}

/** True when `title` duplicates any of `existingTitles` at the threshold. */
export function isDuplicateTitle(
  title: string,
  existingTitles: readonly string[],
  threshold: number = TITLE_SIMILARITY_THRESHOLD,
): boolean {
  const grams = trigrams(normalizeTitle(title));
  return existingTitles.some(
    (existing) => jaccard(grams, trigrams(normalizeTitle(existing))) >= threshold,
  );
}
