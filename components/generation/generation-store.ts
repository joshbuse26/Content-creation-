import type { z } from "zod";
import { generationTargetSchema, type GenerationTarget } from "@/lib/types/entities";
import { flowReducer, restoreFlow, serializeFlow } from "./staged-flow";

/**
 * Per-project generation-target persistence (wave C2).
 *
 * No frozen contract persists a project's chosen generation target before a
 * draft exists (project.create/update carry no mode fields — see
 * REQUESTS-C2.md #1), so the picker stashes the choice per project in
 * localStorage, exactly like the editor's hook-store bridge. After a draft
 * exists the SERVER is authoritative: script rows carry
 * generationMode/archetypeId/crossover, and callers should prefer the latest
 * script's fields over this stash (see resolveGenerationTarget).
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

/**
 * Server-known mode fields (from the latest script row) win over the local
 * stash; the stash covers the time before any draft exists.
 */
export function resolveGenerationTarget(
  projectId: string,
  latestScript: {
    generationMode: GenerationTarget["mode"] | null;
    archetypeId: GenerationTarget["archetypeId"];
    crossover: GenerationTarget["crossover"];
    partnerId: GenerationTarget["partnerId"];
    voiceProfileId: GenerationTarget["voiceProfileId"];
  } | null,
): GenerationTarget | null {
  const local = loadGenerationTarget(projectId);
  if (local !== null) return local;
  if (latestScript === null || latestScript.generationMode === null) return null;
  const parsed = generationTargetSchema.safeParse({
    mode: latestScript.generationMode,
    archetypeId: latestScript.archetypeId,
    crossover: latestScript.crossover,
    partnerId: latestScript.partnerId,
    voiceProfileId: latestScript.voiceProfileId,
  });
  return parsed.success ? parsed.data : null;
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
