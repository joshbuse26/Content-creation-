/**
 * Banned AI-isms — phrases that make a script read like it was generated.
 *
 * The voice pass instructs the model to remove them; countBannedPhrases()
 * lets code verify the result and the quality gate surface leftovers as
 * warnings. Keep entries lowercase; matching is case-insensitive and
 * word-boundary aware.
 */
export const BANNED_PHRASES: readonly string[] = [
  // Throat-clearing openers
  "in today's video",
  "in this video, we will",
  "welcome back to the channel",
  "without further ado",
  "let's dive in",
  "let's dive right in",
  "let's jump right in",
  "buckle up",
  "strap in",
  // Essay filler
  "in today's fast-paced world",
  "in the ever-evolving landscape",
  "in the world of",
  "when it comes to",
  "at the end of the day",
  "the fact of the matter is",
  "needless to say",
  "it goes without saying",
  "it's important to note",
  "it's worth noting",
  "it is worth mentioning",
  "as we all know",
  "as mentioned earlier",
  "last but not least",
  // Overcooked transitions
  "with that being said",
  "that being said",
  "moving on to",
  "now, let's talk about",
  "let's take a closer look",
  "delve into",
  "delving into",
  "embark on a journey",
  "take a deep dive",
  // Inflated adjectives and hedges
  "game-changer",
  "game changing",
  "revolutionize",
  "revolutionizing",
  "unleash",
  "unlock the power",
  "unlock the secrets",
  "harness the power",
  "elevate your",
  "supercharge",
  "seamlessly",
  "effortlessly",
  "a plethora of",
  "a myriad of",
  "truly remarkable",
  "nothing short of",
  // Robotic wrap-ups
  "in conclusion",
  "to sum up",
  "to summarize",
  "in summary",
  "i hope you found this helpful",
  "don't forget to like and subscribe",
  "smash that like button",
  "hit that notification bell",
];

const patterns = BANNED_PHRASES.map(
  (p) => new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"),
);

/** Which banned phrases appear in the text (each reported once). */
export function findBannedPhrases(text: string): string[] {
  const found: string[] = [];
  for (let i = 0; i < patterns.length; i++) {
    const pattern = patterns[i];
    const phrase = BANNED_PHRASES[i];
    if (pattern !== undefined && phrase !== undefined && pattern.test(text)) {
      found.push(phrase);
    }
  }
  return found;
}

/** Rendered as a bullet list inside voice-pass and drafting prompts. */
export function bannedPhraseList(): string {
  return BANNED_PHRASES.map((p) => `- "${p}"`).join("\n");
}
