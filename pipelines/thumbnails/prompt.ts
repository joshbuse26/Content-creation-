import type { PackagingContext } from "@/pipelines/packaging/context";
import { compositionPatternNote } from "./patterns";

/**
 * Thumbnail image prompt — spec §5.10. Pure and deterministic: pattern
 * guidance + the user's subject description + project frame context +
 * production constraints, assembled into one prompt for the ImageProvider.
 *
 * Versioned like prompts/* so the pipeline input hash changes when the
 * prompt text changes (a re-run with a new prompt version is new work).
 */

export const THUMBNAIL_PROMPT_VERSION = "tp-v1";

export interface ThumbnailPromptInput {
  compositionPattern: string;
  subjectDescription: string;
  /**
   * Note about a user-uploaded face reference (stored, consented — spec
   * §5.10). Null when no reference was provided; when set, the prompt asks
   * the generator to match the referenced person's look.
   */
  faceReferenceNote: string | null;
}

export function buildThumbnailImagePrompt(
  ctx: PackagingContext,
  input: ThumbnailPromptInput,
): string {
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
    "",
    "Production constraints:",
    "- One dominant focal point; crop tighter than feels comfortable.",
    "- High contrast, saturated but not neon; must stay legible at 168px wide.",
    "- At most 4 words of overlay text, heavy sans-serif, strong contrast against the background.",
    "- No logos, no watermarks, no brand marks, no channel names.",
    "- No real people's likenesses unless a face reference is given above.",
    `[${THUMBNAIL_PROMPT_VERSION}]`,
  ];
  return lines.join("\n");
}
