import { z } from "zod";
import { LLM_MODELS } from "@/lib/config";
import type { LlmProvider } from "@/lib/providers/types";
import { hookStyleSchema, type HookStyle } from "@/lib/types/enums";
import type { HookCandidate, Outline, ScriptContext } from "@/lib/types/pipeline";
import { synthHookCandidates } from "@/pipelines/script/fixture-content";
import { generateJson, type EngineMode } from "@/pipelines/script/llm-json";
import { hookPrompt } from "@/prompts";

/**
 * Hook-candidate generation (PRODUCT-CONTRACTS §4 `script.hooks`, also the
 * hook step inside `draft`) — 3 tagged candidates, CONSTRAINED to the style
 * card's hookPatterns when a card is in play (§6: the hook gate checks
 * membership, so generation must only propose allowed techniques). With
 * fewer allowed techniques than candidates, techniques repeat with distinct
 * bodies. Auto-pick honors the card's preference order (hookPatterns[0]);
 * without a card, the legacy frame-outcome heuristic applies unchanged.
 */

const rawHookCandidatesSchema = z.object({
  candidates: z.array(z.object({ style: hookStyleSchema, body: z.string().min(1) })).length(3),
});

/** Legacy auto-pick heuristic (pre-wave-C behavior, card-less runs). */
export function pickHookStyleForOutcome(outcome: ScriptContext["frame"]["outcome"]): HookStyle {
  if (outcome === "watch_time") return "open_loop";
  if (outcome === "subs") return "bold_claim";
  return "stakes";
}

export async function generateHookCandidates(params: {
  mode: EngineMode;
  llm: LlmProvider;
  context: ScriptContext;
  outline: Outline;
}): Promise<HookCandidate[]> {
  const { context } = params;
  const card = context.styleCard;
  const allowed = card === null ? null : card.hookPatterns.map((p) => p.technique);

  const result = await generateJson({
    mode: params.mode,
    llm: params.llm,
    model: LLM_MODELS.sonnet,
    template: hookPrompt({ context, outline: params.outline, allowedTechniques: allowed }),
    maxTokens: 1500,
    temperature: 0.9,
    schema: rawHookCandidatesSchema,
    fixture: () => ({ candidates: synthHookCandidates(context, allowed) }),
  });

  // Machine check, not vibes: a candidate outside the card's allowed
  // techniques fails the stage (the runner's per-stage retry re-prompts).
  if (allowed !== null) {
    const offender = result.candidates.find((c) => !allowed.includes(c.style));
    if (offender !== undefined) {
      throw new Error(
        `hook technique "${offender.style}" is outside the style card's allowed patterns`,
      );
    }
  }

  const preferred =
    card !== null && card.hookPatterns[0] !== undefined
      ? card.hookPatterns[0].technique
      : pickHookStyleForOutcome(context.frame.outcome);
  const pickedIndex = Math.max(
    0,
    result.candidates.findIndex((c) => c.style === preferred),
  );
  return result.candidates.map((c, i) => ({
    style: c.style,
    body: c.body,
    autoPicked: i === pickedIndex,
  }));
}
