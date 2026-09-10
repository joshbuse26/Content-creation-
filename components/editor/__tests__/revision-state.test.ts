import { describe, expect, it } from "vitest";
import {
  initReviewState,
  pendingCount,
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
