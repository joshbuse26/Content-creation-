import { z } from "zod";
import { hookCandidateSchema, type HookCandidate } from "@/lib/types/pipeline";

/**
 * Hook candidates are streamed during generation but not yet persisted by any
 * contract procedure (REQUESTS-A3.md #4). Until they are, the generation
 * screen stashes them per script in localStorage and the editor's hook
 * switcher reads them back. Loaded JSON is schema-validated — anything that
 * does not parse is dropped (and the key cleared) rather than trusted.
 */

const storedCandidatesSchema = z.array(hookCandidateSchema);

const keyFor = (scriptId: string) => `gr.hooks.${scriptId}`;

export function storeHookCandidates(scriptId: string, candidates: HookCandidate[]): void {
  try {
    window.localStorage.setItem(keyFor(scriptId), JSON.stringify(candidates));
  } catch {
    // best-effort
  }
}

function clearStored(scriptId: string): void {
  try {
    window.localStorage.removeItem(keyFor(scriptId));
  } catch {
    // best-effort
  }
}

export function loadHookCandidates(scriptId: string): HookCandidate[] | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(keyFor(scriptId));
  } catch {
    return null;
  }
  if (raw === null) return null;
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    clearStored(scriptId);
    return null;
  }
  const parsed = storedCandidatesSchema.safeParse(parsedJson);
  if (!parsed.success) {
    clearStored(scriptId);
    return null;
  }
  return parsed.data;
}
