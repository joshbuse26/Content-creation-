import { z } from "zod";
import { scriptIdSchema } from "@/lib/types/ids";
import {
  frameJobInputSchema,
  hookCandidateSchema,
  outlineSchema,
  researchJobInputSchema,
  revisionJobInputSchema,
  scriptJobInputSchema,
  titlesJobInputSchema,
} from "@/lib/types/pipeline";
import { runResearchPipeline } from "@/pipelines/research/pipeline";
import { runRevisionPipeline } from "@/pipelines/revision/pipeline";
import { getEngineDeps } from "./deps";
import { runFramePipeline } from "./frames";
import { runScriptPipeline } from "./pipeline";
import { runTitlesPipeline } from "./titles";

/**
 * Worker-facing job handlers — INTEGRATION POINT for A0's worker/index.ts.
 *
 * Wiring (replaces the skeleton no-ops):
 *   script queue:    generate-script  → handleGenerateScriptJob(job.data)
 *                    revision-pass    → handleRevisionPassJob(job.data)
 *                    research         → handleResearchJob(job.data)
 *                    propose-frames   → handleProposeFramesJob(job.data)
 *   packaging queue: titles           → handleTitlesJob(job.data)
 *
 * Each handler parses its payload, runs the pipeline with default deps, and
 * throws when the pipeline fails so BullMQ's job-level safety-net retry
 * applies (per-stage retries live inside the PipelineRunner).
 */

const actor = z.object({
  actorUserId: z.string().nullable().default(null),
  creditExempt: z.boolean().optional().default(false),
});

/**
 * Wave C: one job name (frozen queue contract) carries three dispatch
 * shapes, discriminated by `dispatch`:
 *  - "legacy"  (default, and what pre-wave payloads parse as): the
 *    composite 7-stage run with its single -6 completion charge —
 *    UNCHANGED for jobs already queued before a deploy.
 *  - "draft"   staged `script.draft` (§4): adopts presetOutline/chosenHook,
 *    charges -4 keyed `draft:<hash>`.
 *  - "generate" the `script.generate` orchestrator: same stage sequence,
 *    ITEMIZED per-stage charges (outline 1 + hooks 1 + draft 4 = 6).
 */
export const scriptJobPayloadSchema = scriptJobInputSchema
  .extend({
    scriptId: scriptIdSchema,
    dispatch: z.enum(["legacy", "draft", "generate"]).default("legacy"),
    presetOutline: outlineSchema.nullable().default(null),
    chosenHook: hookCandidateSchema.nullable().default(null),
  })
  .and(actor);
export const researchJobPayloadSchema = researchJobInputSchema.and(actor);
export const frameJobPayloadSchema = frameJobInputSchema.and(actor);
export const revisionJobPayloadSchema = revisionJobInputSchema.and(actor);
export const titlesJobPayloadSchema = titlesJobInputSchema.and(actor);

function assertDone(result: { status: string; stage?: string; error?: string }, kind: string) {
  if (result.status !== "done") {
    throw new Error(
      `${kind} pipeline failed at stage ${result.stage ?? "?"}: ${result.error ?? "unknown"}`,
    );
  }
}

export async function handleGenerateScriptJob(data: unknown): Promise<void> {
  const payload = scriptJobPayloadSchema.parse(data);
  const deps = await getEngineDeps();
  const { scriptId, actorUserId, creditExempt, dispatch, presetOutline, chosenHook, ...input } =
    payload;
  const result = await runScriptPipeline(deps, {
    input,
    scriptId,
    actorUserId,
    creditExempt,
    ...(dispatch === "draft" ? { presetOutline, chosenHook, metering: "draft" as const } : {}),
    ...(dispatch === "generate" ? { metering: "itemized" as const } : {}),
  });
  assertDone(result, "script");
}

export async function handleResearchJob(data: unknown): Promise<void> {
  const payload = researchJobPayloadSchema.parse(data);
  const deps = await getEngineDeps();
  const { actorUserId, creditExempt, ...input } = payload;
  const result = await runResearchPipeline(deps, { input, actorUserId, creditExempt });
  assertDone(result, "research");
}

export async function handleProposeFramesJob(data: unknown): Promise<void> {
  const payload = frameJobPayloadSchema.parse(data);
  const deps = await getEngineDeps();
  const { actorUserId, ...input } = payload;
  const { result } = await runFramePipeline(deps, { input, actorUserId });
  assertDone(result, "frame");
}

export async function handleRevisionPassJob(data: unknown): Promise<void> {
  const payload = revisionJobPayloadSchema.parse(data);
  const deps = await getEngineDeps();
  const { actorUserId, creditExempt, ...input } = payload;
  const { result } = await runRevisionPipeline(deps, { input, actorUserId, creditExempt });
  assertDone(result, "revision");
}

export async function handleTitlesJob(data: unknown): Promise<void> {
  const payload = titlesJobPayloadSchema.parse(data);
  const deps = await getEngineDeps();
  const { actorUserId, creditExempt, ...input } = payload;
  const { result } = await runTitlesPipeline(deps, { input, actorUserId, creditExempt });
  assertDone(result, "titles");
}
