import { TRPCError } from "@trpc/server";
import { getArchetypeSeed } from "@/lib/archetypes";
import type { GenerationTarget, StyleCard, VoiceProfile } from "@/lib/types/entities";
import { mergeStyleCards } from "./crossover";
import { getPartnerSource, resolvePartnerCard, type PartnerSource } from "./partners";

/**
 * Mode → style card resolution (PRODUCT-CONTRACTS §3) — the ONE resolver
 * every staged procedure and the script pipeline share. Callers must run
 * `assertGenerationTargetAllowed` (server/modes.ts) FIRST — this function
 * resolves, it does not gate.
 *
 *  - null → the voice profile's card, or null (the LEGACY flow, unchanged:
 *    voiceProfileId alone drives the card, exactly as pre-wave-C).
 *  - archetype → the seeded archetype's card.
 *  - crossover → deterministic merge of both archetypes' cards
 *    (pipelines/stages/crossover.ts documents the rules).
 *  - partnered_named → the enabled partner's card (flag enforced upstream;
 *    record-level checks in pipelines/stages/partners.ts).
 *  - train_on_my_channel → rejected upstream (server/modes.ts) in this wave;
 *    unreachable here until D2. RESOLUTION SEAM (WAVE-D-PLAN §2c): once a
 *    source="trained" voice profile exists for the channel, D2 resolves its
 *    styleCard here (first-class alongside archetype cards) instead of
 *    throwing — the trained card lives on a voice_profiles row exactly like
 *    every other card, so this becomes a lookup, not new plumbing.
 */
export async function resolveStyleCard(
  generation: GenerationTarget | null,
  voiceProfile: VoiceProfile | null,
  partners: PartnerSource = getPartnerSource(),
): Promise<StyleCard | null> {
  if (generation === null) return voiceProfile?.styleCard ?? null;
  switch (generation.mode) {
    case "archetype": {
      const seed =
        generation.archetypeId === null ? null : getArchetypeSeed(generation.archetypeId);
      if (seed === null) {
        throw new TRPCError({ code: "NOT_FOUND", message: "archetype not found" });
      }
      return seed.styleCard;
    }
    case "crossover": {
      const blend = generation.crossover;
      if (blend === null) {
        throw new TRPCError({ code: "NOT_FOUND", message: "crossover blend not found" });
      }
      const seedA = getArchetypeSeed(blend.a);
      const seedB = getArchetypeSeed(blend.b);
      if (seedA === null || seedB === null) {
        throw new TRPCError({ code: "NOT_FOUND", message: "archetype not found" });
      }
      return mergeStyleCards(seedA.styleCard, seedB.styleCard, blend.weightA);
    }
    case "partnered_named": {
      if (generation.partnerId === null) {
        throw new TRPCError({ code: "NOT_FOUND", message: "partner not found" });
      }
      return resolvePartnerCard(generation.partnerId, partners);
    }
    case "train_on_my_channel":
      // TODO(D2): resolve the channel's source="trained" voice profile card
      // here (WAVE-D-PLAN §2c resolution seam). assertGenerationTargetAllowed
      // rejects this mode before any resolver runs today; reaching here means
      // a dispatch site skipped the guard.
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: "Training on your own channel is not available yet.",
      });
  }
}
