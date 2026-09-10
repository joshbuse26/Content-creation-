import type { DiffOp } from "@/lib/types/entities";
import { applyDiffOps } from "./diff";

/**
 * Local accept/reject state for the revision review screen — pure and
 * unit-tested. The server is the source of truth (revision.accept/reject
 * mutations); this reducer keeps the screen consistent while mutations are
 * in flight and applies accepted diffs to the local section bodies.
 *
 * Coordinates: every revision's diff ops target the ORIGINAL section body
 * (the body as loaded when the review started), not the body with earlier
 * accepted suggestions applied. The state therefore keeps the original
 * bodies plus the accepted ops per section, and recomputes each working
 * body from the original — applyDiffOps applies non-overlapping ops
 * bottom-up, so line numbers never shift underneath later ops. A pending
 * suggestion whose ops overlap an already-accepted op no longer applies
 * cleanly and is reported stale via isRevisionStale.
 */

export type Decision = "pending" | "accepted" | "rejected";

export interface RevisionLite {
  id: string;
  sectionId: string;
  diff: DiffOp[];
}

export interface RevisionReviewState {
  /** revisionId -> decision */
  decisions: Record<string, Decision>;
  /** sectionId -> body as loaded — the coordinates every diff op targets */
  originalBodies: Record<string, string>;
  /** sectionId -> ops accepted this review session (original coordinates) */
  acceptedOps: Record<string, DiffOp[]>;
  /** sectionId -> working body (original with all accepted ops applied) */
  bodies: Record<string, string>;
}

export function initReviewState(
  revisions: readonly RevisionLite[],
  sectionBodies: Record<string, string>,
  serverDecisions: Record<string, Decision> = {},
): RevisionReviewState {
  const decisions: Record<string, Decision> = {};
  for (const r of revisions) decisions[r.id] = serverDecisions[r.id] ?? "pending";
  return {
    decisions,
    originalBodies: { ...sectionBodies },
    acceptedOps: {},
    bodies: { ...sectionBodies },
  };
}

/** Inclusive 1-indexed line ranges: do two ops touch any common line? */
export function opsOverlap(a: DiffOp, b: DiffOp): boolean {
  const aEnd = Math.max(a.lineEnd, a.lineStart);
  const bEnd = Math.max(b.lineEnd, b.lineStart);
  return a.lineStart <= bEnd && b.lineStart <= aEnd;
}

/**
 * A pending suggestion is stale when any of its ops overlaps an op already
 * accepted for the same section — it no longer applies cleanly and must not
 * be accepted (the UI disables it with a note).
 */
export function isRevisionStale(state: RevisionReviewState, revision: RevisionLite): boolean {
  const accepted = state.acceptedOps[revision.sectionId] ?? [];
  return revision.diff.some((op) => accepted.some((a) => opsOverlap(op, a)));
}

/**
 * The section body with this (non-stale) revision applied on top of the
 * already-accepted set — what the preview diff renders against the current
 * working body.
 */
export function previewBodyFor(state: RevisionReviewState, revision: RevisionLite): string {
  const original = state.originalBodies[revision.sectionId];
  if (original === undefined) return "";
  return applyDiffOps(original, [
    ...(state.acceptedOps[revision.sectionId] ?? []),
    ...revision.diff,
  ]);
}

export type ReviewAction =
  | { type: "accept"; revision: RevisionLite }
  | { type: "reject"; revisionId: string }
  | { type: "reopen"; revisionId: string };

export function reviewReducer(
  state: RevisionReviewState,
  action: ReviewAction,
): RevisionReviewState {
  switch (action.type) {
    case "accept": {
      const { revision } = action;
      const current = state.decisions[revision.id];
      if (current === "accepted") return state; // idempotent
      if (isRevisionStale(state, revision)) return state; // no longer applies cleanly
      const original = state.originalBodies[revision.sectionId];
      const accepted = [...(state.acceptedOps[revision.sectionId] ?? []), ...revision.diff];
      return {
        decisions: { ...state.decisions, [revision.id]: "accepted" },
        originalBodies: state.originalBodies,
        acceptedOps: { ...state.acceptedOps, [revision.sectionId]: accepted },
        bodies:
          original === undefined
            ? state.bodies
            : { ...state.bodies, [revision.sectionId]: applyDiffOps(original, accepted) },
      };
    }
    case "reject": {
      if (state.decisions[action.revisionId] === "rejected") return state;
      return {
        ...state,
        decisions: { ...state.decisions, [action.revisionId]: "rejected" },
      };
    }
    case "reopen":
      return {
        ...state,
        decisions: { ...state.decisions, [action.revisionId]: "pending" },
      };
  }
}

export function pendingCount(state: RevisionReviewState): number {
  return Object.values(state.decisions).filter((d) => d === "pending").length;
}
