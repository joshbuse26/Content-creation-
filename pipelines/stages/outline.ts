import { LLM_MODELS } from "@/lib/config";
import type { LlmProvider } from "@/lib/providers/types";
import { outlineSchema, type Outline, type ScriptContext } from "@/lib/types/pipeline";
import { synthOutline } from "@/pipelines/script/fixture-content";
import { generateJson, type EngineMode } from "@/pipelines/script/llm-json";
import { outlinePrompt } from "@/prompts";

/**
 * Outline generation (PRODUCT-CONTRACTS §4 `script.outline`, also stage 2
 * of the composite pipeline). The style card rides in on the context and
 * shapes the prompt (pacing.sectionSeconds as the chapter norm); the
 * targetSeconds sum is code-normalized to the frame target so an arithmetic
 * overshoot never burns an LLM retry.
 */

/** Scale section targetSeconds to the frame target when off by > 10%. */
export function normalizeOutlineTotal(outline: Outline, targetMinutes: number): Outline {
  const total = outline.sections.reduce((sum, s) => sum + s.targetSeconds, 0);
  const target = targetMinutes * 60;
  if (target <= 0 || total <= 0 || Math.abs(total - target) / target <= 0.1) return outline;
  const scale = target / total;
  return {
    sections: outline.sections.map((s) => ({
      ...s,
      targetSeconds: Math.max(10, Math.round(s.targetSeconds * scale)),
    })),
  };
}

export async function generateOutline(params: {
  mode: EngineMode;
  llm: LlmProvider;
  context: ScriptContext;
}): Promise<Outline> {
  const { context } = params;
  const outline = await generateJson({
    mode: params.mode,
    llm: params.llm,
    model: LLM_MODELS.sonnet,
    template: outlinePrompt({ context }),
    maxTokens: 4000,
    schema: outlineSchema,
    fixture: () => synthOutline(context),
  });
  return normalizeOutlineTotal(outline, context.frame.targetMinutes);
}
