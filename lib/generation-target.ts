import type { GenerationTarget } from "@/lib/types/entities";

/**
 * Generation-target → mode-column normalization (wave-C adversarial F8) —
 * THE single mapping from a validated GenerationTarget to the mode columns
 * stored on projects (setGenerationTarget) and scripts (createScript).
 *
 * The Zod schema only requires the field its mode needs; it does not forbid
 * cross-mode residue (e.g. a crossover target arriving with a stray
 * partnerId). Rows must never carry that residue — every field that does
 * not belong to the target's mode is stored NULL.
 */

export interface GenerationTargetColumns {
  generationMode: GenerationTarget["mode"] | null;
  archetypeId: GenerationTarget["archetypeId"];
  crossover: GenerationTarget["crossover"];
  partnerId: GenerationTarget["partnerId"];
}

export function generationTargetColumns(
  generation: GenerationTarget | null,
): GenerationTargetColumns {
  if (generation === null) {
    return { generationMode: null, archetypeId: null, crossover: null, partnerId: null };
  }
  return {
    generationMode: generation.mode,
    archetypeId: generation.mode === "archetype" ? generation.archetypeId : null,
    crossover: generation.mode === "crossover" ? generation.crossover : null,
    partnerId: generation.mode === "partnered_named" ? generation.partnerId : null,
  };
}
