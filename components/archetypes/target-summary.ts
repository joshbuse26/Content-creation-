import type { Archetype, GenerationTarget } from "@/lib/types/entities";

/** Short human label for a generation target ("Calm Explainer", a blend, …). */
export function targetLabel(
  target: GenerationTarget | null,
  archetypes: readonly Archetype[],
): string {
  if (target === null) return "Channel voice";
  const name = (id: string | null) => archetypes.find((a) => a.id === id)?.displayName ?? id ?? "?";
  switch (target.mode) {
    case "archetype":
      return name(target.archetypeId);
    case "crossover": {
      const blend = target.crossover;
      if (blend === null) return "Crossover";
      const pctA = Math.round(blend.weightA * 100);
      return `${pctA}% ${name(blend.a)} · ${100 - pctA}% ${name(blend.b)}`;
    }
    case "partnered_named":
      return "Partnered voice";
    case "train_on_my_channel":
      return "Trained voice";
  }
}
