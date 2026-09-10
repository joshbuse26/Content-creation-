import { describe, expect, it } from "vitest";
import type { DiffOp } from "@/lib/types/entities";
import { applyDiffOps, computeLineDiff, revisionDiffRows } from "../logic/diff";

const THREE_LINES = "alpha line\nbeta line\ngamma line";

describe("applyDiffOps", () => {
  it("replaces a single line (1-indexed inclusive, as in the fixture revision)", () => {
    const ops: DiffOp[] = [{ lineStart: 2, lineEnd: 2, replacement: "BETA!" }];
    expect(applyDiffOps(THREE_LINES, ops)).toBe("alpha line\nBETA!\ngamma line");
  });

  it("replaces a multi-line range with a different number of lines", () => {
    const ops: DiffOp[] = [{ lineStart: 1, lineEnd: 2, replacement: "one\ntwo\nthree" }];
    expect(applyDiffOps(THREE_LINES, ops)).toBe("one\ntwo\nthree\ngamma line");
  });

  it("deletes lines when the replacement is empty", () => {
    const ops: DiffOp[] = [{ lineStart: 2, lineEnd: 3, replacement: "" }];
    expect(applyDiffOps(THREE_LINES, ops)).toBe("alpha line");
  });

  it("applies multiple ops against original line numbers (bottom-up)", () => {
    const ops: DiffOp[] = [
      { lineStart: 1, lineEnd: 1, replacement: "first\nfirst-b" },
      { lineStart: 3, lineEnd: 3, replacement: "last" },
    ];
    // Op order in the array must not matter.
    expect(applyDiffOps(THREE_LINES, ops)).toBe("first\nfirst-b\nbeta line\nlast");
    expect(applyDiffOps(THREE_LINES, [...ops].reverse())).toBe("first\nfirst-b\nbeta line\nlast");
  });

  it("clamps out-of-range ops instead of corrupting the body", () => {
    const ops: DiffOp[] = [{ lineStart: 10, lineEnd: 12, replacement: "nope" }];
    expect(applyDiffOps(THREE_LINES, ops)).toBe(THREE_LINES);
    const zero: DiffOp[] = [{ lineStart: 0, lineEnd: 0, replacement: "head" }];
    expect(applyDiffOps(THREE_LINES, zero)).toBe("head\nbeta line\ngamma line");
  });
});

describe("computeLineDiff", () => {
  it("marks removed and added lines with surrounding context", () => {
    const rows = computeLineDiff(THREE_LINES, "alpha line\nBETA!\ngamma line");
    expect(rows).toEqual([
      { type: "context", text: "alpha line" },
      { type: "removed", text: "beta line" },
      { type: "added", text: "BETA!" },
      { type: "context", text: "gamma line" },
    ]);
  });

  it("returns only context rows for identical bodies", () => {
    const rows = computeLineDiff(THREE_LINES, THREE_LINES);
    expect(rows.every((r) => r.type === "context")).toBe(true);
    expect(rows).toHaveLength(3);
  });
});

describe("revisionDiffRows", () => {
  it("renders red/green rows for a revision's ops against the body", () => {
    const rows = revisionDiffRows(THREE_LINES, [
      { lineStart: 3, lineEnd: 3, replacement: "GAMMA" },
    ]);
    expect(rows.filter((r) => r.type === "removed").map((r) => r.text)).toEqual(["gamma line"]);
    expect(rows.filter((r) => r.type === "added").map((r) => r.text)).toEqual(["GAMMA"]);
  });
});
