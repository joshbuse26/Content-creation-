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

/**
 * Rebase a pending revision's diff ops over the revisions ALREADY accepted
 * on the same section.
 *
 * All suggestions from a revision pass carry line numbers in the section
 * body as it was when the pass ran. Accepting a suggestion changes the
 * body's line count, so later accepts must shift their ranges by the net
 * line delta of every accepted op that lies entirely BEFORE them (accepts
 * applied in order shift subsequent ops). An op that overlaps an accepted
 * range no longer matches the text it was written against and is rejected
 * with DiffApplyError.
 */
export function rebaseDiffOps(ops: DiffOp[], acceptedDiffs: readonly DiffOp[][]): DiffOp[] {
  const applied = acceptedDiffs.flat().sort((a, b) => a.lineStart - b.lineStart);
  return ops.map((op) => {
    let offset = 0;
    for (const accepted of applied) {
      if (accepted.lineEnd < op.lineStart) {
        const replacedLines = accepted.lineEnd - accepted.lineStart + 1;
        offset += accepted.replacement.split("\n").length - replacedLines;
        continue;
      }
      if (accepted.lineStart <= op.lineEnd) {
        throw new DiffApplyError(
          `suggestion overlaps an already-accepted revision (lines ${accepted.lineStart}-${accepted.lineEnd})`,
        );
      }
      // Accepted range lies entirely after this op — no shift.
    }
    return { ...op, lineStart: op.lineStart + offset, lineEnd: op.lineEnd + offset };
  });
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
