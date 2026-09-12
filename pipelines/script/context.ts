import type { AudienceAvatar, Frame, ResearchDoc, VoiceProfile } from "@/lib/types/entities";
import { scriptContextSchema, type ScriptContext } from "@/lib/types/pipeline";
import { estimateTokens, renderAudienceAvatar } from "@/prompts/shared";

/**
 * §5.7 stage 1 — context assembly (pure code, no LLM).
 *
 * Research is relevance-ranked against the frame (angle + keywords +
 * audience) and trimmed to a 30k-token budget: highest-signal docs first,
 * each excerpted from the top, until the budget is spent.
 */

export const RESEARCH_TOKEN_BUDGET = 30_000;
/** No single doc may eat more than half the budget. */
const PER_DOC_TOKEN_CAP = 15_000;

function contentWords(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z0-9$][a-z0-9'-]{2,}/g) ?? [];
  return new Set(words);
}

/** Overlap score between a research doc and the frame's vocabulary. */
export function relevanceScore(doc: ResearchDoc, frame: Frame): number {
  const frameTerms = contentWords(
    `${frame.angle} ${frame.keywords.join(" ")} ${frame.audienceSegment}`,
  );
  if (frameTerms.size === 0) return 0;
  const docTerms = contentWords(`${doc.title} ${doc.content.slice(0, 4000)}`);
  let hits = 0;
  for (const term of frameTerms) {
    if (docTerms.has(term)) hits += 1;
  }
  // Small recency boost keeps ties deterministic and favors fresh research.
  return hits / frameTerms.size + doc.fetchedAt.getTime() / 1e16;
}

export function trimResearch(docs: ResearchDoc[], frame: Frame): ScriptContext["research"] {
  const ranked = [...docs].sort((a, b) => relevanceScore(b, frame) - relevanceScore(a, frame));
  const out: ScriptContext["research"] = [];
  let budget = RESEARCH_TOKEN_BUDGET;
  for (const doc of ranked) {
    if (budget <= 500) break;
    const allowedTokens = Math.min(budget, PER_DOC_TOKEN_CAP);
    const excerpt =
      estimateTokens(doc.content) <= allowedTokens
        ? doc.content
        : doc.content.slice(0, allowedTokens * 4);
    out.push({ researchDocId: doc.id, title: doc.title, excerpt });
    budget -= estimateTokens(excerpt);
  }
  return out;
}

/**
 * A structured, first-class audience block used across the generation prompts
 * (outline, sections, hooks, voice, frames) via `ScriptContext.avatarSummary`.
 * Delegates to the shared `renderAudienceAvatar` renderer so the avatar —
 * demographics, pains WITH evidence, motivations WITH evidence, vocabulary —
 * reaches every prompt as a prominent block rather than a flattened one-liner.
 */
export function summarizeAvatar(avatar: AudienceAvatar | null): string {
  return renderAudienceAvatar(avatar);
}

export function assembleContext(params: {
  frame: Frame;
  researchDocs: ResearchDoc[];
  avatar: AudienceAvatar | null;
  voiceProfile: VoiceProfile | null;
}): ScriptContext {
  return scriptContextSchema.parse({
    frame: {
      angle: params.frame.angle,
      format: params.frame.format,
      outcome: params.frame.outcome,
      audienceSegment: params.frame.audienceSegment,
      tone: params.frame.tone,
      targetMinutes: params.frame.targetMinutes,
      keywords: params.frame.keywords,
    },
    research: trimResearch(params.researchDocs, params.frame),
    avatarSummary: summarizeAvatar(params.avatar),
    styleCard: params.voiceProfile?.styleCard ?? null,
  });
}
