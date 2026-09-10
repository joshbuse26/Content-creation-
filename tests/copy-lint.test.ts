import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import allowlistJson from "./copy-lint.allowlist.json";

/**
 * Wave C (C0): named-creator copy-lint (PRODUCT-CONTRACTS §7).
 *
 * Marketing/product copy may never claim to "sound (exactly) like" /
 * "write like" a named real creator, or to write "in <Name>'s voice",
 * unless that creator's partner flag is on (FEATURE_PARTNERED_NAMED plus a
 * signed license — and then only via the partnerAllowlist). This test
 * scans app/(marketing)/** and components/** sources for a CONSERVATIVE
 * pattern set; reviewed false positives go in tests/copy-lint.allowlist.json
 * (exact matched substrings), so archetype names and ordinary copy never
 * trip it.
 */

const ROOT = join(__dirname, "..");
const SCAN_DIRS = [join(ROOT, "app", "(marketing)"), join(ROOT, "components")];
const EXTENSIONS = [".ts", ".tsx"];

/**
 * Conservative named-creator claim patterns. "<ProperNoun>" is approximated
 * as a capitalized word (optionally two, e.g. a first + last name). Kept
 * high-precision on purpose: generic phrases ("sounds like a pro", "sounds
 * like you") never match because "a"/"you"/"the" are lowercase.
 */
const PATTERNS: readonly RegExp[] = [
  /\bsounds?\s+exactly\s+like\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?/g,
  /\bsounds?\s+like\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?/g,
  /\bwrites?\s+like\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?/g,
  /\bwrite\s+like\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?/g,
  /\bin\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?(?:'|’)s\s+voice\b/g,
  /\bjust\s+like\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?\s+(?:writes|scripts|talks)\b/g,
];

interface AllowlistFile {
  allowlist: string[];
  partnerAllowlist: string[];
}

const { allowlist, partnerAllowlist } = allowlistJson as AllowlistFile;
const partnerFlagOn = process.env.FEATURE_PARTNERED_NAMED === "true";

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(full));
    else if (EXTENSIONS.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
  return out;
}

interface Violation {
  file: string;
  match: string;
}

function scan(): Violation[] {
  const violations: Violation[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of listSourceFiles(dir)) {
      const content = readFileSync(file, "utf8");
      for (const pattern of PATTERNS) {
        pattern.lastIndex = 0;
        for (const match of content.matchAll(pattern)) {
          const text = match[0];
          if (allowlist.includes(text)) continue;
          if (partnerFlagOn && partnerAllowlist.includes(text)) continue;
          violations.push({ file: file.slice(ROOT.length + 1), match: text });
        }
      }
    }
  }
  return violations;
}

describe("named-creator copy-lint (marketing + UI strings)", () => {
  it("finds no named-creator sound-alike claims outside the allowlists", () => {
    const violations = scan();
    expect(
      violations,
      `Named-creator claim copy found (PRODUCT-CONTRACTS §7). Either rewrite the copy or, for a REVIEWED false positive, add the exact matched string to tests/copy-lint.allowlist.json:\n${violations
        .map((v) => `  ${v.file}: "${v.match}"`)
        .join("\n")}`,
    ).toEqual([]);
  });

  it("the pattern set catches the canonical bad phrases", () => {
    const bad = [
      "Scripts that sound exactly like SomeFamous Person",
      "sounds like Creatorname on their best day",
      "write like Famousguy",
      "in Famousperson's voice",
      "in Famousperson’s voice",
    ];
    for (const text of bad) {
      expect(
        PATTERNS.some((p) => {
          p.lastIndex = 0;
          return p.test(text);
        }),
        `expected a pattern to catch: ${text}`,
      ).toBe(true);
    }
  });

  it("the pattern set ignores ordinary generic copy (no false positives)", () => {
    const fine = [
      "scripts that sound like you, on your best day",
      "sounds like a real person wrote it",
      "write like a professional",
      "find your voice in minutes",
      "in your channel's voice",
    ];
    for (const text of fine) {
      expect(
        PATTERNS.some((p) => {
          p.lastIndex = 0;
          return p.test(text);
        }),
        `expected no pattern to catch: ${text}`,
      ).toBe(false);
    }
  });
});
