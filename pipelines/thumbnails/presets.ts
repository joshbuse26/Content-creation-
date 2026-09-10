import { TRPCError } from "@trpc/server";
import { getArchetypeSeed } from "@/lib/archetypes";
import type { CrossoverBlend, ThumbnailPreset } from "@/lib/types/entities";
import type { ContrastRule, FaceRequirement, PaletteTemperature } from "@/lib/types/enums";

/**
 * Thumbnail preset resolution (PRODUCT-CONTRACTS §5) — wave C3.
 *
 * Each archetype carries exactly one thumbnail preset: a composition rule
 * from the existing 20-pattern library, an overlay-text word cap, a contrast
 * rule, a face requirement, and a palette temperature. Generation folds the
 * preset + the user's subject into the image prompt.
 *
 * Presets are ABSTRACT pattern rules only — never a reference to any real
 * video's or creator's thumbnail.
 */

/**
 * Sentinel the client sends as `compositionPattern` to mean "use the
 * project's archetype preset". The frozen thumbnails.generate contract
 * requires a non-empty pattern string, so preset-driven generation rides an
 * additive convention instead of a schema change. Any other value is an
 * explicit user override — the preset is the default, not a cage.
 */
export const AUTO_COMPOSITION_PATTERN = "auto";

/** The default overlay-word cap when no preset is in play (legacy prompt). */
export const DEFAULT_MAX_OVERLAY_WORDS = 4;

export interface GenerationModeFields {
  generationMode: "archetype" | "crossover" | "partnered_named" | "train_on_my_channel" | null;
  archetypeId: string | null;
  crossover: CrossoverBlend | null;
}

/**
 * Resolve the thumbnail preset for a project's mode fields.
 *
 *  - archetype       → that archetype's preset.
 *  - crossover       → the HEAVIER archetype's preset wins, whole. Presets
 *                      are discrete composition rules — blending "half a
 *                      countdown, half a zoom" is meaningless — so the same
 *                      deterministic rule as the style-card stub applies:
 *                      weightA >= 0.5 picks `a`, otherwise `b` (a 50/50 tie
 *                      goes to `a`).
 *  - partnered_named / train_on_my_channel / null (legacy voice-profile
 *    flow) → null: no preset, the prompt keeps its generic constraints.
 */
export function resolveThumbnailPreset(project: GenerationModeFields): ThumbnailPreset | null {
  switch (project.generationMode) {
    case "archetype": {
      if (project.archetypeId === null) return null;
      return getArchetypeSeed(project.archetypeId)?.thumbnailPreset ?? null;
    }
    case "crossover": {
      const blend = project.crossover;
      if (blend === null) return null;
      const heavier = blend.weightA >= 0.5 ? blend.a : blend.b;
      return getArchetypeSeed(heavier)?.thumbnailPreset ?? null;
    }
    default:
      return null;
  }
}

/**
 * Resolve the composition pattern for a generate request. The preset is the
 * DEFAULT: `"auto"` uses the preset's pattern (and is an error when the
 * project has no preset to fall back on); any explicit pattern id is the
 * user's override and wins as-is.
 */
export function resolveCompositionPattern(
  requested: string,
  preset: ThumbnailPreset | null,
): { pattern: string; source: "preset" | "user" } {
  if (requested !== AUTO_COMPOSITION_PATTERN) {
    return { pattern: requested, source: "user" };
  }
  if (preset === null) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        'compositionPattern "auto" needs an archetype: the project has no archetype (or crossover) ' +
        "to take a thumbnail preset from — pick a pattern from the library explicitly.",
    });
  }
  return { pattern: preset.compositionPatternId, source: "preset" };
}

/** Count overlay words the way the cap means them: whitespace-separated tokens. */
export function countOverlayWords(overlayText: string): number {
  return overlayText.trim().split(/\s+/u).filter(Boolean).length;
}

/** Thrown when overlay text exceeds the preset's word cap. */
export class OverlayTextTooLongError extends Error {
  constructor(
    readonly wordCount: number,
    readonly maxWords: number,
  ) {
    super(
      `Overlay text is ${String(wordCount)} words; this thumbnail preset allows at most ` +
        `${String(maxWords)}. Shorten the overlay text to ${String(maxWords)} word` +
        `${maxWords === 1 ? "" : "s"} or fewer.`,
    );
    this.name = "OverlayTextTooLongError";
  }
}

/**
 * Enforce the preset's overlay-text word cap. Returns the trimmed text (or
 * null for none); REJECTS overlong text with a clear error rather than
 * silently truncating — silently dropped words would ship a thumbnail the
 * user never approved.
 */
export function enforceOverlayWordCap(overlayText: string | null, maxWords: number): string | null {
  if (overlayText === null) return null;
  const trimmed = overlayText.trim();
  if (trimmed === "") return null;
  const words = countOverlayWords(trimmed);
  if (maxWords <= 0 || words > maxWords) {
    throw new OverlayTextTooLongError(words, Math.max(maxWords, 0));
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// Preset → prompt guidance lines (abstract rules only)
// ---------------------------------------------------------------------------

const CONTRAST_NOTES: Record<ContrastRule, string> = {
  light_on_dark:
    "Light subject and overlay text against a dark background — bright rim light, deep shadows.",
  dark_on_light:
    "Dark subject and overlay text against a light, airy background — clean and high-key.",
  complementary:
    "Two complementary hues carry the contrast: subject in one, background in the other.",
};

const PALETTE_NOTES: Record<PaletteTemperature, string> = {
  warm: "Warm palette — reds, oranges, ambers dominate.",
  cool: "Cool palette — blues, teals, cold greys dominate.",
  neutral: "Neutral palette — desaturated tones with one restrained accent color.",
};

const FACE_NOTES: Record<FaceRequirement, string> = {
  required: "Include one expressive human face as a primary element of the composition.",
  optional: "A human face may appear if it strengthens the composition, but is not required.",
  none: "No human faces anywhere in the frame.",
};

export function contrastRuleNote(rule: ContrastRule): string {
  return CONTRAST_NOTES[rule];
}

export function paletteTemperatureNote(temp: PaletteTemperature): string {
  return PALETTE_NOTES[temp];
}

export function faceRequirementNote(face: FaceRequirement): string {
  return FACE_NOTES[face];
}
