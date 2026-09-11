import { describe, expect, it } from "vitest";
import { ARCHETYPE_SEEDS, getArchetypeSeed } from "@/lib/archetypes";
import { parseStyleCard, upgradeLegacyStyleCard } from "@/lib/style-card";
import {
  crossoverBlendSchema,
  generationTargetSchema,
  styleCardSchema,
} from "@/lib/types/entities";
import { ARCHETYPE_IDS } from "@/lib/types/enums";
import { fixtureVoiceProfile } from "@/lib/fixtures";
import { COMPOSITION_PATTERN_IDS } from "@/pipelines/thumbnails/patterns";

/**
 * Wave C (C0): StyleCard v2 schema, legacy upgrade, and the 12 archetype
 * seeds (PRODUCT-CONTRACTS §1/§2).
 */

const legacy = {
  rhythm: "short bursts",
  register: "casual expert",
  catchphrases: ["one", "two", "three", "four", "five"],
  humor: "dry",
  pov: "first person",
  taboos: ["clickbait", "dunking"],
};

describe("StyleCard v2 schema", () => {
  it("accepts the fixture voice profile's card", () => {
    expect(() => styleCardSchema.parse(fixtureVoiceProfile.styleCard)).not.toThrow();
  });

  it("requires placementPct when placement is timestamp_pct", () => {
    const bad = {
      ...fixtureVoiceProfile.styleCard,
      ctaHabits: {
        placement: "timestamp_pct",
        placementPct: null,
        phrasingStyle: "quick",
        maxPerVideo: 1,
      },
    };
    expect(styleCardSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an inverted reading-level band", () => {
    const bad = { ...fixtureVoiceProfile.styleCard, readingLevel: { minGrade: 9, maxGrade: 6 } };
    expect(styleCardSchema.safeParse(bad).success).toBe(false);
  });

  it("requires at least one hook pattern and bounds energy 1-5", () => {
    expect(
      styleCardSchema.safeParse({ ...fixtureVoiceProfile.styleCard, hookPatterns: [] }).success,
    ).toBe(false);
    expect(styleCardSchema.safeParse({ ...fixtureVoiceProfile.styleCard, energy: 6 }).success).toBe(
      false,
    );
  });
});

describe("legacy style-card upgrade", () => {
  it("maps legacy fields into the v2 shape (mirrors migration 0005)", () => {
    const card = upgradeLegacyStyleCard(legacy);
    expect(card.voice).toEqual({
      pov: "first person",
      diction: "casual expert",
      rhythm: "short bursts",
    });
    expect(card.tone).toEqual({ register: "dry", never: "clickbait; dunking" });
    expect(card.exampleSnippets).toEqual(["one", "two", "three", "four"]); // capped at 4
    expect(card.pacing).toEqual({ wpmTarget: 150, sectionSeconds: 90, rehookSeconds: 75 });
    expect(card.bannedClaims).toEqual([]);
    expect(card.thumbnailPresetId).toBeNull();
  });

  it("parseStyleCard accepts v2, upgrades legacy, and rejects garbage", () => {
    expect(parseStyleCard(fixtureVoiceProfile.styleCard)).toEqual(fixtureVoiceProfile.styleCard);
    expect(parseStyleCard(legacy).voice.rhythm).toBe("short bursts");
    expect(() => parseStyleCard({ nonsense: true })).toThrow();
  });
});

describe("archetype seeds (frozen catalog)", () => {
  it("ships exactly the 12 frozen ids, in sort order", () => {
    expect(ARCHETYPE_SEEDS.map((a) => a.id)).toEqual([...ARCHETYPE_IDS]);
    expect(ARCHETYPE_SEEDS.map((a) => a.sort)).toEqual(ARCHETYPE_SEEDS.map((_, i) => i + 1));
  });

  it("keys every thumbnail preset to its own archetype", () => {
    for (const a of ARCHETYPE_SEEDS) {
      expect(a.thumbnailPreset.id).toBe(a.id);
      expect(a.styleCard.thumbnailPresetId).toBe(a.id);
    }
  });

  it("uses only composition patterns from the frozen 20-pattern library", () => {
    for (const a of ARCHETYPE_SEEDS) {
      expect(COMPOSITION_PATTERN_IDS).toContain(a.thumbnailPreset.compositionPatternId);
    }
  });

  it("ships original pitch and exampleSnippets with no TODO(seed-copy) markers", () => {
    for (const a of ARCHETYPE_SEEDS) {
      expect(a.pitch.startsWith("TODO(seed-copy)")).toBe(false);
      expect(a.pitch).not.toContain("TODO(seed-copy)");
      expect(a.pitch.length).toBeGreaterThan(20);
      expect(a.styleCard.exampleSnippets.length).toBeGreaterThanOrEqual(2);
      for (const snippet of a.styleCard.exampleSnippets) {
        expect(snippet).not.toContain("TODO(seed-copy)");
        expect(snippet.length).toBeGreaterThan(20);
        expect(snippet.length).toBeLessThanOrEqual(400);
      }
    }
  });

  it("gives every card real structured craft values", () => {
    for (const a of ARCHETYPE_SEEDS) {
      expect(a.styleCard.hookPatterns.length).toBeGreaterThanOrEqual(1);
      expect(a.styleCard.bannedClaims.length).toBeGreaterThanOrEqual(1);
      expect(a.styleCard.pacing.wpmTarget).toBeGreaterThanOrEqual(80);
      expect(a.styleCard.energy).toBeGreaterThanOrEqual(1);
      expect(a.styleCard.energy).toBeLessThanOrEqual(5);
    }
  });

  it("getArchetypeSeed resolves ids and rejects unknowns", () => {
    expect(getArchetypeSeed("calm-explainer")?.displayName).toBe("Calm Explainer");
    expect(getArchetypeSeed("mr-famous-person")).toBeNull();
  });
});

describe("generation target schema", () => {
  it("enforces per-mode requirements", () => {
    expect(
      generationTargetSchema.safeParse({ mode: "archetype", archetypeId: "hype-gamer" }).success,
    ).toBe(true);
    expect(generationTargetSchema.safeParse({ mode: "archetype" }).success).toBe(false);
    expect(generationTargetSchema.safeParse({ mode: "crossover" }).success).toBe(false);
    expect(
      generationTargetSchema.safeParse({
        mode: "crossover",
        crossover: { a: "hype-gamer", b: "calm-explainer", weightA: 0.7 },
      }).success,
    ).toBe(true);
    expect(generationTargetSchema.safeParse({ mode: "partnered_named" }).success).toBe(false);
    expect(generationTargetSchema.safeParse({ mode: "train_on_my_channel" }).success).toBe(false);
  });

  it("crossover requires two distinct archetypes and weight in [0,1]", () => {
    expect(
      crossoverBlendSchema.safeParse({ a: "hype-gamer", b: "hype-gamer", weightA: 0.5 }).success,
    ).toBe(false);
    expect(
      crossoverBlendSchema.safeParse({ a: "hype-gamer", b: "calm-explainer", weightA: 1.2 })
        .success,
    ).toBe(false);
  });
});
