import { describe, expect, it } from "vitest";
import { getArchetypeSeed } from "@/lib/archetypes";
import { styleCardSchema } from "@/lib/types/entities";
import { mergeStyleCards } from "@/pipelines/stages/crossover";

/**
 * C1: crossover style-card merge — the DOCUMENTED deterministic rules
 * (pipelines/stages/crossover.ts):
 *  1. surface fields (voice/tone/cta/readingLevel/snippets/preset) from the
 *     dominant (heavier) card, ties to A;
 *  2. pacing numbers blend linearly by weight;
 *  3. hookPatterns: dominant's first (preference order), then union, cap 4;
 *  4. bannedClaims: union (strictest of both);
 *  5. energy: weighted round, clamped 1–5.
 */

function seedCard(id: string) {
  const seed = getArchetypeSeed(id);
  if (seed === null) throw new Error(`missing archetype ${id}`);
  return seed.styleCard;
}

const hype = seedCard("hype-gamer");
const calm = seedCard("calm-explainer");

describe("mergeStyleCards", () => {
  it("is deterministic and schema-valid", () => {
    const first = mergeStyleCards(hype, calm, 0.7);
    const second = mergeStyleCards(hype, calm, 0.7);
    expect(first).toEqual(second);
    expect(() => styleCardSchema.parse(first)).not.toThrow();
  });

  it("blends pacing numbers linearly by weight", () => {
    const merged = mergeStyleCards(hype, calm, 0.25);
    expect(merged.pacing.wpmTarget).toBe(
      Math.round(hype.pacing.wpmTarget * 0.25 + calm.pacing.wpmTarget * 0.75),
    );
    expect(merged.pacing.sectionSeconds).toBe(
      Math.round(hype.pacing.sectionSeconds * 0.25 + calm.pacing.sectionSeconds * 0.75),
    );
    expect(merged.pacing.rehookSeconds).toBe(
      Math.round(hype.pacing.rehookSeconds * 0.25 + calm.pacing.rehookSeconds * 0.75),
    );
  });

  it("takes the dominant card's surface fields (voice/tone/cta/preset)", () => {
    const calmDominant = mergeStyleCards(hype, calm, 0.2);
    expect(calmDominant.voice).toEqual(calm.voice);
    expect(calmDominant.tone).toEqual(calm.tone);
    expect(calmDominant.ctaHabits).toEqual(calm.ctaHabits);
    expect(calmDominant.readingLevel).toEqual(calm.readingLevel);
    expect(calmDominant.thumbnailPresetId).toBe("calm-explainer");

    const hypeDominant = mergeStyleCards(hype, calm, 0.8);
    expect(hypeDominant.voice).toEqual(hype.voice);
    expect(hypeDominant.thumbnailPresetId).toBe("hype-gamer");
  });

  it("ties (weightA = 0.5) go to A — deterministic, documented", () => {
    const merged = mergeStyleCards(hype, calm, 0.5);
    expect(merged.voice).toEqual(hype.voice);
    expect(merged.thumbnailPresetId).toBe("hype-gamer");
  });

  it("puts the dominant card's hook patterns first, then unions, capped at 4", () => {
    const merged = mergeStyleCards(hype, calm, 0.2);
    // Dominant (calm) preference order preserved at the head.
    expect(merged.hookPatterns.slice(0, calm.hookPatterns.length)).toEqual(calm.hookPatterns);
    // The lighter card's techniques not already present are appended.
    const techniques = merged.hookPatterns.map((p) => p.technique);
    for (const p of hype.hookPatterns) {
      if (!calm.hookPatterns.some((c) => c.technique === p.technique)) {
        expect(techniques).toContain(p.technique);
      }
    }
    expect(new Set(techniques).size).toBe(techniques.length);
    expect(merged.hookPatterns.length).toBeLessThanOrEqual(4);
  });

  it("unions banned claims — a crossover is never a loophole", () => {
    const merged = mergeStyleCards(hype, calm, 0.9);
    for (const claim of [...hype.bannedClaims, ...calm.bannedClaims]) {
      expect(merged.bannedClaims).toContain(claim);
    }
  });

  it("weight-rounds energy, clamped to 1–5", () => {
    const merged = mergeStyleCards(hype, calm, 0.5);
    expect(merged.energy).toBe(
      Math.min(5, Math.max(1, Math.round(hype.energy * 0.5 + calm.energy * 0.5))),
    );
  });

  it("rejects out-of-range weights", () => {
    expect(() => mergeStyleCards(hype, calm, 1.2)).toThrow(/weightA/);
  });
});
