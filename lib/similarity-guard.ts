/**
 * Licensed-voice similarity guard (PRODUCT-CONTRACTS §7 / build spec §5.7).
 *
 * A licensed voice may be IMITATED but never REPRODUCED: the output must not
 * quote the licensed source material verbatim. This module is the machine
 * check behind that promise — pure, deterministic, unit-tested, with NO I/O
 * and no dependency on the pipeline. The pipeline calls `guardSection`; the
 * math (`analyzeSimilarity`) is exported so it can be tested directly.
 *
 * Three complementary checks run against the licensed source snippets so that
 * reproduction is caught at the SCALE OF THE MATERIAL — licensed snippets are
 * frequently short catchphrases (< 5 words), which the plain 5-gram/200-word
 * ratio silently no-ops on (empty n-gram set ⇒ ratio 0 ⇒ every section
 * "clean"). The three checks (a section trips the guard if ANY fires):
 *
 *  1. EXACT CONTAINMENT — any licensed snippet that appears verbatim
 *     (normalized to lowercase alphanumeric tokens) as a contiguous run in
 *     the output is an automatic block, regardless of the snippet's length or
 *     any window ratio. This is what catches a reproduced short catchphrase.
 *  2. ABSOLUTE VERBATIM RUN — any run of >= MAX_VERBATIM_RUN (8) consecutive
 *     output tokens that is a contiguous substring of some source snippet is a
 *     block, regardless of the ratio. This catches a 10–20 word verbatim
 *     sentence that a 200-word window would dilute below the ratio threshold
 *     (P2-4), and any long borrowed run that is not a whole snippet.
 *  3. WINDOWED n-GRAM RATIO — the historical check, but with an ADAPTIVE n:
 *     n = clamp(min(5, shortest source snippet length), 3, 5), so short
 *     protected spans still populate a non-empty source n-gram set. Slide a
 *     200-word window over the output; the report's overlap is the WORST
 *     (max) window — a single over-similar passage fails the whole section.
 *
 * `guardSection` runs the check, auto-rewrites ONCE against a de-duplication
 * instruction when a section is over the line, re-checks, and HARD-FAILS
 * (throws LicensedSimilarityError) if the rewrite is still over — the caller
 * must never emit text that trips this guard. An EMPTY source corpus makes the
 * pure math return 0 (nothing to compare); failing CLOSED for a licensed voice
 * with no material is the guard-wrapper's job (see pipelines/script/licensed-guard),
 * not this pure function's.
 */

export interface SimilarityOptions {
  /** n for the windowed n-gram overlap — the UPPER bound; the effective n is
   *  lowered adaptively toward `NGRAM_FLOOR` for short source snippets so the
   *  source n-gram set is never empty. Default 5 (spec). */
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

/**
 * Lower bound for the adaptive windowed n-gram size. Below this a shingle
 * carries too little signal to be meaningful; shorter reproductions are the
 * job of the exact-containment check, which has no length floor.
 */
export const NGRAM_FLOOR = 3;

/**
 * Any contiguous verbatim run of at least this many output tokens against the
 * source is an automatic block, whatever the window ratio (P2-4). Eight tokens
 * is well beyond incidental phrasing overlap yet short enough to catch a single
 * borrowed sentence that a 200-word window would dilute below the ratio limit.
 */
export const MAX_VERBATIM_RUN = 8;

export interface SimilarityReport {
  /** Worst single-window adaptive-n-gram overlap ratio in [0,1]. */
  maxOverlap: number;
  /** Number of windows evaluated. */
  windowCount: number;
  /** Word index the worst window started at (0 when not applicable). */
  worstWindowStart: number;
  /** n-grams the worst window shares with the source (short, for logging). */
  matchedNgrams: string[];
  /** True iff some source snippet appears verbatim (normalized) as a
   *  contiguous run in the output — an automatic block at any length. */
  exactContainment: boolean;
  /** Longest run of consecutive output tokens that is a contiguous substring
   *  of some source snippet. >= MAX_VERBATIM_RUN is an automatic block. */
  maxVerbatimRun: number;
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
  return buildTokenNgramSet(
    sources.map((s) => tokenizeWords(s)),
    n,
  );
}

/** As buildSourceNgramSet, but over already-tokenized snippets (no re-tokenize). */
function buildTokenNgramSet(sourceTokens: readonly string[][], n: number): Set<string> {
  const set = new Set<string>();
  for (const tokens of sourceTokens) {
    for (const gram of ngrams(tokens, n)) set.add(gram);
  }
  return set;
}

/**
 * The effective (adaptive) windowed n-gram size for a set of source snippets:
 * the requested n, lowered toward NGRAM_FLOOR by the SHORTEST snippet so short
 * protected spans still yield a non-empty n-gram set. Never below NGRAM_FLOOR
 * and never above the requested n.
 */
export function effectiveNgram(sourceTokens: readonly string[][], requestedN: number): number {
  if (sourceTokens.length === 0) return requestedN;
  const minTokens = Math.min(...sourceTokens.map((t) => t.length));
  return Math.max(NGRAM_FLOOR, Math.min(requestedN, minTokens));
}

/**
 * Longest run of consecutive `output` tokens that also occurs, contiguously, in
 * `source` — token-level longest common substring (a rolling two-row DP, O(N·M)
 * time, O(M) space). 0 when either side is empty.
 */
function longestCommonRun(output: readonly string[], source: readonly string[]): number {
  if (output.length === 0 || source.length === 0) return 0;
  let prev = new Array<number>(source.length + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= output.length; i++) {
    const cur = new Array<number>(source.length + 1).fill(0);
    for (let j = 1; j <= source.length; j++) {
      if (output[i - 1] === source[j - 1]) {
        const run = (prev[j - 1] ?? 0) + 1;
        cur[j] = run;
        if (run > best) best = run;
      }
    }
    prev = cur;
  }
  return best;
}

/**
 * Verbatim-reuse signals of `outputTokens` against the tokenized `sourceTokens`
 * snippets: whether any WHOLE snippet appears contiguously in the output
 * (exactContainment) and the longest contiguous borrowed run (maxVerbatimRun).
 */
function verbatimSignals(
  outputTokens: readonly string[],
  sourceTokens: readonly string[][],
): { exactContainment: boolean; maxVerbatimRun: number } {
  let exactContainment = false;
  let maxVerbatimRun = 0;
  for (const snippet of sourceTokens) {
    if (snippet.length === 0) continue;
    const run = longestCommonRun(outputTokens, snippet);
    if (run > maxVerbatimRun) maxVerbatimRun = run;
    if (run === snippet.length) exactContainment = true;
  }
  return { exactContainment, maxVerbatimRun };
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
 * Similarity of `output` against the licensed `sources` — the three checks
 * documented at the top of this file: exact containment, absolute verbatim run,
 * and the adaptive-n windowed ratio. Returns an all-zero report only when there
 * is genuinely nothing to compare (no non-empty source snippet); an empty
 * licensed corpus therefore cannot itself make this pure function fire, and
 * failing CLOSED for a licensed voice with no material is the guard-wrapper's
 * responsibility, not this function's.
 */
export function analyzeSimilarity(
  output: string,
  sources: readonly string[],
  options: Partial<SimilarityOptions> = {},
): SimilarityReport {
  const { ngram, windowWords, strideWords } = { ...DEFAULT_SIMILARITY_OPTIONS, ...options };
  const tokens = tokenizeWords(output);
  const sourceTokens = sources.map((s) => tokenizeWords(s)).filter((t) => t.length > 0);
  if (sourceTokens.length === 0) {
    return {
      maxOverlap: 0,
      windowCount: 0,
      worstWindowStart: 0,
      matchedNgrams: [],
      exactContainment: false,
      maxVerbatimRun: 0,
    };
  }

  // Checks 1 + 2 — verbatim containment / longest borrowed run. Independent of
  // the window ratio, so they catch short catchphrases (P1-1) and single
  // verbatim sentences a 200-word window would dilute (P2-4).
  const { exactContainment, maxVerbatimRun } = verbatimSignals(tokens, sourceTokens);

  // Check 3 — adaptive-n windowed ratio. n floored so short snippets still
  // populate a non-empty source set instead of no-op'ing to ratio 0.
  const n = effectiveNgram(sourceTokens, ngram);
  const sourceSet = buildTokenNgramSet(sourceTokens, n);
  let maxOverlap = 0;
  let worstWindowStart = 0;
  let matchedNgrams: string[] = [];
  if (sourceSet.size > 0 && tokens.length >= n) {
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
    for (const start of starts) {
      const windowTokens = tokens.slice(start, start + windowWords);
      const { overlap, matched } = windowOverlap(windowTokens, sourceSet, n);
      if (overlap > maxOverlap) {
        maxOverlap = overlap;
        worstWindowStart = start;
        matchedNgrams = matched.slice(0, 8);
      }
    }
    return {
      maxOverlap,
      windowCount: starts.length,
      worstWindowStart,
      matchedNgrams,
      exactContainment,
      maxVerbatimRun,
    };
  }
  return {
    maxOverlap,
    windowCount: 0,
    worstWindowStart,
    matchedNgrams,
    exactContainment,
    maxVerbatimRun,
  };
}

/**
 * Strict over-the-line test. A section is over the line when ANY check fires:
 *  - the windowed ratio is strictly ABOVE the threshold (spec: > 8%), OR
 *  - a whole source snippet is reproduced verbatim (exactContainment), OR
 *  - a verbatim run of >= MAX_VERBATIM_RUN tokens is borrowed, whatever the ratio.
 */
export function exceedsSimilarity(report: SimilarityReport, threshold: number): boolean {
  return (
    report.maxOverlap > threshold ||
    report.exactContainment ||
    report.maxVerbatimRun >= MAX_VERBATIM_RUN
  );
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
    const { after, threshold } = params;
    const max = (threshold * 100).toFixed(1);
    // Name the check that actually fired, so the message is never misleading
    // (a verbatim run can trip the guard while the window ratio is tiny).
    const reason = after.exactContainment
      ? `it reproduces a licensed phrase word-for-word`
      : after.maxVerbatimRun >= MAX_VERBATIM_RUN
        ? `it copies a run of ${String(after.maxVerbatimRun)} words verbatim from the licensed source`
        : `${(after.maxOverlap * 100).toFixed(1)}% of a 200-word window overlaps the licensed source (limit ${max}%)`;
    super(
      `Licensed-voice similarity guard: this section still reproduces the licensed ` +
        `source too closely after an automatic rewrite (${reason}). It was not ` +
        `published — edit the section to put the idea in your own words, or choose a ` +
        `different voice for it.`,
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
