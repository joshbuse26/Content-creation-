import { diffLines } from "diff";
import type { DiffOp } from "@/lib/types/entities";

/**
 * Line-level diff application + red/green rendering model for the revision
 * pass (spec §5.8). Diff ops are 1-indexed inclusive line ranges (see the
 * fixture revision: a single-line body has lineStart=lineEnd=1).
 */

/** Apply diff ops to a body; ops target the ORIGINAL line numbers. */
export function applyDiffOps(body: string, ops: readonly DiffOp[]): string {
  const lines = body.split("\n");
  // Apply bottom-up so earlier ops don't shift later ops' line numbers.
  const ordered = [...ops].sort((a, b) => b.lineStart - a.lineStart);
  for (const op of ordered) {
    const start = Math.max(1, op.lineStart);
    const end = Math.min(lines.length, Math.max(op.lineEnd, start));
    if (start > lines.length) continue;
    const replacementLines = op.replacement === "" ? [] : op.replacement.split("\n");
    lines.splice(start - 1, end - start + 1, ...replacementLines);
  }
  return lines.join("\n");
}

export interface DiffRow {
  type: "context" | "removed" | "added";
  text: string;
}

/** Line-by-line red/green rows between an original and a revised body. */
export function computeLineDiff(original: string, revised: string): DiffRow[] {
  const changes = diffLines(original.endsWith("\n") ? original : `${original}\n`, revised.endsWith("\n") ? revised : `${revised}\n`);
  const rows: DiffRow[] = [];
  for (const change of changes) {
    const lines = change.value.split("\n");
    // A trailing newline yields one empty tail entry — drop it.
    if (lines[lines.length - 1] === "") lines.pop();
    const type: DiffRow["type"] = change.added ? "added" : change.removed ? "removed" : "context";
    for (const line of lines) rows.push({ type, text: line });
  }
  return rows;
}

/** Convenience: the rows a single revision produces against a section body. */
export function revisionDiffRows(body: string, ops: readonly DiffOp[]): DiffRow[] {
  return computeLineDiff(body, applyDiffOps(body, ops));
}
