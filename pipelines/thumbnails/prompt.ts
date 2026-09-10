import type { PackagingContext } from "@/pipelines/packaging/context";
import type { ThumbnailPreset } from "@/lib/types/entities";
import { compositionPatternNote } from "./patterns";
import {
  contrastRuleNote,
  DEFAULT_MAX_OVERLAY_WORDS,
  enforceOverlayWordCap,
  faceRequirementNote,
  paletteTemperatureNote,
} from "./presets";

/**
 * Thumbnail image prompt — spec §5.10 + PRODUCT-CONTRACTS §5. Pure and
 * deterministic: pattern guidance + the user's subject description + project
 * frame context + production constraints, assembled into one prompt for the
 * ImageProvider.
 *
 * Wave C3: when the project's archetype (or crossover — heavier archetype
 * wins) supplies a thumbnail preset, the preset's contrast rule, palette
 * temperature, face requirement and overlay-word cap are folded into the
 * prompt as ABSTRACT composition rules. Never any reference to a real
 * video's or creator's thumbnail.
 *
 * Versioned like prompts/* so the pipeline input hash changes when the
 * prompt text changes (a re-run with a new prompt version is new work).
 */

export const THUMBNAIL_PROMPT_VERSION = "tp-v2";

export interface ThumbnailPromptInput {
  compositionPattern: string;
  subjectDescription: string;
  /**
   * Note about a user-uploaded face reference (stored, consented — spec
   * §5.10). Null when no reference was provided; when set, the prompt asks
   * the generator to match the referenced person's look.
   */
  faceReferenceNote: string | null;
  /**
   * Archetype thumbnail preset (PRODUCT-CONTRACTS §5) — null/omitted for
   * the legacy no-archetype flow, which keeps the generic constraints.
   */
  preset?: ThumbnailPreset | null;
  /**
   * Exact overlay text the user wants on the image. Enforced against the
   * preset's maxOverlayWords (or the default cap) — overlong text is
   * REJECTED with a clear error, never silently truncated.
   */
  overlayText?: string | null;
}

export function buildThumbnailImagePrompt(
  ctx: PackagingContext,
  input: ThumbnailPromptInput,
): string {
  const preset = input.preset ?? null;
  const maxOverlayWords = preset?.maxOverlayWords ?? DEFAULT_MAX_OVERLAY_WORDS;
  const overlayText = enforceOverlayWordCap(input.overlayText ?? null, maxOverlayWords);
  const keywords = (ctx.frame?.keywords ?? ctx.nicheKeywords).slice(0, 3).join(", ");
  const lines = [
    `YouTube thumbnail, 1280x720, 16:9. Video: "${ctx.projectTitle}".`,
    "",
    `Composition (${input.compositionPattern}): ${compositionPatternNote(input.compositionPattern)}`,
    `Subject: ${input.subjectDescription}`,
    ...(ctx.frame === null
      ? []
      : [
          `Angle of the video: ${ctx.frame.angle}`,
          `Mood: ${ctx.frame.tone} — the image should read the same way at a glance.`,
        ]),
    ...(keywords === "" ? [] : [`Topic context: ${keywords}`]),
    ...(input.faceReferenceNote === null
      ? []
      : [`Face reference: ${input.faceReferenceNote} — match this person's appearance.`]),
    ...(preset === null
      ? []
      : [
          "",
          "Style preset (abstract composition rules):",
          `- Contrast: ${contrastRuleNote(preset.contrastRule)}`,
          `- Palette: ${paletteTemperatureNote(preset.paletteTemperature)}`,
          `- Faces: ${faceRequirementNote(preset.face)}`,
        ]),
    ...(overlayText === null ? [] : [`Overlay text (verbatim, nothing else): "${overlayText}"`]),
    "",
    "Production constraints:",
    "- One dominant focal point; crop tighter than feels comfortable.",
    "- High contrast, saturated but not neon; must stay legible at 168px wide.",
    `- At most ${String(maxOverlayWords)} word${maxOverlayWords === 1 ? "" : "s"} of overlay text, heavy sans-serif, strong contrast against the background.`,
    "- No logos, no watermarks, no brand marks, no channel names.",
    "- No real people's likenesses unless a face reference is given above.",
    `[${THUMBNAIL_PROMPT_VERSION}]`,
  ];
  return lines.join("\n");
}
