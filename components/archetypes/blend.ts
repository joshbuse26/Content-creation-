import type { Archetype, CrossoverBlend, GenerationTarget } from "@/lib/types/entities";
import type { ArchetypeId, HookStyle } from "@/lib/types/enums";

/**
 * Crossover blend display logic (wave C2) — CLIENT-SIDE PREVIEW ONLY.
 *
 * The server's style-card merge (C1) is authoritative for generation; this
 * module only computes the live "blend summary" the picker shows while the
 * user drags the weight slider: pacing/energy linear interpolation and the
 * union of hook-technique chips (heavier archetype's techniques first).
 */

export interface BlendSummary {
  /** The archetype carrying weight >= 0.5 (ties go to A). */
  dominant: ArchetypeId;
  wpmTarget: number;
  sectionSeconds: number;
  rehookSeconds: number;
  energy: number;
  /** Union of both cards' techniques — heavier card's order first, deduped. */
  hookTechniques: HookStyle[];
  /** e.g. "60% Calm Explainer · 40% Hype Gamer". */
  label: string;
}

export function clampWeight(weightA: number): number {
  if (Number.isNaN(weightA)) return 0.5;
  return Math.min(1, Math.max(0, weightA));
}

function lerp(a: number, b: number, weightA: number): number {
  return Math.round(a * weightA + b * (1 - weightA));
}

export function blendSummary(a: Archetype, b: Archetype, weightARaw: number): BlendSummary {
  const weightA = clampWeight(weightARaw);
  const heavier = weightA >= 0.5 ? a : b;
  const lighter = weightA >= 0.5 ? b : a;
  const techniques: HookStyle[] = [];
  for (const card of [heavier.styleCard, lighter.styleCard]) {
    for (const pattern of card.hookPatterns) {
      if (!techniques.includes(pattern.technique)) techniques.push(pattern.technique);
    }
  }
  const pctA = Math.round(weightA * 100);
  return {
    dominant: heavier.id,
    wpmTarget: lerp(a.styleCard.pacing.wpmTarget, b.styleCard.pacing.wpmTarget, weightA),
    sectionSeconds: lerp(
      a.styleCard.pacing.sectionSeconds,
      b.styleCard.pacing.sectionSeconds,
      weightA,
    ),
    rehookSeconds: lerp(
      a.styleCard.pacing.rehookSeconds,
      b.styleCard.pacing.rehookSeconds,
      weightA,
    ),
    energy: lerp(a.styleCard.energy, b.styleCard.energy, weightA),
    hookTechniques: techniques,
    label: `${pctA}% ${a.displayName} · ${100 - pctA}% ${b.displayName}`,
  };
}

// ---------------------------------------------------------------------------
// Generation-target builders — the exact shapes the frozen
// generationTargetSchema accepts (per-mode required refs).
// ---------------------------------------------------------------------------

export function archetypeTarget(archetypeId: ArchetypeId): GenerationTarget {
  return {
    mode: "archetype",
    archetypeId,
    crossover: null,
    partnerId: null,
    voiceProfileId: null,
  };
}

export function crossoverTarget(blend: CrossoverBlend): GenerationTarget {
  return {
    mode: "crossover",
    archetypeId: null,
    crossover: { ...blend, weightA: clampWeight(blend.weightA) },
    partnerId: null,
    voiceProfileId: null,
  };
}
