// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { workspaceGateState } from "@/components/shell/workspace-gate";

/**
 * P0 regression — the app-shell workspace gate must never leave a user on an
 * infinite "Loading workspace…" spinner. The pure decision function is the
 * single source of truth for the three states, so it is exercised directly
 * (the surrounding component wires it to trpc + the workspace context).
 */

describe("workspaceGateState", () => {
  it("shows a spinner only while genuinely loading", () => {
    expect(
      workspaceGateState({
        workspacesLoading: true,
        hasNoWorkspaces: false,
        autoCreateStatus: "idle",
      }),
    ).toBe("loading");
  });

  it("loaded + empty → CTA (not an infinite spinner) once auto-create has failed", () => {
    expect(
      workspaceGateState({
        workspacesLoading: false,
        hasNoWorkspaces: true,
        autoCreateStatus: "error",
      }),
    ).toBe("empty");
  });

  it("loaded + empty shows a BOUNDED spinner while auto-create is in flight", () => {
    // idle = about to fire; pending = in flight. Both resolve to a workspace or
    // an error, so the spinner is bounded — never the old infinite hang.
    expect(
      workspaceGateState({
        workspacesLoading: false,
        hasNoWorkspaces: true,
        autoCreateStatus: "idle",
      }),
    ).toBe("loading");
    expect(
      workspaceGateState({
        workspacesLoading: false,
        hasNoWorkspaces: true,
        autoCreateStatus: "pending",
      }),
    ).toBe("loading");
  });

  it("a user WITH workspaces is unaffected — renders content", () => {
    expect(
      workspaceGateState({
        workspacesLoading: false,
        hasNoWorkspaces: false,
        autoCreateStatus: "idle",
      }),
    ).toBe("content");
  });
});
