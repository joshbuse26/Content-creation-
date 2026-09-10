import type { z } from "zod";
import type { LlmModel } from "@/lib/config";
import type { LlmProvider } from "@/lib/providers/types";
import type { PromptTemplate } from "@/prompts";

/**
 * Structured LLM output — every model response is Zod-parsed before it
 * touches the DB or the client (build spec §0).
 *
 * Two modes, carried on PipelineDeps:
 * - "live": call the model, extract JSON, schema-parse. Failures throw and
 *   the PipelineRunner's per-stage retry (2×) is the retry policy.
 * - "fixture": the deterministic synthesizer supplies the value (the shared
 *   fixture LlmProvider returns canned prose, not stage-shaped JSON) — still
 *   schema-parsed, so synthesizers can't drift from contracts either.
 */

export type EngineMode = "fixture" | "live";

export interface GenerateJsonRequest<T> {
  mode: EngineMode;
  llm: LlmProvider;
  model: LlmModel;
  template: PromptTemplate;
  maxTokens: number;
  schema: z.ZodType<T>;
  temperature?: number;
  /** Deterministic value used in fixture mode. */
  fixture: () => T;
}

/** Strip markdown fences / prose and isolate the first JSON value. */
export function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.search(/[[{]/);
  if (start === -1) return candidate.trim();
  const open = candidate[start];
  const close = open === "{" ? "}" : "]";
  const end = candidate.lastIndexOf(close);
  if (end > start) return candidate.slice(start, end + 1);
  return candidate.slice(start).trim();
}

export async function generateJson<T>(req: GenerateJsonRequest<T>): Promise<T> {
  if (req.mode === "fixture") {
    return req.schema.parse(req.fixture());
  }
  const response = await req.llm.complete({
    model: req.model,
    system: req.template.system,
    prompt: req.template.prompt,
    maxTokens: req.maxTokens,
    temperature: req.temperature ?? 0.7,
  });
  if (response.stopReason === "max_tokens") {
    throw new Error("LLM output truncated at max_tokens — retrying stage");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(response.text));
  } catch {
    throw new Error("LLM did not return parseable JSON");
  }
  return req.schema.parse(parsed);
}
