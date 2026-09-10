import { describe, expect, it } from "vitest";
import { checkCtaPlacement, computeStyleGates, scanBannedClaims } from "@/lib/style-gates";
import type { StyleCtaHabits } from "@/lib/types/entities";
import { fixtureSections, fixtureVoiceProfile } from "@/lib/fixtures";
import { computeQualityReport } from "@/pipelines/script/quality-gate";

/**
 * Wave C (C0): pure-code style gates (PRODUCT-CONTRACTS §6) — bannedClaims
 * scan (hard fail) and CTA placement, plus their wiring into the quality
 * gate. hookPatternOk / readingLevel are C1's; here they must stay null.
 */

const section = (kind: string, body: string, estSeconds = 60, heading = kind) => ({
  kind,
  heading,
  body,
  estSeconds,
});

describe("scanBannedClaims", () => {
  it("flags promissory phrasing per claim type", () => {
    const guaranteed = section("chapter", "This routine is guaranteed to work and it never fails.");
    const medical = section("chapter", "This tea cures cancer, doctors hate it.", 60, "Tea");
    const financial = section(
      "chapter",
      "Follow my plan to double your money with guaranteed returns.",
    );
    const superlative = section(
      "chapter",
      "This is the only way to learn, no one else knows this.",
    );
    const fear = section(
      "chapter",
      "Skipping this will ruin your life — act before it's too late.",
    );
    expect(
      scanBannedClaims([guaranteed], ["guaranteed_results"]).map((h) => h.claimType),
    ).toContain("guaranteed_results");
    expect(scanBannedClaims([medical], ["medical_claims"]).length).toBeGreaterThan(0);
    expect(scanBannedClaims([financial], ["financial_promises"]).length).toBeGreaterThan(0);
    expect(scanBannedClaims([superlative], ["absolute_superlatives"]).length).toBeGreaterThan(0);
    expect(scanBannedClaims([fear], ["fear_mongering"]).length).toBeGreaterThan(0);
  });

  it("only scans for the card's listed claim types", () => {
    const s = [section("chapter", "Guaranteed to work every single time.")];
    expect(scanBannedClaims(s, ["medical_claims"])).toEqual([]);
  });

  it("does not flag ordinary topical discussion (high precision)", () => {
    const s = [
      section(
        "chapter",
        "We talk about money, medicine, and doctors today. The best grinder I tested this year still needs work. Results vary a lot.",
      ),
    ];
    expect(
      scanBannedClaims(s, [
        "guaranteed_results",
        "medical_claims",
        "financial_promises",
        "absolute_superlatives",
        "fear_mongering",
      ]),
    ).toEqual([]);
  });

  it("passes the fixture script against the fixture card", () => {
    expect(scanBannedClaims(fixtureSections, fixtureVoiceProfile.styleCard.bannedClaims)).toEqual(
      [],
    );
  });
});

describe("checkCtaPlacement", () => {
  const habits = (over: Partial<StyleCtaHabits>): StyleCtaHabits => ({
    placement: "end_only",
    placementPct: null,
    phrasingStyle: "short",
    maxPerVideo: 1,
    ...over,
  });

  it("enforces maxPerVideo", () => {
    const sections = [
      section("hook", "h"),
      section("chapter", "c"),
      section("cta", "one"),
      section("cta", "two"),
    ];
    const result = checkCtaPlacement(sections, habits({ maxPerVideo: 1, placement: "end_only" }));
    expect(result.ok).toBe(false);
    expect(result.ctaCount).toBe(2);
  });

  it("end_only fails when a CTA precedes the last chapter", () => {
    const sections = [
      section("hook", "h"),
      section("cta", "early"),
      section("chapter", "c"),
      section("outro", "o"),
    ];
    expect(checkCtaPlacement(sections, habits({})).ok).toBe(false);
    const fine = [section("hook", "h"), section("chapter", "c"), section("cta", "late")];
    expect(checkCtaPlacement(fine, habits({})).ok).toBe(true);
  });

  it("after_payoff requires each CTA to directly follow a chapter", () => {
    const good = [section("hook", "h"), section("chapter", "c"), section("cta", "ask")];
    const bad = [section("hook", "h"), section("cta", "ask"), section("chapter", "c")];
    expect(checkCtaPlacement(good, habits({ placement: "after_payoff" })).ok).toBe(true);
    expect(checkCtaPlacement(bad, habits({ placement: "after_payoff" })).ok).toBe(false);
  });

  it("timestamp_pct checks the first CTA against the target percent", () => {
    const sections = [
      section("hook", "h", 30),
      section("chapter", "c1", 40),
      section("cta", "mid", 10),
      section("chapter", "c2", 120),
    ];
    // CTA starts at 70/200 = 35% of runtime.
    expect(
      checkCtaPlacement(sections, habits({ placement: "timestamp_pct", placementPct: 30 })).ok,
    ).toBe(true);
    expect(
      checkCtaPlacement(sections, habits({ placement: "timestamp_pct", placementPct: 80 })).ok,
    ).toBe(false);
  });

  it("zero CTAs is placement-clean (count 0)", () => {
    const result = checkCtaPlacement([section("chapter", "c")], habits({}));
    expect(result).toEqual({ ok: true, ctaCount: 0, violations: [] });
  });
});

describe("quality gate integration", () => {
  const gateBase = { targetMinutes: 12, tone: "playful-rigorous" };

  it("returns styleGates: null when no card is in play", () => {
    const report = computeQualityReport({ sections: fixtureSections, ...gateBase });
    expect(report.styleGates).toBeNull();
  });

  it("hard-fails on a banned claim when the card lists the type", () => {
    const sections = fixtureSections.map((s) =>
      s.kind === "chapter" && s.position === 2
        ? { ...s, body: `${s.body} This setup is guaranteed to work every single time.` }
        : s,
    );
    const report = computeQualityReport({
      sections,
      ...gateBase,
      styleCard: fixtureVoiceProfile.styleCard,
    });
    expect(report.passed).toBe(false);
    expect(report.styleGates?.bannedClaimsOk).toBe(false);
    expect(report.styleGates?.bannedClaimHits[0]?.claimType).toBe("guaranteed_results");
    expect(report.warnings.some((w) => w.includes("Banned claim"))).toBe(true);
  });

  it("passes the clean fixture script with the fixture card, C1 fields null", () => {
    const report = computeQualityReport({
      sections: fixtureSections,
      ...gateBase,
      styleCard: fixtureVoiceProfile.styleCard,
    });
    expect(report.styleGates).not.toBeNull();
    expect(report.styleGates?.bannedClaimsOk).toBe(true);
    expect(report.styleGates?.ctaPlacementOk).toBe(true);
    // C1 computes these — until then they are "not evaluated", never a pass.
    expect(report.styleGates?.hookPatternOk).toBeNull();
    expect(report.styleGates?.readingLevelOk).toBeNull();
    // Style gates never fail a clean script (word-count vs the short fixture
    // bodies is a separate, pre-existing gate — not under test here).
    expect(report.warnings.some((w) => w.includes("Banned claim"))).toBe(false);
  });

  it("computeStyleGates reports CTA violations in notes", () => {
    const sections = [section("hook", "h"), section("cta", "too early"), section("chapter", "c")];
    const gates = computeStyleGates(sections, {
      ...fixtureVoiceProfile.styleCard,
      ctaHabits: {
        placement: "end_only",
        placementPct: null,
        phrasingStyle: "short",
        maxPerVideo: 1,
      },
    });
    expect(gates.ctaPlacementOk).toBe(false);
    expect(gates.notes.length).toBeGreaterThan(0);
  });
});
