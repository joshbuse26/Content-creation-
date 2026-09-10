import type { StyleCard } from "@/lib/types/entities";
import type { ContrastRule, HookStyle, PaletteTemperature } from "@/lib/types/enums";

/**
 * Display helpers for archetype seed data (wave C2).
 *
 * Seed copy from Josh's content pipeline is still pending: `pitch` and
 * `exampleSnippets` may carry a `TODO(seed-copy)` marker
 * (PRODUCT-CONTRACTS §2). The UI never shows the marker: text after it is
 * working copy (safe per lib/archetypes.ts), a bare marker becomes a
 * tasteful generic placeholder. Never invent named creators.
 */

export const SEED_COPY_MARKER = "TODO(seed-copy)";
export const PLACEHOLDER_COPY = "Sample coming soon.";

/** Strip the pending-seed-copy marker; fall back to generic placeholder copy. */
export function displayCopy(raw: string): string {
  if (!raw.startsWith(SEED_COPY_MARKER)) return raw;
  const rest = raw
    .slice(SEED_COPY_MARKER.length)
    .replace(/^[\s:—–-]+/, "")
    .trim();
  return rest === "" ? PLACEHOLDER_COPY : rest;
}

/** True when the string is nothing but the pending marker. */
export function isPlaceholderCopy(raw: string): boolean {
  return displayCopy(raw) === PLACEHOLDER_COPY;
}

export const HOOK_STYLE_LABELS: Record<HookStyle, string> = {
  open_loop: "Open loop",
  bold_claim: "Bold claim",
  stakes: "Stakes",
  in_medias_res: "In medias res",
};

/** Human label for the words-per-minute pacing target. */
export function paceLabel(wpmTarget: number): string {
  if (wpmTarget <= 125) return "Unhurried";
  if (wpmTarget <= 150) return "Steady";
  if (wpmTarget <= 175) return "Brisk";
  return "Rapid-fire";
}

export const ENERGY_LABELS: Record<number, string> = {
  1: "Hushed",
  2: "Calm",
  3: "Balanced",
  4: "Lively",
  5: "Maximum hype",
};

export function energyLabel(energy: number): string {
  return ENERGY_LABELS[energy] ?? "Balanced";
}

/** Ordered hook technique tags from a style card (first = preferred). */
export function hookTechniques(card: StyleCard): HookStyle[] {
  return card.hookPatterns.map((p) => p.technique);
}

// ---------------------------------------------------------------------------
// Thumbnail preset swatch — abstract pattern rules rendered as a color chip.
// ---------------------------------------------------------------------------

export const PALETTE_SWATCH_CLASSES: Record<PaletteTemperature, string> = {
  warm: "bg-gradient-to-br from-amber-400 to-rose-500",
  cool: "bg-gradient-to-br from-sky-400 to-indigo-500",
  neutral: "bg-gradient-to-br from-zinc-300 to-zinc-500",
};

export const CONTRAST_RULE_LABELS: Record<ContrastRule, string> = {
  light_on_dark: "Light on dark",
  dark_on_light: "Dark on light",
  complementary: "Complementary",
};

export const PALETTE_TEMPERATURE_LABELS: Record<PaletteTemperature, string> = {
  warm: "Warm palette",
  cool: "Cool palette",
  neutral: "Neutral palette",
};
