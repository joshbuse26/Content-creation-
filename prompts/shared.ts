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

export function renderStyleCard(card: StyleCard | null): string {
  if (card === null) {
    return [
      "No creator voice profile is set. Write in a natural, conversational",
      "spoken register: contractions, direct address (\"you\"), first person,",
      "sentences a person can say in one breath.",
    ].join(" ");
  }
  return [
    `Rhythm: ${card.rhythm}`,
    `Register: ${card.register}`,
    card.catchphrases.length > 0
      ? `Catchphrases (use sparingly, at most once each per script): ${card.catchphrases.map((c) => `"${c}"`).join(", ")}`
      : "Catchphrases: none on file.",
    `Humor: ${card.humor}`,
    `Point of view: ${card.pov}`,
    card.taboos.length > 0
      ? `Never do: ${card.taboos.join("; ")}`
      : "No listed taboos, but stay away from clickbait superlatives.",
  ].join("\n");
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
