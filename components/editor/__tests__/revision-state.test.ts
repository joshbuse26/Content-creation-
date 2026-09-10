import { describe, expect, it } from "vitest";
import {
  initReviewState,
  isRevisionStale,
  opsOverlap,
  pendingCount,
  previewBodyFor,
  reviewReducer,
  type RevisionLite,
} from "../logic/revision-state";

const revA: RevisionLite = {
  id: "rev-a",
  sectionId: "sec-1",
  diff: [{ lineStart: 1, lineEnd: 1, replacement: "New first line." }],
};
const revB: RevisionLite = {
  id: "rev-b",
  sectionId: "sec-2",
  diff: [{ lineStart: 1, lineEnd: 1, replacement: "Rewritten." }],
};

const bodies = { "sec-1": "Old first line.\nSecond line.", "sec-2": "Only line." };

describe("initReviewState", () => {
  it("starts every revision pending unless the server already decided", () => {
    const state = initReviewState([revA, revB], bodies, { "rev-b": "accepted" });
    expect(state.decisions).toEqual({ "rev-a": "pending", "rev-b": "accepted" });
    expect(pendingCount(state)).toBe(1);
  });
});

describe("reviewReducer accept/reject", () => {
  it("accept marks the revision and applies its diff to the section body", () => {
    const state = initReviewState([revA, revB], bodies);
    const next = reviewReducer(state, { type: "accept", revision: revA });
    expect(next.decisions["rev-a"]).toBe("accepted");
    expect(next.bodies["sec-1"]).toBe("New first line.\nSecond line.");
    // Other sections untouched.
    expect(next.bodies["sec-2"]).toBe("Only line.");
  });

  it("accept is idempotent — a double accept does not re-apply the diff", () => {
    const state = initReviewState([revA], bodies);
    const once = reviewReducer(state, { type: "accept", revision: revA });
    const twice = reviewReducer(once, { type: "accept", revision: revA });
    expect(twice).toBe(once);
    expect(twice.bodies["sec-1"]).toBe("New first line.\nSecond line.");
  });

  it("reject marks the revision and leaves the body unchanged", () => {
    const state = initReviewState([revA], bodies);
    const next = reviewReducer(state, { type: "reject", revisionId: "rev-a" });
    expect(next.decisions["rev-a"]).toBe("rejected");
    expect(next.bodies["sec-1"]).toBe(bodies["sec-1"]);
  });

  it("independent decisions: accept one, reject another", () => {
    let state = initReviewState([revA, revB], bodies);
    state = reviewReducer(state, { type: "accept", revision: revB });
    state = reviewReducer(state, { type: "reject", revisionId: "rev-a" });
    expect(state.decisions).toEqual({ "rev-a": "rejected", "rev-b": "accepted" });
    expect(state.bodies["sec-2"]).toBe("Rewritten.");
    expect(pendingCount(state)).toBe(0);
  });

  it("reopen returns a decision to pending", () => {
    let state = initReviewState([revA], bodies);
    state = reviewReducer(state, { type: "reject", revisionId: "rev-a" });
    state = reviewReducer(state, { type: "reopen", revisionId: "rev-a" });
    expect(state.decisions["rev-a"]).toBe("pending");
  });
});

// ---------------------------------------------------------------------------
// Rebasing: ops always target ORIGINAL line numbers, even after accepts.
// ---------------------------------------------------------------------------

const fiveLines = "line one\nline two\nline three\nline four\nline five";

/** Replaces original line 1 with two lines — everything below shifts by +1. */
const growTop: RevisionLite = {
  id: "rev-top",
  sectionId: "sec-1",
  diff: [{ lineStart: 1, lineEnd: 1, replacement: "line one A\nline one B" }],
};
/** Rewrites original line 4. */
const editLine4: RevisionLite = {
  id: "rev-l4",
  sectionId: "sec-1",
  diff: [{ lineStart: 4, lineEnd: 4, replacement: "LINE FOUR" }],
};
/** Deletes original lines 2–3 — overlaps nothing above line 2. */
const deleteMid: RevisionLite = {
  id: "rev-mid",
  sectionId: "sec-1",
  diff: [{ lineStart: 2, lineEnd: 3, replacement: "" }],
};
/** Overlaps deleteMid (both touch original line 3). */
const editLine3: RevisionLite = {
  id: "rev-l3",
  sectionId: "sec-1",
  diff: [{ lineStart: 3, lineEnd: 3, replacement: "LINE THREE" }],
};

const fiveLineBodies = { "sec-1": fiveLines };

describe("reviewReducer rebasing (non-overlapping suggestions)", () => {
  const expected = "line one A\nline one B\nline two\nline three\nLINE FOUR\nline five";

  it("accepting a line-count-changing diff first does not corrupt the second", () => {
    let state = initReviewState([growTop, editLine4], fiveLineBodies);
    state = reviewReducer(state, { type: "accept", revision: growTop });
    state = reviewReducer(state, { type: "accept", revision: editLine4 });
    expect(state.bodies["sec-1"]).toBe(expected);
  });

  it("accept order does not matter — reverse order yields the same body", () => {
    let state = initReviewState([growTop, editLine4], fiveLineBodies);
    state = reviewReducer(state, { type: "accept", revision: editLine4 });
    state = reviewReducer(state, { type: "accept", revision: growTop });
    expect(state.bodies["sec-1"]).toBe(expected);
  });

  it("a deletion above does not shift a later suggestion's target lines", () => {
    let state = initReviewState([deleteMid, editLine4], fiveLineBodies);
    state = reviewReducer(state, { type: "accept", revision: deleteMid });
    state = reviewReducer(state, { type: "accept", revision: editLine4 });
    expect(state.bodies["sec-1"]).toBe("line one\nLINE FOUR\nline five");
  });
});

describe("stale (overlapping) suggestions", () => {
  it("overlap detection covers shared lines and containment", () => {
    const line3Op = { lineStart: 3, lineEnd: 3, replacement: "LINE THREE" };
    expect(opsOverlap({ lineStart: 2, lineEnd: 3, replacement: "" }, line3Op)).toBe(true);
    expect(opsOverlap({ lineStart: 1, lineEnd: 1, replacement: "" }, line3Op)).toBe(false);
  });

  it("accepting one of two overlapping suggestions marks the other stale, in either order", () => {
    for (const [first, second] of [
      [deleteMid, editLine3],
      [editLine3, deleteMid],
    ] as const) {
      let state = initReviewState([deleteMid, editLine3], fiveLineBodies);
      expect(isRevisionStale(state, second)).toBe(false);
      state = reviewReducer(state, { type: "accept", revision: first });
      expect(isRevisionStale(state, second)).toBe(true);
      // Accepting the stale one is refused — body and decision unchanged.
      const after = reviewReducer(state, { type: "accept", revision: second });
      expect(after).toBe(state);
      expect(after.decisions[second.id]).toBe("pending");
    }
  });

  it("a stale suggestion can still be rejected", () => {
    let state = initReviewState([deleteMid, editLine3], fiveLineBodies);
    state = reviewReducer(state, { type: "accept", revision: deleteMid });
    state = reviewReducer(state, { type: "reject", revisionId: editLine3.id });
    expect(state.decisions[editLine3.id]).toBe("rejected");
    expect(state.bodies["sec-1"]).toBe("line one\nline four\nline five");
  });
});

describe("previewBodyFor", () => {
  it("previews a pending suggestion on top of the accepted set", () => {
    let state = initReviewState([growTop, editLine4], fiveLineBodies);
    // Before anything is accepted the preview is original + the suggestion.
    expect(previewBodyFor(state, editLine4)).toBe(
      "line one\nline two\nline three\nLINE FOUR\nline five",
    );
    state = reviewReducer(state, { type: "accept", revision: growTop });
    // After accepting growTop, the preview includes both — LINE FOUR stays on
    // the right (original) line even though the body grew above it.
    expect(previewBodyFor(state, editLine4)).toBe(
      "line one A\nline one B\nline two\nline three\nLINE FOUR\nline five",
    );
    expect(state.bodies["sec-1"]).toBe(
      "line one A\nline one B\nline two\nline three\nline four\nline five",
    );
  });
});
