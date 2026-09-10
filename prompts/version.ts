/**
 * PROMPT_VERSION — bumped on ANY change to any prompt template in prompts/.
 *
 * The version is folded into every pipeline stage's `input_hash` on
 * pipeline_runs (see pipelines/script/hash.ts), which both records the prompt
 * generation a run used and invalidates stage-resume when prompts change —
 * a re-run after a prompt edit never silently reuses stale stage output.
 */
export const PROMPT_VERSION = "2026-09-10.1";

/** Every template returns this shape; callers pick model + maxTokens. */
export interface PromptTemplate {
  system: string;
  prompt: string;
}
