import { bannedPhraseList } from "./banned-phrases";
import { jsonOnly } from "./shared";
import type { PromptTemplate } from "./version";

/**
 * Licensed-voice de-duplication rewrite (PRODUCT-CONTRACTS §7). Invoked ONLY
 * when the similarity guard flags a licensed-voice section as reproducing the
 * source too closely. The instruction is explicit: keep the VOICE, keep the
 * MEANING, but rephrase so no long run of words matches the source. This is
 * the single auto-rewrite the guard allows before it hard-fails.
 *
 * The offending phrases are surfaced so the model knows exactly what to break
 * up — but the source snippets themselves are NOT reproduced back into the
 * prompt beyond these short matched fragments.
 */

export interface DedupeRewriteInput {
  /** The section text that tripped the guard. */
  body: string;
  /** The 5-grams the worst window shared with the licensed source. */
  matchedNgrams: string[];
}

export function dedupeRewritePrompt(input: DedupeRewriteInput): PromptTemplate {
  const flagged =
    input.matchedNgrams.length > 0
      ? input.matchedNgrams.map((g) => `- "${g}"`).join("\n")
      : "(no specific fragments isolated — rephrase the whole passage)";
  return {
    system: [
      "You rewrite a passage so it no longer reproduces licensed source",
      "material verbatim. Keep the SAME meaning, facts, structure, and the",
      "creator's voice and rhythm — this is a paraphrase for originality, not",
      "an edit for content. Requirements:",
      "(1) Break up every flagged word-run: no run of five or more consecutive",
      "words may survive unchanged. Recast the sentence, reorder the idea,",
      "swap phrasing — do not just replace one word in the middle.",
      "(2) Do not add new claims or drop load-bearing ones.",
      "(3) Keep the length within 10% of the original.",
      `(4) Never use these banned phrases:\n${bannedPhraseList()}`,
    ].join(" "),
    prompt: [
      "Flagged fragments (each reproduces the source — none may remain intact):",
      flagged,
      "",
      "Passage to rewrite:",
      input.body,
      "",
      jsonOnly(`{"body": "<the rewritten passage, same meaning, original wording>"}`),
    ].join("\n"),
  };
}
