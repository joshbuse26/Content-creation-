import type { StyleCard, VoiceProfile } from "@/lib/types/entities";

/**
 * Multi-voice resolution (PRODUCT-CONTRACTS §7 / spec §5.7) — pure helpers
 * shared by the draft pipeline and the router. A script has ONE script-level
 * style card; a section may override it with its own voice profile. These
 * functions are the single definition of "effective voice", so the pipeline
 * and the editor never drift.
 *
 * Additive by construction: with no section override, every helper returns
 * exactly the script-level value, so a single-voice script behaves precisely
 * as it did before multi-voice existed.
 */

/**
 * The style card a section is actually written in: its own voice override's
 * card when set, otherwise the script-level card (which may itself be null on
 * the legacy card-less path).
 */
export function effectiveSectionStyleCard(
  sectionOverride: VoiceProfile | null,
  scriptCard: StyleCard | null,
): StyleCard | null {
  return sectionOverride?.styleCard ?? scriptCard;
}

/**
 * The licensed voice profile a section must be similarity-guarded against, or
 * null when neither the section override nor the script-level voice is
 * licensed. A section override wins over the script-level voice, so assigning
 * a NON-licensed voice to one section of a licensed-voice script lifts the
 * guard for that section (and vice versa).
 */
export function licensedGuardProfile(
  sectionOverride: VoiceProfile | null,
  scriptProfile: VoiceProfile | null,
): VoiceProfile | null {
  const effective = sectionOverride ?? scriptProfile;
  return effective !== null && effective.source === "licensed" ? effective : null;
}

/**
 * The licensed source corpus a section's output is checked against — the
 * licensed card's original example snippets (the only creator source material
 * held in-repo; transcripts, when a transcript provider is wired, append
 * here). Empty corpus ⇒ the guard cannot fire (analyzeSimilarity returns 0).
 */
export function licensedSourceCorpus(profile: VoiceProfile): string[] {
  return profile.styleCard.exampleSnippets.filter((s) => s.trim().length > 0);
}
