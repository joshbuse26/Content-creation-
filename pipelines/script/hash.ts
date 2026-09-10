import { hashInput } from "@/queue/pipeline-runner";
import { PROMPT_VERSION } from "@/prompts";

/**
 * Stage input hashing — folds PROMPT_VERSION into every pipeline_runs
 * input_hash. This is how the prompt generation is recorded on runs (spec
 * §5: PROMPT_VERSION recorded on pipeline_runs) and how stage-resume is
 * invalidated when prompts change: a re-run after a prompt edit re-executes
 * every stage instead of reusing output produced by older prompts.
 */
export function stageInputHash(input: unknown): string {
  return hashInput({ promptVersion: PROMPT_VERSION, input });
}
