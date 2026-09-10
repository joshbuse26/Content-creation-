import { TRPCError } from "@trpc/server";
import type { ProjectId, WorkspaceId } from "@/lib/types/ids";
import type { EngineDeps } from "@/pipelines/script/deps";
import { stageInputHash } from "@/pipelines/script/hash";
import { settleCharge } from "@/pipelines/script/settle-charge";
import { PipelineRunner, RUN_ALREADY_IN_PROGRESS } from "@/queue/pipeline-runner";

/**
 * Metered synchronous stage execution — the shared machinery behind
 * `script.topics` / `script.outline` / `script.hooks` (PRODUCT-CONTRACTS
 * §4). These stages return complete results in the response (no SSE), but
 * still run through the PipelineRunner so every invocation persists a
 * pipeline_runs row (kind "script", stage = the §4 stage name), gets the
 * runner's per-stage retries + concurrent-claim protection, and charges an
 * IDEMPOTENT completion entry keyed `<stage>:<input hash>`:
 *
 *  - a retry after failure re-executes and charges once;
 *  - an identical re-submit (same input, prompts unchanged) finds the done
 *    run row and RE-SERVES its persisted output (pipeline_runs.output) —
 *    zero live LLM calls — and the ledger dedupe makes the re-serve FREE;
 *    only legacy rows written before the output column recompute, once,
 *    and persist the result for the next re-submit.
 *
 * Credits are checked by the caller at dispatch (requireCreditsWithOverage)
 * BEFORE any work; the charge lands here only after the stage completed —
 * settled through settleCharge, so a balance-floor bounce either meters the
 * shortfall as overage (paid plans) or fails cleanly with the typed
 * PRECONDITION_FAILED while the persisted output keeps the retry free.
 */
export async function runMeteredSyncStage<T>(params: {
  deps: EngineDeps;
  stage: "topics" | "outline" | "hooks";
  workspaceId: WorkspaceId;
  projectId: ProjectId | null;
  /** The parsed procedure input — folded (with PROMPT_VERSION) into the run hash. */
  input: unknown;
  cost: number;
  actorUserId: string | null;
  compute: () => Promise<T>;
}): Promise<T> {
  const { deps, stage } = params;
  const inputHash = stageInputHash({ stage, input: params.input });
  let value: { result: T } | undefined;

  const runner = new PipelineRunner(deps.runs);
  const result = await runner.execute(
    {
      kind: "script",
      stages: [
        {
          name: stage,
          run: async () => {
            value = { result: await params.compute() };
          },
        },
      ],
    },
    {
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      input: params.input,
      inputHash,
    },
  );

  if (result.status === "failed") {
    if (result.error === RUN_ALREADY_IN_PROGRESS) {
      throw new TRPCError({ code: "CONFLICT", message: RUN_ALREADY_IN_PROGRESS });
    }
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `${stage} stage failed: ${result.error}`,
    });
  }

  const runKey = {
    workspaceId: params.workspaceId as string,
    projectId: params.projectId as string | null,
    kind: "script" as const,
    stage,
    inputHash,
  };
  if (value === undefined) {
    // Stage skipped ⇒ an identical run already completed. Re-serve the
    // persisted output — NEVER a fresh LLM recompute (adversarial F2).
    // Legacy rows written before pipeline_runs.output existed recompute
    // once and persist, so their next re-submit is also served from disk.
    const row = await deps.runs.find(runKey);
    if (row !== null && row.output != null) {
      value = { result: row.output as T };
    } else {
      value = { result: await params.compute() };
      if (row !== null) await deps.runs.update(row.id, { output: value.result });
    }
  } else {
    // Fresh compute — persist the output on the done row for re-serving.
    const row = await deps.runs.find(runKey);
    if (row !== null) await deps.runs.update(row.id, { output: value.result });
  }

  await settleCharge(deps.store, {
    workspaceId: params.workspaceId,
    delta: -params.cost,
    // The frozen credit_reason enum has no per-stage members; each stage
    // writes its OWN entry so the ledger stays itemized (§4), and the
    // stage-scoped key makes the completion charge idempotent.
    reason: "script_generation",
    actorUserId: params.actorUserId,
    projectId: params.projectId,
    idempotencyKey: `${stage}:${inputHash}`,
  });

  return value.result;
}
