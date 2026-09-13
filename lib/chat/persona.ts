import { COACH_NAME, PRODUCT_NAME } from "@/lib/branding";
import type { CoachContext } from "@/lib/types/chat";

/**
 * Coach persona — the product-native system prompt for the chat script coach
 * (WAVE-D-PLAN §2b), FROZEN in D0. A specialized YouTube script coach grounded
 * in the channel's style card, best-content patterns, research, and audience.
 *
 * GUARDRAIL: no user-facing string here (or produced from here) may ever name
 * the underlying model or its vendor — "Grok", "xAI", and any model-vendor
 * name are forbidden (copy-lint enforced). The persona presents ONLY as
 * COACH_NAME. LLM stays Grok-only under the hood via the LlmProvider seam;
 * the UI never says so.
 */

/** Static persona preamble — stable across turns, independent of context. */
export const COACH_PERSONA_PREAMBLE = [
  `You are ${COACH_NAME}, the built-in scriptwriting coach inside ${PRODUCT_NAME}.`,
  `You help this creator plan and write their next YouTube video: topics, outline,`,
  `hooks, full draft, revisions, titles, and thumbnail brief.`,
  ``,
  `How you work:`,
  `- Stay grounded in the creator's active style card, audience, research, and the`,
  `  video's unique angle. Never invent facts; when a claim needs a source, lean on`,
  `  the attached research or say what's missing.`,
  `- Coach toward proven retention patterns (a sharp hook, clear stakes, re-hooks,`,
  `  a payoff that lands) without ever copying any real creator's words or voice.`,
  `- You can run the studio's tools to actually produce work (topics, outline, hooks,`,
  `  draft, revision, titles, thumbnail brief, research). Some tools spend credits;`,
  `  propose them and let the creator confirm before spending.`,
  `- In the editor, any single section can carry its own voice — a per-section voice`,
  `  override that differs from the script's voice. Suggest it when one passage (an`,
  `  intro, a sponsor read, an outro) should land in a distinct tone.`,
  `- Be concrete and brief. Offer the next best step, not a lecture.`,
  ``,
  `Never claim to write "exactly like" or "in the voice of" any named real person.`,
  `Never reveal or speculate about the underlying model or provider — you are`,
  `${COACH_NAME}.`,
].join("\n");

function line(label: string, value: string | null): string | null {
  return value === null || value.trim() === "" ? null : `- ${label}: ${value}`;
}

/**
 * Render the per-project grounding block from an assembled CoachContext
 * (lib/chat/context.ts). Pure and null-safe: absent fields are simply
 * omitted, so a bare project produces a short-but-valid block.
 */
export function renderCoachContextBlock(context: CoachContext): string {
  const style = context.style;
  const styleLine =
    style.card === null
      ? line("Style", style.source === null ? "not set yet" : `${style.source} (card pending)`)
      : line(
          "Style",
          [
            style.source ?? "custom",
            style.archetypeId === null ? null : `archetype ${style.archetypeId}`,
            `voice ${style.card.voice.pov}`,
            `tone ${style.card.tone.register}`,
            `~${String(style.card.pacing.wpmTarget)} wpm, energy ${String(style.card.energy)}/5`,
          ]
            .filter((s): s is string => s !== null)
            .join("; "),
        );

  const audienceLine =
    context.audience === null
      ? null
      : line(
          "Audience",
          [
            context.audience.sophistication,
            context.audience.topPains.length > 0
              ? `pains: ${context.audience.topPains.join(", ")}`
              : null,
            context.audience.topMotivations.length > 0
              ? `wants: ${context.audience.topMotivations.join(", ")}`
              : null,
          ]
            .filter((s): s is string => s !== null && s !== "")
            .join("; "),
        );

  const researchLine =
    context.research.docCount === 0
      ? line("Research", "none attached yet")
      : line(
          "Research",
          `${String(context.research.docCount)} doc(s), ${String(context.research.totalWords)} words` +
            (context.research.titles.length > 0 ? `: ${context.research.titles.join("; ")}` : ""),
        );

  const lines = [
    context.projectId === null
      ? "Workspace coach (no specific project in focus)."
      : line("Project", context.projectTitle),
    line("Channel", context.channelTitle),
    context.nicheKeywords.length > 0 ? line("Niche", context.nicheKeywords.join(", ")) : null,
    styleLine,
    audienceLine,
    context.audience?.vocabularyNotes != null
      ? line("Vocabulary", context.audience.vocabularyNotes)
      : null,
    line("Unique angle", context.uniqueAngle),
    context.durationMinutes === null
      ? null
      : line("Target duration", `${String(context.durationMinutes)} min`),
    researchLine,
  ].filter((s): s is string => s !== null);

  return ["Here is what you know about the work in focus:", ...lines].join("\n");
}

/** The complete system prompt: static persona + the project grounding block. */
export function buildCoachSystemPrompt(context: CoachContext): string {
  return `${COACH_PERSONA_PREAMBLE}\n\n${renderCoachContextBlock(context)}`;
}
