/**
 * Composition pattern library — spec §5.10. ~20 ORIGINAL, ABSTRACT
 * composition patterns described generically (framing, contrast, eye-flow).
 * These are geometry-and-emphasis recipes, never references to any real
 * creator's actual thumbnail.
 *
 * The `note` is the pattern's guidance line inside the image prompt; the
 * `label` is what the picker UI shows.
 */

export interface CompositionPattern {
  id: string;
  label: string;
  note: string;
}

export const COMPOSITION_PATTERNS: readonly CompositionPattern[] = [
  {
    id: "face+object",
    label: "Face + object",
    note: "Expressive face on one third of the frame, hero object on the other; the eye-line points toward the object.",
  },
  {
    id: "before/after",
    label: "Before / after",
    note: "Vertical split: degraded starting state on the left, transformed result on the right, a small arrow bridging the two.",
  },
  {
    id: "big-text",
    label: "Big text overlay",
    note: "A 3-5 word phrase fills roughly 60% of the frame in heavy type; the subject peeks in from a corner.",
  },
  {
    id: "split-screen",
    label: "Split screen",
    note: "Hard vertical split with two competing subjects on contrasting background colors, tension across the seam.",
  },
  {
    id: "arrow-focus",
    label: "Arrow focus",
    note: "One bold arrow directs the eye to the surprising detail; everything outside the arrow's target is desaturated.",
  },
  {
    id: "zoom-detail",
    label: "Zoom detail",
    note: "Extreme close-up of the critical detail inside a magnifier ring; the wider scene stays soft behind it.",
  },
  {
    id: "reaction-inset",
    label: "Reaction inset",
    note: "Main scene full-bleed; a reacting face in a circular corner inset with a thick rim.",
  },
  {
    id: "number-stamp",
    label: "Number stamp",
    note: "A large numeral stamped over a grid of subjects — the listicle count is the hero element.",
  },
  {
    id: "versus-grid",
    label: "Versus grid",
    note: "Two subjects in mirrored halves with a bold divider mark between them; symmetric framing, opposing palettes.",
  },
  {
    id: "progress-timeline",
    label: "Progress timeline",
    note: "Three stages of the same subject left to right, each larger or brighter than the last; a baseline ties them together.",
  },
  {
    id: "ranked-lineup",
    label: "Ranked lineup",
    note: "A row of similar objects ordered by size or brightness, the winner highlighted with a ring or glow.",
  },
  {
    id: "hidden-reveal",
    label: "Hidden reveal",
    note: "The subject partially covered or silhouetted with a large question mark — curiosity from what is withheld.",
  },
  {
    id: "cutaway",
    label: "Cutaway",
    note: "The object sliced open to expose its inner workings; the cross-section is the focal point, edges cleanly lit.",
  },
  {
    id: "map-pin",
    label: "Map pin",
    note: "A stylized map or terrain fills the frame with one oversized location marker; the route or region glows.",
  },
  {
    id: "checklist-overlay",
    label: "Checklist overlay",
    note: "The subject beside a short vertical checklist of 3 oversized checkboxes, some ticked, one boldly crossed.",
  },
  {
    id: "glow-outline",
    label: "Glow outline",
    note: "Subject silhouetted against a near-black background with a vivid rim light tracing its outline.",
  },
  {
    id: "crossed-out",
    label: "Crossed out",
    note: "The common choice struck through with a heavy X; the better alternative beside it, brightly lit.",
  },
  {
    id: "scale-contrast",
    label: "Scale contrast",
    note: "Tiny version of the subject dwarfed by a giant counterpart in the same frame — exaggerated size gap tells the story.",
  },
  {
    id: "fork-in-road",
    label: "Fork in the road",
    note: "Two diverging arrows or paths from a single point, each leading to a different outcome image.",
  },
  {
    id: "countdown",
    label: "Countdown",
    note: "A large timer or gauge dominates one side, needle deep in the red zone; the subject races it on the other side.",
  },
] as const;

export const COMPOSITION_PATTERN_IDS = COMPOSITION_PATTERNS.map((p) => p.id);

const byId = new Map(COMPOSITION_PATTERNS.map((p) => [p.id, p]));

/** Pattern guidance line, with a sane free-composition fallback. */
export function compositionPatternNote(patternId: string): string {
  return (
    byId.get(patternId)?.note ??
    "Free composition — keep one dominant subject and one focal contrast point."
  );
}

export function isKnownCompositionPattern(patternId: string): boolean {
  return byId.has(patternId);
}
