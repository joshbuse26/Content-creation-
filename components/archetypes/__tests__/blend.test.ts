import { describe, expect, it } from "vitest";
import { ARCHETYPE_SEEDS } from "@/lib/archetypes";
import { archetypeTarget, blendSummary, clampWeight, crossoverTarget } from "../blend";
import { generationTargetSchema } from "@/lib/types/entities";

function seedById(id: string) {
  const seed = ARCHETYPE_SEEDS.find((a) => a.id === id);
  if (seed === undefined) throw new Error(`missing seed ${id}`);
  return seed;
}

// Deliberately far-apart cards so the lerp is visible.
const challenge = seedById("high-stakes-challenge"); // wpm 165, energy 5
const explainer = seedById("calm-explainer"); // wpm 135, energy 2

describe("clampWeight", () => {
  it("clamps to [0, 1] and defaults NaN to 0.5", () => {
    expect(clampWeight(-0.2)).toBe(0);
    expect(clampWeight(1.7)).toBe(1);
    expect(clampWeight(0.35)).toBe(0.35);
    expect(clampWeight(Number.NaN)).toBe(0.5);
  });
});

describe("blendSummary", () => {
  it("lerps pacing and energy at the midpoint (rounded)", () => {
    const s = blendSummary(challenge, explainer, 0.5);
    expect(s.wpmTarget).toBe(150); // (165+135)/2
    expect(s.energy).toBe(4); // (5+2)/2 = 3.5 → rounds to 4
    expect(s.sectionSeconds).toBe(
      Math.round(
        (challenge.styleCard.pacing.sectionSeconds + explainer.styleCard.pacing.sectionSeconds) / 2,
      ),
    );
  });

  it("returns A's card values at weight 1 and B's at weight 0", () => {
    const atA = blendSummary(challenge, explainer, 1);
    expect(atA.wpmTarget).toBe(challenge.styleCard.pacing.wpmTarget);
    expect(atA.energy).toBe(challenge.styleCard.energy);
    const atB = blendSummary(challenge, explainer, 0);
    expect(atB.wpmTarget).toBe(explainer.styleCard.pacing.wpmTarget);
    expect(atB.energy).toBe(explainer.styleCard.energy);
  });

  it("dominant follows the heavier weight; ties go to A", () => {
    expect(blendSummary(challenge, explainer, 0.7).dominant).toBe(challenge.id);
    expect(blendSummary(challenge, explainer, 0.3).dominant).toBe(explainer.id);
    expect(blendSummary(challenge, explainer, 0.5).dominant).toBe(challenge.id);
  });

  it("hook techniques are the union, heavier card's order first, deduped", () => {
    // challenge: [stakes, open_loop] · explainer: [open_loop, bold_claim]
    const heavyA = blendSummary(challenge, explainer, 0.8);
    expect(heavyA.hookTechniques).toEqual(["stakes", "open_loop", "bold_claim"]);
    const heavyB = blendSummary(challenge, explainer, 0.2);
    expect(heavyB.hookTechniques).toEqual(["open_loop", "bold_claim", "stakes"]);
    // No duplicates even though open_loop appears on both cards.
    expect(new Set(heavyA.hookTechniques).size).toBe(heavyA.hookTechniques.length);
  });

  it("labels the blend with rounded percentages and display names", () => {
    const s = blendSummary(challenge, explainer, 0.6);
    expect(s.label).toBe("60% High-Stakes Challenge · 40% Calm Explainer");
  });

  it("clamps an out-of-range weight before blending", () => {
    const s = blendSummary(challenge, explainer, 4);
    expect(s.wpmTarget).toBe(challenge.styleCard.pacing.wpmTarget);
    expect(s.label).toMatch(/^100% /);
  });
});

describe("generation target builders", () => {
  it("archetypeTarget parses against the frozen generationTargetSchema", () => {
    const parsed = generationTargetSchema.safeParse(archetypeTarget("calm-explainer"));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.mode).toBe("archetype");
  });

  it("crossoverTarget parses and clamps the weight", () => {
    const target = crossoverTarget({
      a: "high-stakes-challenge",
      b: "calm-explainer",
      weightA: 1.5,
    });
    expect(target.crossover?.weightA).toBe(1);
    expect(generationTargetSchema.safeParse(target).success).toBe(true);
  });
});
