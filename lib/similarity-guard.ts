/**
 * Licensed-voice similarity guard (PRODUCT-CONTRACTS §7 / build spec §5.7).
 *
 * A licensed voice may be IMITATED but never REPRODUCED: the output must not
 * quote the licensed source material verbatim. This module is the machine
 * check behind that promise — pure, deterministic, unit-tested, with NO I/O
 * and no dependency on the pipeline. The pipeline calls `guardSection`; the
 * math (`analyzeSimilarity`) is exported so it can be tested directly.
 *
 * Method (frozen numbers live in config; passed in as `threshold`):
 *  - tokenize both sides to lowercase alphanumeric words;
 *  - build the set of 5-grams over the licensed source snippets (per snippet,
 *    never across snippet boundaries);
 *  - slide a 200-word window over the OUTPUT; for each window compute the
 *    fraction of its 5-grams that appear in the source set;
 *  - the report's overlap is the WORST (max) window — a single over-similar
 *    passage fails the whole section, exactly as the spec requires.
 *
 * `guardSection` runs the check, auto-rewrites ONCE against a de-duplication
 * instruction when a section is over the line, re-checks, and HARD-FAILS
 * (throws LicensedSimilarityError) if the rewrite is still over — the caller
 * must never emit text that trips this guard.
 */

export interface SimilarityOptions {
  /** n for the n-gram overlap. Default 5 (spec). */
  ngram: number;
  /** Sliding window length in words. Default 200 (spec). */
  windowWords: number;
  /** Window stride in words. Default 50 — dense enough that any verbatim
   *  200-word span lands heavily inside some window. */
  strideWords: number;
}

export const DEFAULT_SIMILARITY_OPTIONS: SimilarityOptions = {
  ngram: 5,
  windowWords: 200,
  strideWords: 50,
};

export interface SimilarityReport {
  /** Worst single-window 5-gram overlap ratio in [0,1]. */
  maxOverlap: number;
  /** Number of windows evaluated. */
  windowCount: number;
  /** Word index the worst window started at (0 when not applicable). */
  worstWindowStart: number;
  /** 5-grams the worst window shares with the source (short, for logging). */
  matchedNgrams: string[];
}

/** Lowercase alphanumeric word tokens — the atoms both sides are compared on. */
export function tokenizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

/** Contiguous n-grams of `tokens` as space-joined strings (order preserved). */
export function ngrams(tokens: string[], n: number): string[] {
  if (n < 1 || tokens.length < n) return [];
  const grams: string[] = [];
  for (let i = 0; i + n <= tokens.length; i++) {
    grams.push(tokens.slice(i, i + n).join(" "));
  }
  return grams;
}

/** Union of the source snippets' n-grams (per snippet, no cross-snippet grams). */
export function buildSourceNgramSet(sources: readonly string[], n: number): Set<string> {
  const set = new Set<string>();
  for (const source of sources) {
    for (const gram of ngrams(tokenizeWords(source), n)) set.add(gram);
  }
  return set;
}

/** Fraction of `windowTokens`' n-grams that appear in `sourceSet`, in [0,1]. */
function windowOverlap(
  windowTokens: string[],
  sourceSet: ReadonlySet<string>,
  n: number,
): { overlap: number; matched: string[] } {
  const grams = ngrams(windowTokens, n);
  if (grams.length === 0) return { overlap: 0, matched: [] };
  const matched: string[] = [];
  for (const gram of grams) {
    if (sourceSet.has(gram)) matched.push(gram);
  }
  return { overlap: matched.length / grams.length, matched };
}

/**
 * Worst-window 5-gram overlap of `output` against the licensed `sources`.
 * Returns maxOverlap 0 when there is nothing to compare (no source grams, or
 * output shorter than one n-gram) — an empty licensed corpus can never make
 * the guard fire, so licensed cards WITHOUT snippets are simply not gated
 * (the card-usability check is a separate gate).
 */
export function analyzeSimilarity(
  output: string,
  sources: readonly string[],
  options: Partial<SimilarityOptions> = {},
): SimilarityReport {
  const { ngram, windowWords, strideWords } = { ...DEFAULT_SIMILARITY_OPTIONS, ...options };
  const sourceSet = buildSourceNgramSet(sources, ngram);
  const tokens = tokenizeWords(output);
  if (sourceSet.size === 0 || tokens.length < ngram) {
    return { maxOverlap: 0, windowCount: 0, worstWindowStart: 0, matchedNgrams: [] };
  }

  // Window start offsets: strided, plus a guaranteed final window flush with
  // the end so a copied span at the tail is never missed. Short output = one
  // window covering everything.
  const starts: number[] = [];
  if (tokens.length <= windowWords) {
    starts.push(0);
  } else {
    const lastStart = tokens.length - windowWords;
    for (let s = 0; s < lastStart; s += Math.max(1, strideWords)) starts.push(s);
    starts.push(lastStart);
  }

  let maxOverlap = 0;
  let worstWindowStart = 0;
  let matchedNgrams: string[] = [];
  for (const start of starts) {
    const windowTokens = tokens.slice(start, start + windowWords);
    const { overlap, matched } = windowOverlap(windowTokens, sourceSet, ngram);
    if (overlap > maxOverlap) {
      maxOverlap = overlap;
      worstWindowStart = start;
      matchedNgrams = matched.slice(0, 8);
    }
  }
  return { maxOverlap, windowCount: starts.length, worstWindowStart, matchedNgrams };
}

/** Strict: a section is over the line only ABOVE the threshold (spec: >8%). */
export function exceedsSimilarity(report: SimilarityReport, threshold: number): boolean {
  return report.maxOverlap > threshold;
}

export type GuardStatus = "clean" | "rewritten" | "blocked";

export interface GuardOutcome {
  status: GuardStatus;
  /** The text safe to emit ("clean" = original, "rewritten" = de-duped). */
  body: string;
  /** First-pass report (always present). */
  before: SimilarityReport;
  /** Re-check report after the single auto-rewrite; null when never rewritten. */
  after: SimilarityReport | null;
  threshold: number;
}

/**
 * Thrown when a licensed section is STILL over the similarity threshold after
 * the one allowed auto-rewrite. A typed, user-surfaceable hard fail — the
 * over-similar text is never returned.
 */
export class LicensedSimilarityError extends Error {
  readonly before: SimilarityReport;
  readonly after: SimilarityReport;
  readonly threshold: number;
  constructor(params: { before: SimilarityReport; after: SimilarityReport; threshold: number }) {
    const pct = (params.after.maxOverlap * 100).toFixed(1);
    const max = (params.threshold * 100).toFixed(1);
    super(
      `Licensed-voice similarity guard: this section still reproduces the licensed ` +
        `source too closely after an automatic rewrite (${pct}% 5-gram overlap in a ` +
        `200-word window; limit ${max}%). It was not published — edit the section to ` +
        `put the idea in your own words, or choose a different voice for it.`,
    );
    this.name = "LicensedSimilarityError";
    this.before = params.before;
    this.after = params.after;
    this.threshold = params.threshold;
  }
}

export interface GuardSectionParams {
  /** The drafted / voice-passed section text to check. */
  body: string;
  /** Licensed source material (the licensed card's example snippets / transcripts). */
  sources: readonly string[];
  /** Max allowed worst-window overlap (config LICENSED_SIMILARITY_MAX_OVERLAP). */
  threshold: number;
  /** De-duplication rewrite — LLM in live mode, deterministic in fixtures/tests. */
  rewrite: (body: string) => Promise<string>;
  options?: Partial<SimilarityOptions>;
}

/**
 * The guard gate for one section. Returns a "clean" or "rewritten" outcome
 * with text safe to emit; throws LicensedSimilarityError when even the
 * rewrite is over the line (never returns over-similar text).
 */
export async function guardSection(params: GuardSectionParams): Promise<GuardOutcome> {
  const { body, sources, threshold, rewrite, options } = params;
  const before = analyzeSimilarity(body, sources, options);
  if (!exceedsSimilarity(before, threshold)) {
    return { status: "clean", body, before, after: null, threshold };
  }
  const rewritten = await rewrite(body);
  const after = analyzeSimilarity(rewritten, sources, options);
  if (!exceedsSimilarity(after, threshold)) {
    return { status: "rewritten", body: rewritten, before, after, threshold };
  }
  throw new LicensedSimilarityError({ before, after, threshold });
}
