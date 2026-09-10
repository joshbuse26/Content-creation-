/**
 * {{slot}} helpers for the descriptions panel. Server-side generation fills
 * the known slots (summary/title/chapters/keywords —
 * pipelines/packaging/descriptions.ts); anything else is left in the body
 * for the user, and these helpers power the "fill remaining slots" UI.
 */

const SLOT_RE = /\{\{\s*(\w+)\s*\}\}/g;

/** Unique slot names present in a body, in order of first appearance. */
export function extractSlots(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of body.matchAll(SLOT_RE)) {
    const name = match[1];
    if (name !== undefined && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/**
 * Replace slots that have a non-empty value; slots without a value (or with
 * a blank one) stay in place so nothing is silently deleted.
 */
export function fillSlots(body: string, values: Record<string, string>): string {
  return body.replace(SLOT_RE, (match, name: string) => {
    const value = values[name];
    return value !== undefined && value.trim() !== "" ? value : match;
  });
}
