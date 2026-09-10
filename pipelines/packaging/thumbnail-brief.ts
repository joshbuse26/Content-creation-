import type { PackagingContext } from "./context";

/**
 * Thumbnail TEXT briefs — v1 ships briefs only; image generation is cut to
 * v1.1 (sprint plan §1), so this module deliberately never touches the
 * ImageProvider. The brief is the `prompt_used` stored on a
 * thumbnail_concepts row and is written for a human designer (or the v1.1
 * image pipeline) to execute.
 */

export interface ThumbnailBriefInput {
  compositionPattern: string;
  subjectDescription: string;
}

/** The ~20-pattern composition library (spec §5.10), abstract patterns only. */
export const COMPOSITION_PATTERN_NOTES: Record<string, string> = {
  "face+object":
    "Expressive face on one third, hero object on the other, eye-line toward the object.",
  "before/after":
    "Vertical split; degraded state left, transformed state right; small arrow bridging.",
  "big-text": "3-5 word phrase fills 60% of frame; subject peeks from a corner.",
  "split-screen": "Hard vertical split, two competing subjects, contrasting background colors.",
  "arrow-focus":
    "Single bold arrow directing the eye to the surprising detail; everything else desaturated.",
  "zoom-detail": "Extreme close-up of the critical detail with a magnifier ring.",
  "reaction-inset": "Main scene full-bleed; creator reaction in a corner circle inset.",
  "number-stamp": "Large numeral stamped over the subject grid (listicles).",
};

/** Build the text brief for a thumbnail concept. Pure — deterministic. */
export function buildThumbnailBrief(ctx: PackagingContext, input: ThumbnailBriefInput): string {
  const patternNote =
    COMPOSITION_PATTERN_NOTES[input.compositionPattern] ??
    "Free composition — keep one dominant subject and one focal contrast point.";
  const keywords = (ctx.frame?.keywords ?? ctx.nicheKeywords).slice(0, 3).join(", ");
  const lines = [
    `THUMBNAIL BRIEF — ${ctx.projectTitle}`,
    "",
    `Composition pattern: ${input.compositionPattern}`,
    `Pattern guidance: ${patternNote}`,
    `Subject: ${input.subjectDescription}`,
    ...(ctx.frame === null
      ? []
      : [
          `Video angle: ${ctx.frame.angle}`,
          `Tone: ${ctx.frame.tone} — the thumbnail should read the same at a glance.`,
        ]),
    `Keyword context: ${keywords}`,
    "",
    "Production notes:",
    "- 1280x720, must stay legible at 168px wide (mobile feed size).",
    "- Max 4 words of overlay text; high contrast against the background.",
    "- One focal point; crop tighter than feels comfortable.",
    "- No third-party imagery or channel branding other than our own.",
  ];
  return lines.join("\n");
}
