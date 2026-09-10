import type { Outline, ScriptContext } from "@/lib/types/pipeline";
import { bannedPhraseList } from "./banned-phrases";
import { jsonOnly, renderFrame, renderResearch, renderStyleCard } from "./shared";
import type { PromptTemplate } from "./version";

/**
 * §5.7 stage 3 — drafting: the hook, then each section in sequence.
 *
 * The hook gets three candidates in distinct techniques because hooks are
 * the highest-variance sentence in the video. Sections are drafted one at a
 * time with everything already written in front of the model, so callbacks,
 * running bits, and open loops stay coherent across the script.
 */

export interface HookPromptInput {
  context: ScriptContext;
  outline: Outline;
}

export function hookPrompt(input: HookPromptInput): PromptTemplate {
  const { frame } = input.context;
  return {
    system: [
      "You write YouTube hooks — the first 15-30 spoken seconds that decide",
      "whether the video gets watched. Write three candidates, one per",
      "technique:",
      "open_loop — pose a specific question or withhold a specific result",
      "the video will resolve; name WHEN it resolves if you can ('by the end",
      "of round three'). The loop must be concrete enough to itch.",
      "bold_claim — lead with the video's most defensible surprising claim,",
      "stated plainly, no hedging. The body must actually back it.",
      "stakes — open on what the viewer stands to lose or gain in their own",
      "life: money wasted, time lost, an outcome they want. Make the cost",
      "concrete and personal.",
      "in_medias_res — drop into the most dramatic moment of the video",
      "mid-action, then pull back. Present tense. No throat-clearing.",
      "All three: speak in the creator's voice, 40-75 words, no greeting, no",
      "channel-welcome, first sentence under 12 words. These phrases are",
      `banned:\n${bannedPhraseList()}`,
    ].join(" "),
    prompt: [
      "Frame:",
      renderFrame(frame),
      "",
      "Creator voice:",
      renderStyleCard(input.context.styleCard),
      "",
      "The video's outline (so the hook promises what the video delivers):",
      input.outline.sections.map((s) => `- [${s.kind}] ${s.heading}: ${s.purpose}`).join("\n"),
      "",
      "Audience:",
      input.context.avatarSummary,
      "",
      jsonOnly(
        `{"candidates": [{"style": "open_loop", "body": "..."}, {"style": "bold_claim", "body": "..."}, {"style": "stakes", "body": "..."}]} — you may substitute "in_medias_res" for at most one of the three styles if the material demands it; exactly 3 candidates, 3 distinct styles`,
      ),
    ].join("\n"),
  };
}

export interface SectionPromptInput {
  context: ScriptContext;
  outline: Outline;
  /** Index into outline.sections of the section being drafted. */
  sectionIndex: number;
  /** Everything drafted so far, in order, including the chosen hook. */
  priorSections: { kind: string; heading: string; body: string }[];
}

export function sectionPrompt(input: SectionPromptInput): PromptTemplate {
  const target = input.outline.sections[input.sectionIndex];
  if (target === undefined) {
    throw new Error(`sectionPrompt: no outline section at index ${input.sectionIndex}`);
  }
  const targetWords = Math.round(target.targetSeconds * 2.5);
  const prior =
    input.priorSections.length > 0
      ? input.priorSections.map((s) => `## ${s.heading} [${s.kind}]\n${s.body}`).join("\n\n")
      : "(nothing drafted yet)";
  const kindGuidance: Record<string, string> = {
    intro:
      "Set the rules and the stakes fast. The viewer already clicked — do not re-sell the video, advance it. End on a forward pull toward the first chapter.",
    chapter:
      "Deliver the section's purpose with specifics: numbers, steps, moments, named things from the research. One idea per breath. When you use a research fact, quote its substance faithfully — the script is fact-checked against the research documents. Close by tipping into the next section, not by summarizing this one.",
    cta: "One ask, earned by what the viewer just got, tied to this video's content. Under 45 words. No begging, no bell talk.",
    outro:
      "Land the ending in 2-3 sentences: the single takeaway, then a bridge to what's next. End on a sentence someone would actually say out loud, not a fade-out.",
  };
  return {
    system: [
      "You are drafting one section of a YouTube script, in sequence, in the",
      "creator's voice. This is SPOKEN language: contractions, direct",
      "address, sentences that fit in one breath, paragraph breaks where the",
      "delivery pauses. Continuity is your job — honor every open loop,",
      "callback, and running bit already on the page, and never re-introduce",
      "the video or the creator mid-script. Do not use headings, stage",
      "directions, or bullet lists in the body — pure voiceover text.",
      `These phrases are banned:\n${bannedPhraseList()}`,
    ].join(" "),
    prompt: [
      "Frame:",
      renderFrame(input.context.frame),
      "",
      "Creator voice:",
      renderStyleCard(input.context.styleCard),
      "",
      "Research (use faithfully; do not invent facts beyond it):",
      renderResearch(input.context.research),
      "",
      "Script so far:",
      prior,
      "",
      "Now draft THIS section:",
      `Heading: ${target.heading}`,
      `Kind: ${target.kind}`,
      `Purpose: ${target.purpose}`,
      `Retention device: ${target.retentionNote}`,
      `Length: about ${targetWords} words (${target.targetSeconds} seconds spoken).`,
      kindGuidance[target.kind] ?? "",
      "",
      jsonOnly(`{"body": "<the spoken text of this section only>"}`),
    ]
      .filter((l) => l !== "")
      .join("\n"),
  };
}

export interface RegenerateSectionPromptInput {
  context: ScriptContext;
  section: { kind: string; heading: string; body: string; estSeconds: number };
  priorSections: { kind: string; heading: string; body: string }[];
  followingSections: { kind: string; heading: string; body: string }[];
  guidance: string | null;
}

export function regenerateSectionPrompt(input: RegenerateSectionPromptInput): PromptTemplate {
  const targetWords = Math.round(input.section.estSeconds * 2.5);
  return {
    system: [
      "You are rewriting ONE section of an existing YouTube script. The",
      "sections around it are fixed — your rewrite must connect seamlessly",
      "to what comes before and set up what comes after. Keep the section's",
      "job and approximate length; change the execution. Spoken language",
      `only, creator's voice. Banned phrases:\n${bannedPhraseList()}`,
    ].join(" "),
    prompt: [
      "Frame:",
      renderFrame(input.context.frame),
      "",
      "Creator voice:",
      renderStyleCard(input.context.styleCard),
      "",
      "Preceding sections:",
      input.priorSections.map((s) => `## ${s.heading}\n${s.body}`).join("\n\n") || "(none)",
      "",
      "Section to rewrite:",
      `## ${input.section.heading} [${input.section.kind}]`,
      input.section.body,
      "",
      "Following sections (must still flow from your rewrite):",
      input.followingSections.map((s) => `## ${s.heading}\n${s.body}`).join("\n\n") || "(none)",
      "",
      input.guidance !== null
        ? `The creator's instruction for this rewrite: ${input.guidance}`
        : "",
      `Length: about ${targetWords} words.`,
      "",
      jsonOnly(`{"body": "<the rewritten spoken text>"}`),
    ]
      .filter((l) => l !== "")
      .join("\n"),
  };
}
