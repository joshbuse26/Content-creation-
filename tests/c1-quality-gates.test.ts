import { describe, expect, it } from "vitest";
import { fixtureVoiceProfile } from "@/lib/fixtures";
import type { StyleCard } from "@/lib/types/entities";
import { computeQualityReport, gateViolations } from "@/pipelines/script/quality-gate";
import { fleschKincaidGrade, fleschReadingEase } from "@/pipelines/script/readability";

/**
 * C1: the style-aware quality-gate completion — hookPatternOk (chosen
 * hook's technique ∈ card.hookPatterns) and the per-card readingLevel band
 * that REPLACES the global Flesch ≥ 60 gate whenever a card is present.
 */

const card: StyleCard = fixtureVoiceProfile.styleCard; // open_loop + stakes; grades 6–9

/** ~In-band sections: plain but not baby-simple prose, gate-passing length. */
function sections(body: string) {
  const chapter = Array.from({ length: 40 }, () => body).join(" ");
  return [
    {
      kind: "hook",
      heading: "Hook",
      body: "Here is the one result I could not explain, and it decides the whole test.",
      estSeconds: 20,
    },
    { kind: "chapter", heading: "One", body: chapter, estSeconds: 300 },
    { kind: "chapter", heading: "Two", body: chapter, estSeconds: 300 },
    {
      kind: "cta",
      heading: "CTA",
      body: "One click helps more than you think it does.",
      estSeconds: 10,
    },
  ];
}

const plain = "The cheap grinder held its own for two weeks and the numbers barely moved.";
const dense =
  "Notwithstanding methodological heterogeneity, comparative instrumentation evaluations demonstrate statistically insignificant differentiation across manufacturer-designated quality stratifications.";

const gateBase = { targetMinutes: 12, tone: "playful-rigorous" };

describe("hookPatternOk", () => {
  it("passes when the chosen technique is in the card's patterns", () => {
    const report = computeQualityReport({
      sections: sections(plain),
      ...gateBase,
      styleCard: card,
      chosenHookStyle: "open_loop",
    });
    expect(report.styleGates?.hookPatternOk).toBe(true);
  });

  it("fails the gate when the technique is outside the card", () => {
    const report = computeQualityReport({
      sections: sections(plain),
      ...gateBase,
      styleCard: card,
      chosenHookStyle: "in_medias_res",
    });
    expect(report.styleGates?.hookPatternOk).toBe(false);
    expect(report.passed).toBe(false);
    expect(report.warnings.some((w) => w.includes("in_medias_res"))).toBe(true);
    // Deliberately NOT an auto-fix violation — a rewrite can't change the tag.
    expect(gateViolations(report).some((v) => v.includes("in_medias_res"))).toBe(false);
  });

  it("stays null (not evaluated, not a pass) when the technique is unknown", () => {
    const report = computeQualityReport({
      sections: sections(plain),
      ...gateBase,
      styleCard: card,
    });
    expect(report.styleGates?.hookPatternOk).toBeNull();
    // A null sub-field can never fail the gate by itself.
    expect(report.styleGates?.readingLevelOk).not.toBeNull();
  });

  it("is not computed at all without a card", () => {
    const report = computeQualityReport({
      sections: sections(plain),
      ...gateBase,
      chosenHookStyle: "open_loop",
    });
    expect(report.styleGates).toBeNull();
  });
});

describe("per-card readingLevel replaces the global Flesch gate", () => {
  it("computes the grade and passes in-band text", () => {
    const report = computeQualityReport({
      sections: sections(plain),
      ...gateBase,
      styleCard: card,
      chosenHookStyle: "open_loop",
    });
    expect(report.styleGates?.readingGrade).not.toBeNull();
    expect(report.styleGates?.readingLevelOk).toBe(true);
    expect(report.readabilityOk).toBe(true);
  });

  it("fails text above the card's maxGrade ceiling (readabilityOk follows)", () => {
    const report = computeQualityReport({
      sections: sections(dense),
      ...gateBase,
      styleCard: card,
      chosenHookStyle: "open_loop",
    });
    expect(report.styleGates?.readingLevelOk).toBe(false);
    expect(report.readabilityOk).toBe(false);
    expect(report.passed).toBe(false);
    expect(report.warnings.some((w) => /grade/i.test(w))).toBe(true);
    expect(gateViolations(report).some((v) => /grade band/i.test(v))).toBe(true);
  });

  it("REPLACES the global Flesch rule: sub-60 text passes when inside the band", () => {
    // A card targeting a higher grade band (e.g. an essayist voice): text
    // that FAILS the global Flesch ≥ 60 rule but sits inside the band.
    const essayCard: StyleCard = {
      ...card,
      readingLevel: { minGrade: 8, maxGrade: 14 },
    };
    const mid =
      "The measured difference stayed consistent between sessions, and the pattern repeated whenever conditions changed slightly.";
    const flesch = fleschReadingEase(Array.from({ length: 40 }, () => mid).join(" "));
    const grade = fleschKincaidGrade(Array.from({ length: 40 }, () => mid).join(" "));
    expect(flesch).toBeLessThan(60);
    expect(grade).toBeLessThanOrEqual(essayCard.readingLevel.maxGrade);

    const withCard = computeQualityReport({
      sections: sections(mid),
      ...gateBase,
      styleCard: essayCard,
      chosenHookStyle: "open_loop",
    });
    expect(withCard.readabilityOk).toBe(true);

    const withoutCard = computeQualityReport({ sections: sections(mid), ...gateBase });
    expect(withoutCard.readabilityOk).toBe(false);
  });

  it("below-band text passes with a warning (one-sided ceiling, documented)", () => {
    const simple = "The cheap one won. I ran it again. Same result. The gap was small.";
    const grade = fleschKincaidGrade(Array.from({ length: 40 }, () => simple).join(" "));
    expect(grade).toBeLessThan(card.readingLevel.minGrade);
    const report = computeQualityReport({
      sections: sections(simple),
      ...gateBase,
      styleCard: card,
      chosenHookStyle: "open_loop",
    });
    expect(report.styleGates?.readingLevelOk).toBe(true);
    expect(report.warnings.some((w) => /below the card's grade/i.test(w))).toBe(true);
  });
});
