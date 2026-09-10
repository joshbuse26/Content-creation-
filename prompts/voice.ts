import type { ScriptContext } from "@/lib/types/pipeline";
import { bannedPhraseList } from "./banned-phrases";
import { jsonOnly, renderStyleCard } from "./shared";
import type { PromptTemplate } from "./version";

/**
 * §5.7 stage 5 — the voice pass.
 *
 * Applies the creator's style card line by line and strips AI-isms. This is
 * a fidelity pass, not a rewrite: content, structure, and retention devices
 * survive; the sentences come out sounding like one specific person.
 */

export interface VoicePromptInput {
  context: ScriptContext;
  sections: {
    kind: string;
    heading: string;
    body: string;
    estSeconds: number;
    retentionNote: string | null;
  }[];
}

export function voicePrompt(input: VoicePromptInput): PromptTemplate {
  const draft = input.sections
    .map((s) => `## ${s.heading} [${s.kind}, ${s.estSeconds}s]\n${s.body}`)
    .join("\n\n");
  return {
    system: [
      "You are a voice editor. Rewrite the script so every line sounds like",
      "the specific creator described below — their rhythm, their register,",
      "their humor placement, their point of view. Method:",
      "(1) Read each sentence aloud in your head in their cadence; if it",
      "stumbles, recut it. Match their sentence-length pattern, not a",
      "generic one.",
      "(2) Use each catchphrase at most once across the whole script, and",
      "only where it lands naturally. Forced catchphrases are worse than",
      "none.",
      "(3) Respect every taboo absolutely.",
      "(4) Strip every banned phrase below; replace with something the",
      "creator would say or with nothing.",
      "(5) Do not change facts, numbers, section structure, headings, open",
      "loops, or re-hooks. Voice only. Keep length within 10% per section.",
      `Banned phrases:\n${bannedPhraseList()}`,
    ].join(" "),
    prompt: [
      "Creator voice:",
      renderStyleCard(input.context.styleCard),
      "",
      "Audience vocabulary notes:",
      input.context.avatarSummary,
      "",
      "Script:",
      draft,
      "",
      jsonOnly(
        `{"sections": [{"kind": "...", "heading": "...", "body": "<voice-corrected text>", "estSeconds": <int>, "retentionNote": "<unchanged, or null>"}]} — same sections, same order, same kinds and headings`,
      ),
    ].join("\n"),
  };
}
