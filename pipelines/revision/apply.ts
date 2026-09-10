import type { DiffOp } from "@/lib/types/entities";

/**
 * §5.8 — applying line-level diff ops to a section body.
 *
 * Ops use 1-based inclusive line ranges into the section's body split on
 * "\n". Accepting applies ops bottom-up so earlier ranges stay valid when a
 * replacement changes the line count.
 */

export class DiffApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiffApplyError";
  }
}

export function applyDiffOps(body: string, ops: DiffOp[]): string {
  const lines = body.split("\n");
  const sorted = [...ops].sort((a, b) => b.lineStart - a.lineStart);
  // Reject overlapping ops — suggestions must be independent.
  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    if (current !== undefined && next !== undefined && next.lineEnd >= current.lineStart) {
      throw new DiffApplyError("diff ops overlap");
    }
  }
  for (const op of sorted) {
    if (op.lineStart < 1 || op.lineEnd < op.lineStart || op.lineStart > lines.length) {
      throw new DiffApplyError(
        `diff op range ${op.lineStart}-${op.lineEnd} is outside the section (${lines.length} lines)`,
      );
    }
    const end = Math.min(op.lineEnd, lines.length);
    lines.splice(op.lineStart - 1, end - op.lineStart + 1, ...op.replacement.split("\n"));
  }
  return lines.join("\n");
}
