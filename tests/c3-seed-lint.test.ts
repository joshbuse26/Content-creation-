import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ARCHETYPE_SEEDS } from "@/lib/archetypes";
import allowlistJson from "./seed-lint.allowlist.json";

/**
 * Wave C3 guardrail: seed-data lint (PRODUCT-CONTRACTS §2/§7).
 *
 * Archetype seeds and fixture content are GENERIC original craft — no real
 * creator's name, catchphrase, or signature wording anywhere. This test
 * enforces the machine-checkable slice of that:
 *
 *  1. A small denylist of obviously-famous creator names/handles must never
 *     appear in seed or fixture text (case-insensitive, word-boundary).
 *  2. A conservative capitalized-multi-word-name heuristic flags anything
 *     that LOOKS like "Firstname Lastname"; reviewed false positives
 *     (fictional personas, title-case phrases, archetype display names) go
 *     in tests/seed-lint.allowlist.json — a real person's name may never be
 *     allowlisted.
 *  3. exampleSnippets stay ≤ 400 chars — snippets are original and SHORT,
 *     never long enough to be a pasted passage of anyone's work.
 */

const ROOT = join(__dirname, "..");

/** Fixture-content files scanned as raw text alongside the structured seeds. */
const FIXTURE_CONTENT_FILES = [
  join(ROOT, "lib", "fixtures", "index.ts"),
  join(ROOT, "lib", "fixtures", "demo.ts"),
  join(ROOT, "pipelines", "script", "fixture-content.ts"),
  join(ROOT, "scripts", "seed.ts"),
];

/**
 * Obviously-famous creator names/handles (denylist — must NEVER appear in
 * seed/fixture text). Deliberately short and unambiguous; matched on word
 * boundaries, case-insensitively.
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
 * Common capitalized English words that start title-case headline phrases —
 * a pair containing one of these is headline casing, not a person's name.
 * Keeps the heuristic conservative WITHOUT allowlisting every headline.
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
]);

/** "Firstname Lastname"-shaped pairs (both words ≥3 letters, capitalized). */
const NAME_PATTERN = new RegExp("\\b[A-Z][a-z]{2,}[ \\u00A0]+[A-Z][a-z]{2,}\\b", "g");

export interface SeedLintHit {
  source: string;
  match: string;
}

/** Denylist scan — every hit is a violation, no allowlist applies. */
export function scanDenylist(source: string, text: string): SeedLintHit[] {
  const hits: SeedLintHit[] = [];
  for (const pattern of DENYLIST_PATTERNS) {
    const match = pattern.exec(text);
    if (match !== null) hits.push({ source, match: match[0] });
  }
  return hits;
}

/** Name-heuristic scan — candidates not filtered by COMMON_WORDS. */
export function scanNameCandidates(source: string, text: string): SeedLintHit[] {
  const hits: SeedLintHit[] = [];
  NAME_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(NAME_PATTERN)) {
    const words = match[0].split(new RegExp("[ \\u00A0]+"));
    if (words.some((w) => COMMON_WORDS.has(w.toLowerCase()))) continue;
    hits.push({ source, match: match[0] });
  }
  return hits;
}

/** All string values inside a seed object, recursively. */
export function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value !== null && typeof value === "object") {
    return Object.values(value).flatMap(collectStrings);
  }
  return [];
}

interface AllowlistFile {
  allowlist: string[];
}

const { allowlist } = allowlistJson as AllowlistFile;

function scanSources(): { texts: { source: string; text: string }[] } {
  const texts = [
    ...ARCHETYPE_SEEDS.map((seed) => ({
      source: `lib/archetypes.ts#${seed.id}`,
      text: collectStrings(seed).join("\n"),
    })),
    ...FIXTURE_CONTENT_FILES.map((file) => ({
      source: file.slice(ROOT.length + 1),
      text: readFileSync(file, "utf8"),
    })),
  ];
  return { texts };
}

describe("seed-data lint: no real-person proper names in seeds/fixtures", () => {
  it("no famous-creator denylist hit anywhere (no allowlist applies)", () => {
    const violations = scanSources().texts.flatMap(({ source, text }) =>
      scanDenylist(source, text),
    );
    expect(
      violations,
      `Famous-creator reference in seed/fixture data (PRODUCT-CONTRACTS §2/§7) — rewrite it, never allowlist it:\n${violations
        .map((v) => `  ${v.source}: "${v.match}"`)
        .join("\n")}`,
    ).toEqual([]);
  });

  it("every name-shaped string is a reviewed false positive in the allowlist", () => {
    const violations = scanSources()
      .texts.flatMap(({ source, text }) => scanNameCandidates(source, text))
      .filter((v) => !allowlist.includes(v.match));
    expect(
      violations,
      `Name-shaped string in seed/fixture data. If it is a REAL person, rewrite it; if it is a reviewed false positive (fictional persona, title-case phrase), add the exact string to tests/seed-lint.allowlist.json:\n${violations
        .map((v) => `  ${v.source}: "${v.match}"`)
        .join("\n")}`,
    ).toEqual([]);
  });

  it("allowlist entries never contain denylisted creators", () => {
    for (const entry of allowlist) {
      expect(scanDenylist("allowlist", entry)).toEqual([]);
    }
  });
});

describe("seed-data lint: exampleSnippets stay original-short (≤ 400 chars)", () => {
  it("every archetype snippet is at most 400 characters", () => {
    for (const seed of ARCHETYPE_SEEDS) {
      for (const [i, snippet] of seed.styleCard.exampleSnippets.entries()) {
        expect(
          snippet.length,
          `${seed.id} exampleSnippets[${String(i)}] is ${String(snippet.length)} chars (max 400 — snippets are original and short, never pasted passages)`,
        ).toBeLessThanOrEqual(400);
      }
    }
  });
});

describe("seed-data lint: scanner self-test", () => {
  it("positive: catches a denylisted creator and a name-shaped string", () => {
    expect(scanDenylist("t", "shot in the style of MrBeast challenges")).toHaveLength(1);
    expect(scanDenylist("t", "Casey Neistat energy")).toHaveLength(1);
    expect(scanNameCandidates("t", "as told by Famous Person yesterday")).toEqual([
      { source: "t", match: "Famous Person" },
    ]);
  });

  it("negative: ignores lowercase prose, headline casing, and short particles", () => {
    expect(scanDenylist("t", "a casey from accounting; beastly workloads")).toEqual([]);
    expect(scanNameCandidates("t", "The Truth About Espresso")).toEqual([]); // common-word pair
    expect(scanNameCandidates("t", "Hands-On Builder")).toEqual([]); // 'On' too short
    expect(scanNameCandidates("t", "plain lowercase sentence with no names")).toEqual([]);
  });

  it("collectStrings walks nested seed objects", () => {
    expect(collectStrings({ a: "x", b: ["y", { c: "z", n: 3 }] }).sort()).toEqual(["x", "y", "z"]);
  });
});
