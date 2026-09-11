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
  grokXaiAllowlist: string[];
}

const { allowlist, partnerAllowlist, grokXaiAllowlist } = allowlistJson as AllowlistFile;
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

/**
 * Wave D (D0, WAVE-D-PLAN §4): the underlying LLM is Grok-only, but the UI
 * NEVER names it — the chat persona is product-native ("Coach"). This rule
 * fails on user-facing occurrences of "Grok"/"xAI" (case-insensitive) inside
 * STRING LITERALS in app/** and components/**. Comments and identifiers are
 * excluded (a variable named `grokClient` or a `// grok` note is fine); only
 * text that can render to a user counts. Legitimate non-UI literals go in
 * tests/copy-lint.allowlist.json → grokXaiAllowlist.
 */

const GROK_XAI_SCAN_DIRS = [join(ROOT, "app"), join(ROOT, "components")];
const GROK_XAI_PATTERN = /grok|xai/i;

/**
 * Extract every string-literal value from TS/TSX source, skipping comments.
 * A small char-walk state machine: it tracks single/double/backtick strings
 * (honoring escapes) and line/block comments, and returns only the contents
 * of string literals — so a match in a comment or an identifier never trips.
 */
function extractStringLiterals(src: string): string[] {
  const out: string[] = [];
  type Mode = "code" | "line" | "block" | "sq" | "dq" | "tpl";
  let mode: Mode = "code";
  let buf = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === undefined) break;
    const c2 = src[i + 1];
    if (mode === "code") {
      if (c === "/" && c2 === "/") {
        mode = "line";
        i += 2;
        continue;
      }
      if (c === "/" && c2 === "*") {
        mode = "block";
        i += 2;
        continue;
      }
      if (c === "'") {
        mode = "sq";
        buf = "";
        i += 1;
        continue;
      }
      if (c === '"') {
        mode = "dq";
        buf = "";
        i += 1;
        continue;
      }
      if (c === "`") {
        mode = "tpl";
        buf = "";
        i += 1;
        continue;
      }
      i += 1;
      continue;
    }
    if (mode === "line") {
      if (c === "\n") mode = "code";
      i += 1;
      continue;
    }
    if (mode === "block") {
      if (c === "*" && c2 === "/") {
        mode = "code";
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    // String modes (sq/dq/tpl).
    if (c === "\\") {
      buf += c + (c2 ?? "");
      i += 2;
      continue;
    }
    const closer = mode === "sq" ? "'" : mode === "dq" ? '"' : "`";
    if (c === closer) {
      out.push(buf);
      mode = "code";
      i += 1;
      continue;
    }
    buf += c;
    i += 1;
  }
  return out;
}

function scanGrokXai(): Violation[] {
  const violations: Violation[] = [];
  for (const dir of GROK_XAI_SCAN_DIRS) {
    for (const file of listSourceFiles(dir)) {
      const content = readFileSync(file, "utf8");
      for (const literal of extractStringLiterals(content)) {
        if (!GROK_XAI_PATTERN.test(literal)) continue;
        if (grokXaiAllowlist.includes(literal)) continue;
        violations.push({ file: file.slice(ROOT.length + 1), match: literal });
      }
    }
  }
  return violations;
}

describe("no-Grok/xAI-in-UI copy-lint (app + components string literals)", () => {
  it("finds no user-facing Grok/xAI mentions outside the allowlist", () => {
    const violations = scanGrokXai();
    expect(
      violations,
      `User-facing "Grok"/"xAI" found (WAVE-D-PLAN §4 — the UI never names the LLM; the chat persona is "Coach"). Rewrite the copy, or for a REVIEWED non-UI literal add the exact string to tests/copy-lint.allowlist.json → grokXaiAllowlist:\n${violations
        .map((v) => `  ${v.file}: ${JSON.stringify(v.match)}`)
        .join("\n")}`,
    ).toEqual([]);
  });

  it("extracts string literals and skips comments + identifiers", () => {
    const src = [
      'const label = "Powered by Grok";',
      "// this grok comment is ignored",
      "/* and this xAI block comment too */",
      "const grokClient = makeClient();",
      "const ok = `Ask the Coach anything`;",
    ].join("\n");
    const literals = extractStringLiterals(src);
    const flagged = literals.filter((l) => GROK_XAI_PATTERN.test(l));
    expect(flagged).toEqual(["Powered by Grok"]);
  });

  it("the rule is case-insensitive and catches both terms in literals", () => {
    for (const bad of ['"built on GROK"', "'xai inside'", "`Grok-4 powers this`"]) {
      const literals = extractStringLiterals(bad);
      expect(literals.some((l) => GROK_XAI_PATTERN.test(l))).toBe(true);
    }
  });
});
