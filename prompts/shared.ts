import type { StyleCard } from "@/lib/types/entities";
import type { ScriptContext } from "@/lib/types/pipeline";

/**
 * Shared rendering helpers for prompt templates. These format structured
 * context (frame, avatar, style card, research) into consistent prompt
 * blocks so every stage sees the same vocabulary.
 */

export function renderFrame(frame: ScriptContext["frame"]): string {
  return [
    `Angle: ${frame.angle}`,
    `Format: ${frame.format}`,
    `Primary outcome to optimize: ${frame.outcome === "subs" ? "new subscribers" : frame.outcome === "watch_time" ? "watch time / retention" : "conversion to an off-platform action"}`,
    `Audience segment: ${frame.audienceSegment}`,
    `Tone: ${frame.tone}`,
    `Target length: ${frame.targetMinutes} minutes (~${frame.targetMinutes * 150} words at speaking pace)`,
    frame.keywords.length > 0 ? `Keywords to work in naturally: ${frame.keywords.join(", ")}` : "",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/** Snippets pending seed copy are placeholders, never shown to the LLM. */
const isPlaceholderSnippet = (s: string): boolean => s.includes("TODO(seed-copy)");

export function renderStyleCard(card: StyleCard | null): string {
  if (card === null) {
    return [
      "No creator voice profile is set. Write in a natural, conversational",
      'spoken register: contractions, direct address ("you"), first person,',
      "sentences a person can say in one breath.",
    ].join(" ");
  }
  const snippets = card.exampleSnippets.filter((s) => !isPlaceholderSnippet(s));
  const hookLines = card.hookPatterns
    .map((p, i) => `  ${i + 1}. ${p.technique}: ${p.guidance}`)
    .join("\n");
  const cta = card.ctaHabits;
  const ctaPlacement =
    cta.placement === "timestamp_pct"
      ? `around ${cta.placementPct ?? 50}% of runtime`
      : cta.placement === "after_payoff"
        ? "directly after a chapter's payoff"
        : "at the end only, after the last chapter";
  return [
    `Point of view: ${card.voice.pov}`,
    `Diction: ${card.voice.diction}`,
    `Sentence rhythm: ${card.voice.rhythm}`,
    `Tone: ${card.tone.register}`,
    `Never: ${card.tone.never}`,
    `Pacing: ~${card.pacing.wpmTarget} words/min spoken; sections around ${card.pacing.sectionSeconds}s; re-hook the viewer every ~${card.pacing.rehookSeconds}s.`,
    `Allowed hook techniques (in preference order):\n${hookLines}`,
    `CTA habits: at most ${cta.maxPerVideo} per video, placed ${ctaPlacement}. Phrasing: ${cta.phrasingStyle}`,
    card.bannedClaims.length > 0
      ? `Banned claim types (hard rules, machine-checked): ${card.bannedClaims.join(", ")}.`
      : "Banned claim types: none listed, but never promise guaranteed results.",
    `Target reading level: US grade ${card.readingLevel.minGrade}-${card.readingLevel.maxGrade}.`,
    `Energy: ${card.energy}/5.`,
    snippets.length > 0
      ? `Example passages in this voice:\n${snippets.map((s) => `  - ${s}`).join("\n")}`
      : "",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export function renderResearch(research: ScriptContext["research"]): string {
  if (research.length === 0) {
    return "No research documents attached. Do not invent statistics, studies, prices, or named sources — write from general knowledge and flag nothing as fact.";
  }
  return research
    .map((doc) => `### [doc:${doc.researchDocId}] ${doc.title}\n${doc.excerpt}`)
    .join("\n\n");
}

/** Common instruction for every stage that must return machine-readable JSON. */
export function jsonOnly(shapeDescription: string): string {
  return [
    "Respond with a single JSON object and nothing else — no markdown fences,",
    "no commentary before or after. The JSON must match this shape exactly:",
    shapeDescription,
  ].join("\n");
}

/** Rough token estimate (chars/4) used for context budgeting. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
