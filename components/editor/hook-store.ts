import type { HookCandidate } from "@/lib/types/pipeline";

/**
 * Hook candidates are streamed during generation but not yet persisted by any
 * contract procedure (REQUESTS-A3.md #4). Until they are, the generation
 * screen stashes them per script in localStorage and the editor's hook
 * switcher reads them back, falling back to defaults.
 */

const keyFor = (scriptId: string) => `gr.hooks.${scriptId}`;

export function storeHookCandidates(scriptId: string, candidates: HookCandidate[]): void {
  try {
    window.localStorage.setItem(keyFor(scriptId), JSON.stringify(candidates));
  } catch {
    // best-effort
  }
}

export function loadHookCandidates(scriptId: string): HookCandidate[] | null {
  try {
    const raw = window.localStorage.getItem(keyFor(scriptId));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed as HookCandidate[];
  } catch {
    return null;
  }
}
