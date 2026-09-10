import type { DiffOp } from "@/lib/types/entities";
import { applyDiffOps } from "./diff";

/**
 * Local accept/reject state for the revision review screen — pure and
 * unit-tested. The server is the source of truth (revision.accept/reject
 * mutations); this reducer keeps the screen consistent while mutations are
 * in flight and applies accepted diffs to the local section bodies.
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
  /** sectionId -> working body (with accepted revisions applied) */
  bodies: Record<string, string>;
}

export function initReviewState(
  revisions: readonly RevisionLite[],
  sectionBodies: Record<string, string>,
  serverDecisions: Record<string, Decision> = {},
): RevisionReviewState {
  const decisions: Record<string, Decision> = {};
  for (const r of revisions) decisions[r.id] = serverDecisions[r.id] ?? "pending";
  return { decisions, bodies: { ...sectionBodies } };
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
      const body = state.bodies[revision.sectionId];
      return {
        decisions: { ...state.decisions, [revision.id]: "accepted" },
        bodies:
          body === undefined
            ? state.bodies
            : { ...state.bodies, [revision.sectionId]: applyDiffOps(body, revision.diff) },
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
