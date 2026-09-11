/**
 * Named-creator "sound-alike" claim patterns (PRODUCT-CONTRACTS §7).
 *
 * The product may never CLAIM to "sound (exactly) like" / "write like" a named
 * real creator, or to write "in <Name>'s voice". This is the single source of
 * truth for that CONSERVATIVE pattern set — the build-time copy-lint test
 * (tests/copy-lint.test.ts) scans marketing/UI source with it, and the runtime
 * guards (voiceProfile.rename, train_on_my_channel card naming) run the SAME
 * patterns against user-supplied / derived names so a clean card can never be
 * renamed into a named-creator claim after creation (D2 P1-3).
 *
 * "<ProperNoun>" is approximated as a capitalized word (optionally two, e.g. a
 * first + last name). High-precision on purpose: generic phrases ("sounds like
 * a pro", "sounds like you") never match because "a"/"you"/"the" are lowercase.
 *
 * The VERB's first letter is a two-case class ([Ss]ounds?, [Ww]rite…) rather
 * than an `/i` flag: a sentence-initial or user-typed capitalized verb
 * ("Sounds like Casey" from a rename) must trip, but the NAME must stay
 * case-SENSITIVE ([A-Z]) so a lowercase common word ("sounds like you") never
 * does. This is the single list for both the build-time copy-lint scan and the
 * runtime name guards.
 */
export const NAMED_CREATOR_CLAIM_PATTERNS: readonly RegExp[] = [
  /\b[Ss]ounds?\s+exactly\s+like\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?/g,
  /\b[Ss]ounds?\s+like\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?/g,
  /\b[Ww]rites?\s+like\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?/g,
  /\b[Ww]rite\s+like\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?/g,
  /\b[Ii]n\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?(?:'|’)s\s+voice\b/g,
  /\b[Jj]ust\s+like\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?\s+(?:writes|scripts|talks)\b/g,
];

/**
 * True iff `text` claims to sound/write like a named real creator (or in a
 * named creator's voice). Pure and stateless — resets each pattern's lastIndex
 * so a shared global-flagged RegExp is safe to reuse across calls.
 */
export function claimsSoundsLikeNamedCreator(text: string): boolean {
  return NAMED_CREATOR_CLAIM_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}
