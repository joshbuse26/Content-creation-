import { TRPCError } from "@trpc/server";
import { getConfig } from "@/lib/config";
import { licensedSourceCorpus } from "@/lib/multi-voice";
import { tokenizeWords } from "@/lib/similarity-guard";
import type { GenerationTarget, VoiceProfile } from "@/lib/types/entities";
import type { GenerationMode } from "@/lib/types/enums";

/**
 * A usable licensed voice must carry enough source material for the similarity
 * guard to have something to check against — at least one snippet of this many
 * normalized tokens. Combined with the guard's fail-closed on an empty corpus,
 * this guarantees a licensed voice can NEVER generate ungated (PRODUCT-CONTRACTS
 * §7). Five tokens is the guard's upper n-gram size, so a snippet at this length
 * populates every check (containment, verbatim run, and the windowed ratio).
 */
export const MIN_LICENSED_SNIPPET_TOKENS = 5;

/** True iff the profile's snippet corpus carries at least one non-trivial span. */
function hasSubstantialLicensedCorpus(profile: VoiceProfile): boolean {
  return licensedSourceCorpus(profile).some(
    (snippet) => tokenizeWords(snippet).length >= MIN_LICENSED_SNIPPET_TOKENS,
  );
}

/**
 * Generation-mode guards (PRODUCT-CONTRACTS §3) — the SHARED server module
 * every dispatch site must call before doing mode-driven work. The Zod
 * schema (generationTargetSchema) enforces shape consistency; this module
 * enforces availability:
 *
 *  - partnered_named: rejected unless FEATURE_PARTNERED_NAMED is on. Even
 *    with the flag on, C1's resolver must additionally verify the partner
 *    row is `enabled` (which the DB CHECK ties to signed license fields).
 *  - train_on_my_channel (D2, WAVE-D-PLAN §2c): now ALLOWED at the mode level.
 *    The target carries the trained voice profile's id (the schema requires it),
 *    and pipelines/stages/style-resolver.ts resolves that source="trained"
 *    card — throwing a clear "train a voice first" error if the id does not
 *    resolve to a trained card. The mode guard no longer rejects it (the real
 *    derivation ships in server/voice/train.ts + voice.trainFromChannel).
 */

export function isPartneredNamedEnabled(): boolean {
  return getConfig().FEATURE_PARTNERED_NAMED;
}

/** Throws unless the requested mode is currently available. */
export function assertGenerationModeAllowed(mode: GenerationMode): void {
  if (mode === "partnered_named" && !isPartneredNamedEnabled()) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Partnered creator voices are not available on this deployment.",
    });
  }
  // train_on_my_channel: available (D2). Whether a trained card actually
  // exists for the selected voiceProfileId is enforced at resolution time
  // (style-resolver), where the profile is loaded — that is the layer that
  // can say "train a voice first" with the channel in hand.
}

/**
 * Guard for procedure inputs carrying an optional generation target: null
 * (legacy voice-profile flow) passes; otherwise the mode must be allowed.
 */
export function assertGenerationTargetAllowed(generation: GenerationTarget | null): void {
  if (generation === null) return;
  assertGenerationModeAllowed(generation.mode);
}

/**
 * A licensed voice profile is USABLE only with a signed license on file
 * (PRODUCT-CONTRACTS §7). The DB CHECK and voiceProfileSchema already forbid
 * PERSISTING a licensed profile without both license fields; this is the
 * dispatch-time gate that additionally refuses to GENERATE with one that
 * somehow lacks recorded consent (defense in depth, and the seam where a
 * future "guard disabled" state would also be rejected). Non-licensed
 * profiles and the card-less path pass untouched.
 */
export function assertLicensedVoiceUsable(profile: VoiceProfile | null): void {
  if (profile === null || profile.source !== "licensed") return;
  if (profile.licenseSignedAt === null || profile.licenseDocUrl === null) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "This licensed voice can't be used until its signed license is on file. " +
        "Add the license document and consent, then try again.",
    });
  }
  // A licensed voice with no/short source material would leave the similarity
  // guard with nothing to check against — verbatim reproduction could then slip
  // through ungated (P2-7). Require real material at the app boundary; combined
  // with the guard's fail-closed on an empty corpus, a licensed voice can never
  // generate ungated. (Enforced here rather than in voiceProfileSchema so the
  // DB CHECK on license columns stays the schema's concern; a schema/migration
  // corpus check would be an equivalent but heavier alternative.)
  if (!hasSubstantialLicensedCorpus(profile)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "This licensed voice has no usable source material on file. Add at least one " +
        `example passage of ${String(MIN_LICENSED_SNIPPET_TOKENS)} words or more so its output ` +
        "can be checked for verbatim reproduction, then try again.",
    });
  }
}
