import { TRPCError } from "@trpc/server";
import { getArchetypeSeed } from "@/lib/archetypes";
import type { GenerationTarget, StyleCard, VoiceProfile } from "@/lib/types/entities";
import type { VoiceProfileId, WorkspaceId } from "@/lib/types/ids";
import { mergeStyleCards } from "./crossover";
import { getPartnerSource, resolvePartnerCard, type PartnerSource } from "./partners";

/** The store read the trained-card lookup needs — the EngineStore satisfies it. */
export interface VoiceProfileLookup {
  getVoiceProfile(
    workspaceId: WorkspaceId,
    voiceProfileId: VoiceProfileId,
  ): Promise<VoiceProfile | null>;
}

/**
 * The voice profile a target should resolve against (WAVE-D-PLAN §2c). For
 * train_on_my_channel, the trained card lives on `generation.voiceProfileId`;
 * this loads that profile workspace-scoped (the injectable store lookup — the
 * ONE place tenancy is applied) unless the caller already holds it. For every
 * other mode the caller's existing profile is returned unchanged.
 */
export async function resolveTrainedVoiceProfile(
  lookup: VoiceProfileLookup,
  workspaceId: WorkspaceId,
  generation: GenerationTarget | null,
  fallback: VoiceProfile | null,
): Promise<VoiceProfile | null> {
  if (generation === null || generation.mode !== "train_on_my_channel") return fallback;
  if (generation.voiceProfileId === null) return fallback;
  if (fallback !== null && fallback.id === generation.voiceProfileId) return fallback;
  const loaded = await lookup.getVoiceProfile(workspaceId, generation.voiceProfileId);
  return loaded ?? fallback;
}

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
 *  - train_on_my_channel (D2, WAVE-D-PLAN §2c) → resolves the source="trained"
 *    voice profile's card. The target carries the trained profile's id; the
 *    caller loads that profile workspace-scoped (the store lookup — tenancy is
 *    enforced there, where workspaceId is known) and passes it as
 *    `voiceProfile`. The trained card lives on a voice_profiles row exactly
 *    like every other card, so this is a lookup, not new plumbing. When the id
 *    does not resolve to a trained card, a clear "train a voice first" error.
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
    case "train_on_my_channel": {
      // The trained card lives on the voice profile the target names. The
      // caller loaded it workspace-scoped and passed it here; a mismatch (no
      // profile, wrong id, or a non-trained source) means no trained card is
      // available for this selection — "train a voice first".
      if (
        generation.voiceProfileId === null ||
        voiceProfile === null ||
        voiceProfile.id !== generation.voiceProfileId ||
        voiceProfile.source !== "trained"
      ) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Train a voice from your channel first, then pick it here — no trained voice is set for this generation.",
        });
      }
      return voiceProfile.styleCard;
    }
  }
}
