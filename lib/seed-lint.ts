/**
 * Named-creator guard (PRODUCT-CONTRACTS §2/§7) — the runtime twin of the
 * build-time seed-lint test (tests/c3-seed-lint.test.ts).
 *
 * Wave D2 reuses it: a competitor-remix trained card must carry NO real
 * person's name (WAVE-D-PLAN §2c). The derivation runs the derived name +
 * card text through `scanForRealCreatorName` before persisting, and drops a
 * derived voice NAME back to a generic default when it looks like a real
 * person's name. This is pure and dependency-free so the derivation, the
 * test, and any future caller share ONE denylist + heuristic.
 *
 * Two checks (same shape the test enforces):
 *   1. A short denylist of obviously-famous creator names/handles — a hit is
 *      always a violation (no allowlist applies).
 *   2. A conservative "Firstname Lastname"-shaped heuristic; common
 *      title-case headline words are filtered so ordinary copy never trips.
 */

/**
 * Obviously-famous creator names/handles — must NEVER appear in a derived
 * card. Matched on word boundaries, case-insensitively. Kept short and
 * unambiguous on purpose; mirrors FAMOUS_CREATOR_DENYLIST in the seed-lint
 * test (both draw the same conservative line).
 */
export const FAMOUS_CREATOR_DENYLIST: readonly string[] = [
  "mrbeast",
  "mr beast",
  "pewdiepie",
  "mkbhd",
  "marques brownlee",
  "casey neistat",
  "emma chamberlain",
  "logan paul",
  "jake paul",
  "markiplier",
  "jacksepticeye",
  "veritasium",
  "mrwhosetheboss",
  "ryan trahan",
  "dude perfect",
  "airrack",
];

const DENYLIST_PATTERNS = FAMOUS_CREATOR_DENYLIST.map(
  (name) => new RegExp(`\\b${name.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"),
);

/**
 * Common capitalized English words that start title-case phrases — a pair
 * containing one of these is headline casing, not a person's name.
 */
const COMMON_WORDS = new Set([
  "the",
  "that",
  "this",
  "these",
  "those",
  "you",
  "your",
  "what",
  "where",
  "when",
  "why",
  "who",
  "how",
  "one",
  "two",
  "three",
  "never",
  "always",
  "only",
  "every",
  "everyone",
  "nobody",
  "stop",
  "get",
  "got",
  "see",
  "was",
  "were",
  "tell",
  "with",
  "without",
  "until",
  "about",
  "again",
  "don",
  "remixed",
  "voice",
  "channel",
  "trained",
]);

/** "Firstname Lastname"-shaped pairs (both words ≥3 letters, capitalized). */
const NAME_PATTERN = new RegExp("\\b[A-Z][a-z]{2,}[ \\u00A0]+[A-Z][a-z]{2,}\\b", "g");

export interface SeedLintHit {
  kind: "denylist" | "name-shape";
  match: string;
}

/** Denylist scan — every hit is a violation, no allowlist applies. */
export function scanDenylist(text: string): SeedLintHit[] {
  const hits: SeedLintHit[] = [];
  for (const pattern of DENYLIST_PATTERNS) {
    const match = pattern.exec(text);
    if (match !== null) hits.push({ kind: "denylist", match: match[0] });
  }
  return hits;
}

/** Name-heuristic scan — candidates not filtered by COMMON_WORDS. */
export function scanNameCandidates(text: string): SeedLintHit[] {
  const hits: SeedLintHit[] = [];
  NAME_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(NAME_PATTERN)) {
    const words = match[0].split(new RegExp("[ \\u00A0]+"));
    if (words.some((w) => COMMON_WORDS.has(w.toLowerCase()))) continue;
    hits.push({ kind: "name-shape", match: match[0] });
  }
  return hits;
}

/**
 * All real-creator-name hits (denylist + name-shape) in `text`. Empty ⇒ the
 * text carries no name that looks like a real person's.
 */
export function scanForRealCreatorName(text: string): SeedLintHit[] {
  return [...scanDenylist(text), ...scanNameCandidates(text)];
}

/** True iff `text` contains a denylisted or name-shaped real-person reference. */
export function containsRealCreatorName(text: string): boolean {
  return scanForRealCreatorName(text).length > 0;
}
