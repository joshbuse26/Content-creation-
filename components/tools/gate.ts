/**
 * Free-tool email gate — spec §6: "email-gate the 3rd use". Pure logic here
 * (tested), localStorage wrappers below. This is a client-side honor-system
 * gate; the hard cap is the server's per-IP freeTools rate limit (5/day)
 * which applies regardless of anything stored in the browser.
 */

/** Uses allowed before the email gate appears (gate on the 3rd). */
export const FREE_USES_BEFORE_GATE = 2;

export function shouldGate(uses: number, unlocked: boolean): boolean {
  return !unlocked && uses >= FREE_USES_BEFORE_GATE;
}

export function isPlausibleEmail(value: string): boolean {
  const v = value.trim();
  return v.length >= 6 && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

const USES_KEY = "gr.tools.uses";
const UNLOCK_KEY = "gr.tools.unlocked";

export function readUses(): number {
  try {
    const raw = window.localStorage.getItem(USES_KEY);
    const n = raw === null ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function recordUse(): number {
  const next = readUses() + 1;
  try {
    window.localStorage.setItem(USES_KEY, String(next));
  } catch {
    // Storage unavailable — the server-side IP limit still applies.
  }
  return next;
}

export function isUnlocked(): boolean {
  try {
    return window.localStorage.getItem(UNLOCK_KEY) === "1";
  } catch {
    return false;
  }
}

export function unlock(): void {
  try {
    window.localStorage.setItem(UNLOCK_KEY, "1");
  } catch {
    // Ignore — worst case the gate shows again next visit.
  }
}
