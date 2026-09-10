import type { z } from "zod";
import { generationTargetSchema, type GenerationTarget } from "@/lib/types/entities";
import { flowReducer, restoreFlow, serializeFlow } from "./staged-flow";

/**
 * Per-project generation-target persistence (wave C2, upgraded at C-wave
 * integration).
 *
 * `project.setGenerationTarget` now persists the choice server-side on the
 * project row (REQUESTS-C2 #1 delivered), so the server is authoritative
 * across devices and teammates. The localStorage stash is kept as a
 * fallback: it is written alongside every mutation, so on this browser it
 * matches the server after a successful save and preserves the user's
 * intent if the save failed. Resolution order (resolveGenerationTarget):
 * local stash → project row mode fields → latest script row mode fields.
 *
 * Everything loaded from storage is schema-validated; anything that does not
 * parse is dropped (and the key cleared) rather than trusted.
 */

const targetKey = (projectId: string) => `gr.generation.${projectId}`;

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // best-effort (private mode) — the choice just won't survive refresh
  }
}

function loadValidated<T>(key: string, schema: z.ZodType<T>): T | null {
  const raw = safeGet(key);
  if (raw === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    safeSet(key, null);
    return null;
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    safeSet(key, null);
    return null;
  }
  return parsed.data;
}

export function storeGenerationTarget(projectId: string, target: GenerationTarget | null): void {
  safeSet(targetKey(projectId), target === null ? null : JSON.stringify(target));
}

export function loadGenerationTarget(projectId: string): GenerationTarget | null {
  return loadValidated(targetKey(projectId), generationTargetSchema);
}

/** Row shapes carrying wave-C mode fields (project and script rows both do). */
export interface GenerationModeFieldsRow {
  generationMode: GenerationTarget["mode"] | null;
  archetypeId: GenerationTarget["archetypeId"];
  crossover: GenerationTarget["crossover"];
  partnerId: GenerationTarget["partnerId"];
  voiceProfileId?: GenerationTarget["voiceProfileId"];
}

function targetFromRow(row: GenerationModeFieldsRow | null): GenerationTarget | null {
  if (row === null || row.generationMode === null) return null;
  const parsed = generationTargetSchema.safeParse({
    mode: row.generationMode,
    archetypeId: row.archetypeId,
    crossover: row.crossover,
    partnerId: row.partnerId,
    voiceProfileId: row.voiceProfileId ?? null,
  });
  return parsed.success ? parsed.data : null;
}

/**
 * Resolution order: local stash (this browser's latest intent — matches the
 * server after a successful setGenerationTarget, survives a failed one) →
 * project row (server truth pre-draft, follows the user across devices) →
 * latest script row (the style the newest draft was actually written with).
 */
export function resolveGenerationTarget(
  projectId: string,
  project: GenerationModeFieldsRow | null,
  latestScript: GenerationModeFieldsRow | null,
): GenerationTarget | null {
  const local = loadGenerationTarget(projectId);
  if (local !== null) return local;
  return targetFromRow(project) ?? targetFromRow(latestScript);
}

// ---------------------------------------------------------------------------
// Staged-flow state persistence (topics/outline/hooks results are stateless
// mutations server-side — REQUESTS-C2.md #2 — so refresh-resume for the
// pre-draft steps rides this bridge; the draft step resumes via
// script.listVersions + the SSE replay endpoint like the earlier waves).
// ---------------------------------------------------------------------------

const flowKey = (projectId: string) => `gr.stagedflow.${projectId}`;

export function storeStagedFlow(projectId: string, serialized: string | null): void {
  safeSet(flowKey(projectId), serialized);
}

export function loadStagedFlowRaw(projectId: string): string | null {
  return safeGet(flowKey(projectId));
}

export function clearStagedFlow(projectId: string): void {
  safeSet(flowKey(projectId), null);
}

/**
 * A style change re-frames the outline/hooks — apply the invalidation to
 * the stored flow state so the generate screen never offers stale artifacts.
 */
export function applyStyleChangeToFlow(projectId: string): void {
  const flow = restoreFlow(loadStagedFlowRaw(projectId));
  if (flow === null) return;
  storeStagedFlow(projectId, serializeFlow(flowReducer(flow, { type: "style_changed" })));
}

/**
 * Broadcast channel for style changes made on the project frame: the staged
 * generate panel (mounted in the same tree) listens and reloads its state.
 * detail: { projectId }.
 */
export const GENERATION_CHANGED_EVENT = "gr:generation-changed";
