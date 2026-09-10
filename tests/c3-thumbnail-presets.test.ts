import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { ARCHETYPE_SEEDS } from "@/lib/archetypes";
import { crossoverBlendSchema } from "@/lib/types/entities";
import { fixturePackagingContext } from "@/pipelines/packaging";
import {
  AUTO_COMPOSITION_PATTERN,
  buildThumbnailImagePrompt,
  compositionPatternNote,
  contrastRuleNote,
  countOverlayWords,
  enforceOverlayWordCap,
  faceRequirementNote,
  isKnownCompositionPattern,
  OverlayTextTooLongError,
  paletteTemperatureNote,
  resolveCompositionPattern,
  resolveThumbnailPreset,
  THUMBNAIL_PROMPT_VERSION,
  thumbnailInputHash,
} from "@/pipelines/thumbnails";
import { thumbnailJobInputSchema } from "@/lib/types/pipeline";
import { FIXTURE_IDS } from "@/lib/fixtures";

/**
 * Wave C3: preset-driven thumbnail generation (PRODUCT-CONTRACTS §5).
 * Preset → prompt mapping per archetype, overlay word-cap enforcement,
 * crossover preset resolution, and the "auto" pattern default.
 */

const ctx = fixturePackagingContext();

describe("preset → prompt mapping (all 12 archetypes)", () => {
  it.each(ARCHETYPE_SEEDS.map((a) => [a.id, a] as const))(
    "%s folds its preset into the image prompt",
    (_id, archetype) => {
      const preset = archetype.thumbnailPreset;
      const prompt = buildThumbnailImagePrompt(ctx, {
        compositionPattern: preset.compositionPatternId,
        subjectDescription: "the subject of this video",
        faceReferenceNote: null,
        preset,
      });
      // Composition pattern comes from the frozen 20-pattern library.
      expect(isKnownCompositionPattern(preset.compositionPatternId)).toBe(true);
      expect(prompt).toContain(compositionPatternNote(preset.compositionPatternId));
      // Contrast rule, palette temperature and face requirement are folded in.
      expect(prompt).toContain(contrastRuleNote(preset.contrastRule));
      expect(prompt).toContain(paletteTemperatureNote(preset.paletteTemperature));
      expect(prompt).toContain(faceRequirementNote(preset.face));
      // The overlay cap in the constraints is the preset's, not the default.
      expect(prompt).toContain(`At most ${String(preset.maxOverlayWords)} word`);
      expect(prompt).toContain(THUMBNAIL_PROMPT_VERSION);
      // Abstract rules only — no reference to real videos/creators.
      expect(prompt.toLowerCase()).not.toContain("famous");
      expect(prompt).toContain("No real people's likenesses");
    },
  );

  it("without a preset the prompt keeps the generic constraints (legacy flow)", () => {
    const prompt = buildThumbnailImagePrompt(ctx, {
      compositionPattern: "split-screen",
      subjectDescription: "subject",
      faceReferenceNote: null,
    });
    expect(prompt).not.toContain("Style preset");
    expect(prompt).toContain("At most 4 words of overlay text");
  });
});

describe("overlay word-cap enforcement", () => {
  it("passes text within the cap through trimmed", () => {
    expect(enforceOverlayWordCap("  WORTH IT?  ", 3)).toBe("WORTH IT?");
    expect(enforceOverlayWordCap(null, 3)).toBeNull();
    expect(enforceOverlayWordCap("   ", 3)).toBeNull();
  });

  it("rejects overlong overlay text with a clear error (never silent truncation)", () => {
    expect(() => enforceOverlayWordCap("five whole words right here", 4)).toThrow(
      OverlayTextTooLongError,
    );
    expect(() => enforceOverlayWordCap("five whole words right here", 4)).toThrow(
      /5 words.*at most 4/,
    );
  });

  it("counts words as whitespace-separated tokens", () => {
    expect(countOverlayWords("ONE  TWO\nTHREE")).toBe(3);
    expect(countOverlayWords("$40 vs $2,000")).toBe(3);
  });

  it("the prompt builder enforces the preset's cap and embeds the text verbatim", () => {
    const preset = ARCHETYPE_SEEDS[0]?.thumbnailPreset;
    if (preset === undefined) throw new Error("no seeds");
    // high-stakes-challenge allows 4 words.
    const ok = buildThumbnailImagePrompt(ctx, {
      compositionPattern: preset.compositionPatternId,
      subjectDescription: "subject",
      faceReferenceNote: null,
      preset,
      overlayText: "LAST CHANCE RUN",
    });
    expect(ok).toContain('Overlay text (verbatim, nothing else): "LAST CHANCE RUN"');
    expect(() =>
      buildThumbnailImagePrompt(ctx, {
        compositionPattern: preset.compositionPatternId,
        subjectDescription: "subject",
        faceReferenceNote: null,
        preset,
        overlayText: "way too many overlay words to fit",
      }),
    ).toThrow(OverlayTextTooLongError);
  });

  it("overlay text and preset are folded into the pipeline input hash", () => {
    const input = thumbnailJobInputSchema.parse({
      workspaceId: FIXTURE_IDS.workspace,
      projectId: FIXTURE_IDS.project,
      compositionPattern: "countdown",
      subjectDescription: "subject",
      faceImageKey: null,
    });
    const base = thumbnailInputHash(input);
    expect(thumbnailInputHash(input, {})).toBe(base);
    expect(thumbnailInputHash(input, { presetArchetypeId: "hype-gamer" })).not.toBe(base);
    expect(thumbnailInputHash(input, { overlayText: "GO" })).not.toBe(base);
  });
});

describe("preset resolution from project mode fields", () => {
  it("archetype mode resolves the archetype's own preset", () => {
    for (const a of ARCHETYPE_SEEDS) {
      const preset = resolveThumbnailPreset({
        generationMode: "archetype",
        archetypeId: a.id,
        crossover: null,
      });
      expect(preset).toEqual(a.thumbnailPreset);
    }
  });

  it("crossover: the heavier archetype's preset wins whole (tie goes to a)", () => {
    const blend = (a: string, b: string, weightA: number) =>
      crossoverBlendSchema.parse({ a, b, weightA });
    const heavyB = resolveThumbnailPreset({
      generationMode: "crossover",
      archetypeId: null,
      crossover: blend("hype-gamer", "calm-explainer", 0.2),
    });
    expect(heavyB?.id).toBe("calm-explainer");
    const heavyA = resolveThumbnailPreset({
      generationMode: "crossover",
      archetypeId: null,
      crossover: blend("hype-gamer", "calm-explainer", 0.8),
    });
    expect(heavyA?.id).toBe("hype-gamer");
    const tie = resolveThumbnailPreset({
      generationMode: "crossover",
      archetypeId: null,
      crossover: blend("hype-gamer", "calm-explainer", 0.5),
    });
    expect(tie?.id).toBe("hype-gamer");
  });

  it("legacy / partnered / incomplete mode fields resolve to no preset", () => {
    expect(
      resolveThumbnailPreset({ generationMode: null, archetypeId: null, crossover: null }),
    ).toBeNull();
    expect(
      resolveThumbnailPreset({
        generationMode: "partnered_named",
        archetypeId: null,
        crossover: null,
      }),
    ).toBeNull();
    expect(
      resolveThumbnailPreset({ generationMode: "archetype", archetypeId: null, crossover: null }),
    ).toBeNull();
  });
});

describe('composition pattern default vs override ("auto" sentinel)', () => {
  const preset = ARCHETYPE_SEEDS[1]?.thumbnailPreset ?? null; // calm-explainer

  it('"auto" uses the preset pattern; an explicit id is a user override', () => {
    expect(resolveCompositionPattern(AUTO_COMPOSITION_PATTERN, preset)).toEqual({
      pattern: "zoom-detail",
      source: "preset",
    });
    expect(resolveCompositionPattern("big-text", preset)).toEqual({
      pattern: "big-text",
      source: "user",
    });
  });

  it('"auto" without an archetype preset is a clear BAD_REQUEST', () => {
    const err = (() => {
      try {
        resolveCompositionPattern(AUTO_COMPOSITION_PATTERN, null);
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("BAD_REQUEST");
    expect((err as TRPCError).message).toMatch(/no archetype/i);
  });
});
