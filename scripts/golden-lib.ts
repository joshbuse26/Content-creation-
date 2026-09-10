import { z } from "zod";
import { archetypeIdSchema } from "@/lib/types/enums";
import { crossoverBlendSchema } from "@/lib/types/entities";
import type { StyleGateReport } from "@/lib/types/pipeline";

/**
 * Golden-loop v2 shared pieces (PRODUCT-CONTRACTS §6) — brief schema, sheet
 * rendering, and the `--compare` machinery. Kept apart from the runner so
 * tests can exercise the pure parts (column rendering, table parsing, diff
 * math) without executing pipelines.
 */

// ---------------------------------------------------------------------------
// Briefs
// ---------------------------------------------------------------------------

export const goldenBriefSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    researchQuery: z.string().min(3),
    targetMinutes: z.number().int().min(2).max(60).default(10),
    /** Archetype for the staged path; omit BOTH mode fields for the legacy flow. */
    archetypeId: archetypeIdSchema.nullable().default(null),
    /** Crossover blend for the staged path (mutually exclusive with archetypeId). */
    crossover: crossoverBlendSchema.nullable().default(null),
  })
  .refine((b) => b.archetypeId === null || b.crossover === null, {
    message: "a brief carries archetypeId OR crossover, not both",
  });
export type GoldenBrief = z.infer<typeof goldenBriefSchema>;
export const goldenBriefsSchema = z.array(goldenBriefSchema).min(1);

/** Human-readable mode cell for the sheet. */
export function briefModeLabel(brief: GoldenBrief): string {
  if (brief.archetypeId !== null) return brief.archetypeId;
  if (brief.crossover !== null) {
    const { a, b, weightA } = brief.crossover;
    return `${a}×${b} (${String(weightA)})`;
  }
  return "legacy";
}

// ---------------------------------------------------------------------------
// Results + sheet rendering
// ---------------------------------------------------------------------------

export interface GoldenBriefResult {
  id: string;
  title: string;
  mode: string;
  hookStyle: string;
  hook: string;
  words: number;
  runtimeSeconds: number;
  gatePassed: boolean;
  autoFixed: boolean;
  /** Per-gate style columns from the frozen styleGateReportSchema; null = no card. */
  styleGates: StyleGateReport | null;
  flags: string[];
  topTitles: { text: string; family: string; score: number }[];
  wallClockMs: number;
  error: string | null;
}

/** pass / FAIL / n/e (typed null = not evaluated yet) / - (no card or failed run). */
export function gateCell(value: boolean | null | undefined): string {
  if (value === undefined) return "-";
  if (value === null) return "n/e";
  return value ? "pass" : "FAIL";
}

function fmtRuntime(seconds: number): string {
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`;
}

function cell(text: string): string {
  return text.replaceAll("|", "/").replaceAll("\n", " ");
}

/** The gate columns the compare flag diffs, in sheet order. */
export const GATE_COLUMNS = ["Gate", "HookPat", "CTA", "ReadLvl", "Claims"] as const;
export type GateColumn = (typeof GATE_COLUMNS)[number];

export function renderSheet(
  results: GoldenBriefResult[],
  meta: { providers: string; promptVersion: string },
): string {
  const lines: string[] = [
    `# Golden-set scoring sheet`,
    "",
    `- Date: ${new Date().toISOString()}`,
    `- Providers: ${meta.providers} · Prompt version: ${meta.promptVersion}`,
    `- Scoring: 1 = unusable · 2 = heavy rewrite · 3 = usable with edits · 4 = light edits · 5 = shoot it as-is`,
    `- Style gate columns (frozen styleGateReportSchema): HookPat = hook technique ∈ card.hookPatterns · CTA = placement matches ctaHabits · ReadLvl = reading grade in the card's band · Claims = bannedClaims scan. n/e = typed but not evaluated yet (C1 fills hookPattern/readingLevel); - = no style card in play.`,
    "",
    `| Brief | Mode | Hook (style) | Words | Runtime | Gate | HookPat | CTA | ReadLvl | Claims | Flags | Wall clock | Score (1-5) |`,
    `|---|---|---|---|---|---|---|---|---|---|---|---|---|`,
  ];
  for (const r of results) {
    const failed = r.error !== null;
    const hookCell = failed
      ? `FAILED: ${cell(r.error ?? "").slice(0, 60)}`
      : `${cell(r.hook).slice(0, 70)}… (${r.hookStyle})`;
    const gate = failed
      ? "-"
      : `${r.gatePassed ? "pass" : "FAIL"}${r.autoFixed ? " (auto-fixed)" : ""}`;
    const sg = failed ? null : r.styleGates;
    const styleCells = failed
      ? ["-", "-", "-", "-"]
      : [
          gateCell(sg === null ? undefined : sg.hookPatternOk),
          gateCell(sg === null ? undefined : sg.ctaPlacementOk),
          gateCell(sg === null ? undefined : sg.readingLevelOk),
          gateCell(sg === null ? undefined : sg.bannedClaimsOk),
        ];
    const flags =
      r.flags.length === 0
        ? "none"
        : r.flags
            .map((f) => cell(f))
            .join("; ")
            .slice(0, 80);
    lines.push(
      `| ${r.id} | ${cell(r.mode)} | ${hookCell} | ${String(r.words)} | ${fmtRuntime(r.runtimeSeconds)} | ${gate} | ${styleCells.join(" | ")} | ${flags} | ${(r.wallClockMs / 1000).toFixed(1)}s |  |`,
    );
  }
  lines.push("", "---", "");
  for (const r of results) {
    lines.push(`## ${r.id} — ${r.title}`, "");
    if (r.error !== null) {
      lines.push(`**Run failed:** ${r.error}`, "");
      continue;
    }
    lines.push(
      `**Mode:** ${r.mode}`,
      "",
      `**Hook (${r.hookStyle}):**`,
      "",
      `> ${r.hook}`,
      "",
      "**Top titles:**",
      "",
    );
    for (const t of r.topTitles) {
      lines.push(`- [${String(t.score)}] ${t.text} _(${t.family})_`);
    }
    if (r.styleGates !== null) {
      lines.push(
        "",
        "**Style gates:**",
        "",
        `- hookPattern: ${gateCell(r.styleGates.hookPatternOk)}`,
        `- ctaPlacement: ${gateCell(r.styleGates.ctaPlacementOk)} (${String(r.styleGates.ctaCount)} CTA${r.styleGates.ctaCount === 1 ? "" : "s"})`,
        `- readingLevel: ${gateCell(r.styleGates.readingLevelOk)}${r.styleGates.readingGrade === null ? "" : ` (grade ${String(r.styleGates.readingGrade)})`}`,
        `- bannedClaims: ${gateCell(r.styleGates.bannedClaimsOk)}${r.styleGates.bannedClaimHits.length === 0 ? "" : ` — ${String(r.styleGates.bannedClaimHits.length)} hit(s)`}`,
        ...r.styleGates.notes.map((n) => `  - ${n}`),
      );
    }
    if (r.flags.length > 0) {
      lines.push("", "**Flags:**", "", ...r.flags.map((f) => `- ${f}`));
    }
    lines.push("", "**Notes / score:**", "", "_(write here)_", "");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// --compare: parse the machine-written table, diff gate pass-rates
// ---------------------------------------------------------------------------

/**
 * Parse the scoring table this script wrote (possibly prettier-reformatted:
 * padded cells are tolerated). NO fancy parsing: the first markdown table
 * whose header row contains a `Brief` column is the one, rows run until the
 * first non-`|` line.
 */
export function parseScoringTable(markdown: string): Record<string, string>[] {
  const lines = markdown.split("\n");
  const splitRow = (line: string): string[] =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
  const headerIndex = lines.findIndex((line) => {
    const t = line.trim();
    return t.startsWith("|") && splitRow(t).includes("Brief");
  });
  if (headerIndex === -1) return [];
  const header = splitRow(lines[headerIndex] ?? "");
  const rows: Record<string, string>[] = [];
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const t = (lines[i] ?? "").trim();
    if (!t.startsWith("|")) break;
    const cells = splitRow(t);
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue; // separator row
    const row: Record<string, string> = {};
    header.forEach((name, col) => {
      row[name] = cells[col] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

export interface GatePassRate {
  pass: number;
  fail: number;
  /** pass / (pass + fail); null when the column has no evaluated cells. */
  rate: number | null;
}

/** "pass"/"pass (auto-fixed)" count as pass, "FAIL…" as fail; "-"/"n/e" are skipped. */
export function computeGatePassRates(
  rows: Record<string, string>[],
): Record<GateColumn, GatePassRate> {
  const out = {} as Record<GateColumn, GatePassRate>;
  for (const column of GATE_COLUMNS) {
    let pass = 0;
    let fail = 0;
    for (const row of rows) {
      const value = row[column];
      if (value === undefined) continue;
      if (value.startsWith("pass")) pass++;
      else if (value.startsWith("FAIL")) fail++;
    }
    out[column] = { pass, fail, rate: pass + fail === 0 ? null : pass / (pass + fail) };
  }
  return out;
}

function fmtRate(r: GatePassRate): string {
  if (r.rate === null) return "n/a";
  return `${(r.rate * 100).toFixed(0)}% (${String(r.pass)}/${String(r.pass + r.fail)})`;
}

/** Render the pass-rate diff section for `--compare <baseline.md>`. */
export function renderCompareSection(
  baselinePath: string,
  baseline: Record<GateColumn, GatePassRate>,
  current: Record<GateColumn, GatePassRate>,
): string {
  const lines = [
    `## Gate pass-rate compare — vs ${baselinePath}`,
    "",
    "| Gate | Baseline | Current | Δ (pp) |",
    "|---|---|---|---|",
  ];
  for (const column of GATE_COLUMNS) {
    const b = baseline[column];
    const c = current[column];
    const delta =
      b.rate === null || c.rate === null
        ? "-"
        : `${c.rate - b.rate >= 0 ? "+" : ""}${((c.rate - b.rate) * 100).toFixed(1)}`;
    lines.push(`| ${column} | ${fmtRate(b)} | ${fmtRate(c)} | ${delta} |`);
  }
  return lines.join("\n");
}
