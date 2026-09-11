import { BANNED_CLAIM_TYPES, HOOK_STYLES } from "@/lib/types/enums";
import { jsonOnly } from "./shared";
import type { PromptTemplate } from "./version";

/**
 * train_on_my_channel derivation (WAVE-D-PLAN §2c) — derive a structured
 * StyleCard from a channel's OWN transcripts, or the STRUCTURAL patterns of
 * competitor transcripts (a remix that produces an ORIGINAL card).
 *
 * Two guardrails are baked into the instructions and re-checked in code:
 *  - remix: the model captures cadence/structure only, writes FRESH original
 *    example lines, and may never copy competitor wording or name a real
 *    creator (re-verified by lib/seed-lint + lib/similarity-guard);
 *  - own channel: example passages may be short lines in the creator's own
 *    voice — it is their own channel — but stay short.
 */

export interface TrainVoicePromptInput {
  /** Display name for the channel the card is derived FROM (own or competitor). */
  channelTitle: string;
  /** Transcript full-texts sampled from the source channel(s). */
  transcripts: readonly string[];
  /** True ⇒ competitor remix (structure only, original snippets, no names). */
  remix: boolean;
}

export function trainVoicePrompt(input: TrainVoicePromptInput): PromptTemplate {
  const transcriptBlock = input.transcripts
    .map((t, i) => `--- transcript ${i + 1} ---\n${t}`)
    .join("\n\n");

  const remixRules = [
    "This is a COMPETITOR REMIX. Capture only the STRUCTURAL patterns — pacing,",
    "hook cadence, CTA habits, energy, sentence rhythm. Do NOT reproduce any of",
    "the competitor's wording, catchphrases, or examples. Every exampleSnippet",
    "must be an ORIGINAL line you write fresh in the derived style — never a span",
    "copied or lightly edited from the transcripts. The card must carry NO real",
    "person's name anywhere (voice, tone, snippets): this is an original card",
    "inspired by structure, not a clone of a named creator.",
  ].join(" ");

  const ownRules = [
    "This is the creator's OWN channel. Derive the voice faithfully. exampleSnippets",
    "may be SHORT lines in the creator's own spoken voice (2–4 of them, each under",
    "a couple of sentences) — never long pasted passages.",
  ].join(" ");

  return {
    system: [
      "You distill a YouTube creator's spoken style into a structured StyleCard.",
      "You are given transcripts; you return ONE JSON StyleCard describing how the",
      "voice works — never the transcript content itself.",
      input.remix ? remixRules : ownRules,
      `Allowed hook techniques: ${HOOK_STYLES.join(", ")}.`,
      `Allowed bannedClaims values: ${BANNED_CLAIM_TYPES.join(", ")}.`,
      "energy is 1 (hushed) to 5 (maximum hype). readingLevel is a US grade band.",
    ].join(" "),
    prompt: [
      `Source channel: ${input.channelTitle}`,
      "",
      "Transcripts:",
      transcriptBlock,
      "",
      "Derive the StyleCard.",
      "",
      jsonOnly(
        [
          "{",
          '  "voice": {"pov": "...", "diction": "...", "rhythm": "..."},',
          '  "tone": {"register": "...", "never": "..."},',
          '  "pacing": {"wpmTarget": 150, "sectionSeconds": 90, "rehookSeconds": 75},',
          '  "hookPatterns": [{"technique": "open_loop", "guidance": "..."}],',
          '  "ctaHabits": {"placement": "after_payoff", "placementPct": null, "phrasingStyle": "...", "maxPerVideo": 1},',
          '  "bannedClaims": [],',
          '  "readingLevel": {"minGrade": 6, "maxGrade": 9},',
          '  "energy": 3,',
          '  "exampleSnippets": ["...", "..."],',
          '  "thumbnailPresetId": null',
          "}",
        ].join("\n"),
      ),
    ].join("\n"),
  };
}
