import { describe, expect, it } from "vitest";
import { styleGateReportSchema } from "@/lib/types/pipeline";
import {
  briefModeLabel,
  computeGatePassRates,
  gateCell,
  GATE_COLUMNS,
  goldenBriefSchema,
  parseScoringTable,
  renderCompareSection,
  renderSheet,
  type GoldenBriefResult,
} from "../scripts/golden-lib";

/**
 * Wave C3: golden loop v2 — scoring-sheet gate columns and the --compare
 * diff math (PRODUCT-CONTRACTS §6).
 */

function result(over: Partial<GoldenBriefResult>): GoldenBriefResult {
  return {
    id: "brief-a",
    title: "Brief A",
    mode: "calm-explainer",
    hookStyle: "open_loop",
    hook: "A hook that runs long enough to be truncated in the table cell of the sheet.",
    words: 1500,
    runtimeSeconds: 600,
    gatePassed: true,
    autoFixed: false,
    styleGates: null,
    flags: [],
    topTitles: [{ text: "Title", family: "curiosity_gap", score: 80 }],
    wallClockMs: 120,
    error: null,
    ...over,
  };
}

const fullGates = styleGateReportSchema.parse({
  hookPatternOk: true,
  ctaPlacementOk: false,
  ctaCount: 2,
  readingGrade: 8.2,
  readingLevelOk: null,
  bannedClaimHits: [],
  bannedClaimsOk: true,
  notes: ["Card requires end-only CTAs, but a CTA appears before the last chapter."],
});

describe("scoring sheet gate columns", () => {
  it("renders one column per frozen style gate plus mechanics and the human 1-5 column", () => {
    const sheet = renderSheet([result({ styleGates: fullGates })], {
      providers: "fixture",
      promptVersion: "test-v1",
    });
    const [row] = parseScoringTable(sheet);
    if (row === undefined) throw new Error("no table row rendered");
    expect(row["Brief"]).toBe("brief-a");
    expect(row["Mode"]).toBe("calm-explainer");
    expect(row["Gate"]).toBe("pass");
    expect(row["HookPat"]).toBe("pass");
    expect(row["CTA"]).toBe("FAIL");
    expect(row["ReadLvl"]).toBe("n/e"); // typed null = not evaluated, never a pass
    expect(row["Claims"]).toBe("pass");
    expect(row["Score (1-5)"]).toBe(""); // blank human column
  });

  it("no style card renders '-' cells; a failed run dashes everything", () => {
    const sheet = renderSheet(
      [result({ styleGates: null }), result({ id: "brief-b", error: "research exploded" })],
      { providers: "fixture", promptVersion: "test-v1" },
    );
    const rows = parseScoringTable(sheet);
    expect(rows[0]?.["HookPat"]).toBe("-");
    expect(rows[0]?.["Claims"]).toBe("-");
    expect(rows[1]?.["Gate"]).toBe("-");
    expect(rows[1]?.["Hook (style)"]).toContain("FAILED: research exploded");
  });

  it("gateCell maps the tri-state exactly", () => {
    expect(gateCell(true)).toBe("pass");
    expect(gateCell(false)).toBe("FAIL");
    expect(gateCell(null)).toBe("n/e");
    expect(gateCell(undefined)).toBe("-");
  });

  it("parses its own table back even after prettier-style cell padding", () => {
    const sheet = renderSheet([result({ styleGates: fullGates })], {
      providers: "fixture",
      promptVersion: "test-v1",
    });
    // Simulate prettier's table alignment: pad every cell to a fixed width.
    const padded = sheet
      .split("\n")
      .map((line) =>
        line.startsWith("|")
          ? line
              .split("|")
              .map((c) => (c === "" ? c : ` ${c.trim().padEnd(20)} `))
              .join("|")
          : line,
      )
      .join("\n");
    const rows = parseScoringTable(padded);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["CTA"]).toBe("FAIL");
  });
});

describe("--compare diff math", () => {
  const sheetOf = (results: GoldenBriefResult[]) =>
    renderSheet(results, { providers: "fixture", promptVersion: "test-v1" });

  it("computes per-gate pass rates, skipping '-' and 'n/e' cells", () => {
    const rates = computeGatePassRates(
      parseScoringTable(
        sheetOf([
          result({ styleGates: fullGates }),
          result({ id: "b", styleGates: { ...fullGates, ctaPlacementOk: true } }),
          result({ id: "c", styleGates: null }),
        ]),
      ),
    );
    expect(rates.Gate).toEqual({ pass: 3, fail: 0, rate: 1 });
    expect(rates.HookPat).toEqual({ pass: 2, fail: 0, rate: 1 });
    expect(rates.CTA).toEqual({ pass: 1, fail: 1, rate: 0.5 });
    expect(rates.ReadLvl).toEqual({ pass: 0, fail: 0, rate: null }); // all n/e
  });

  it("counts 'pass (auto-fixed)' as pass and 'FAIL …' as fail", () => {
    const rates = computeGatePassRates([
      { Gate: "pass (auto-fixed)" },
      { Gate: "FAIL" },
      { Gate: "-" },
    ]);
    expect(rates.Gate).toEqual({ pass: 1, fail: 1, rate: 0.5 });
  });

  it("renders the delta in percentage points, n/a for unevaluated columns", () => {
    const baseline = computeGatePassRates([{ Gate: "pass" }, { Gate: "pass" }]);
    const current = computeGatePassRates([{ Gate: "pass" }, { Gate: "FAIL" }]);
    const section = renderCompareSection("docs/golden-baseline.md", baseline, current);
    expect(section).toContain("## Gate pass-rate compare — vs docs/golden-baseline.md");
    expect(section).toContain("| Gate | 100% (2/2) | 50% (1/2) | -50.0 |");
    // Columns absent from the baseline sheet diff as n/a with a dashed delta.
    expect(section).toContain("| HookPat | n/a | n/a | - |");
    for (const column of GATE_COLUMNS) expect(section).toContain(`| ${column} |`);
  });

  it("an old-format baseline (no style columns) still parses for its Gate column", () => {
    const old = [
      "# Golden-set scoring sheet",
      "",
      "| Brief             | Hook (style) | Words | Runtime | Gate | Flags | Wall clock | Score (1-5) |",
      "| ----------------- | ------------ | ----- | ------- | ---- | ----- | ---------- | ----------- |",
      "| budget-espresso   | h… (x)       | 1849  | 12:20   | pass | none  | 0.1s       |             |",
      "| learn-piano-adult | h… (x)       | 1542  | 10:17   | FAIL | none  | 0.0s       |             |",
      "",
    ].join("\n");
    const rates = computeGatePassRates(parseScoringTable(old));
    expect(rates.Gate).toEqual({ pass: 1, fail: 1, rate: 0.5 });
    expect(rates.CTA.rate).toBeNull();
  });
});

describe("golden brief schema", () => {
  it("accepts archetype, crossover, and legacy briefs; rejects both at once", () => {
    const base = { id: "x", title: "T", researchQuery: "some query" };
    expect(goldenBriefSchema.parse({ ...base, archetypeId: "calm-explainer" }).archetypeId).toBe(
      "calm-explainer",
    );
    const cross = goldenBriefSchema.parse({
      ...base,
      crossover: { a: "hype-gamer", b: "calm-explainer", weightA: 0.3 },
    });
    expect(briefModeLabel(cross)).toBe("hype-gamer×calm-explainer (0.3)");
    expect(briefModeLabel(goldenBriefSchema.parse(base))).toBe("legacy");
    expect(() =>
      goldenBriefSchema.parse({
        ...base,
        archetypeId: "calm-explainer",
        crossover: { a: "hype-gamer", b: "calm-explainer", weightA: 0.3 },
      }),
    ).toThrow(/not both/);
  });

  it("rejects unknown archetype ids", () => {
    expect(() =>
      goldenBriefSchema.parse({
        id: "x",
        title: "T",
        researchQuery: "some query",
        archetypeId: "not-an-archetype",
      }),
    ).toThrow();
  });
});
