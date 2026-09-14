"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { trpc } from "@/components/providers/trpc";
import { useWorkspace } from "@/components/providers/workspace-context";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState } from "@/components/ui/state";

/**
 * Workspace gate (P0 empty-workspace hang).
 *
 * A freshly signed-in user with ZERO memberships used to spin on "Loading
 * workspace…" forever: every screen guards on `workspaceId === null`, which
 * never resolves when the list is empty. This gate sits between the app shell
 * and the screen and distinguishes three states:
 *
 *   - loading  → genuine spinner (list still fetching / selection resolving)
 *   - empty    → a "Create your workspace" CTA (never an infinite spinner)
 *   - content  → the real screen
 *
 * On an empty list it also fires `workspace.ensureDefault` ONCE to auto-create
 * a default workspace so the playtest is not brickwalled; the CTA is only ever
 * shown if that auto-create fails, so the user always has a way forward.
 */

export type WorkspaceGateState = "loading" | "empty" | "content";

/** RQ mutation status — kept as a local alias so the pure fn is unit-testable. */
export type AutoCreateStatus = "idle" | "pending" | "error" | "success";

/**
 * Pure decision: given the workspace-context signals plus the auto-create
 * mutation's status, decide what the gate should render.
 *
 * Key property: a loaded-and-empty workspace list NEVER yields "loading"
 * indefinitely. While auto-create is idle/pending we show a bounded spinner;
 * once it has settled (success or error) and the list is still empty, we fall
 * through to the CTA. So the infinite hang is structurally impossible.
 */
export function workspaceGateState(input: {
  workspacesLoading: boolean;
  hasNoWorkspaces: boolean;
  autoCreateStatus: AutoCreateStatus;
}): WorkspaceGateState {
  if (input.workspacesLoading) return "loading";
  if (input.hasNoWorkspaces) {
    return input.autoCreateStatus === "idle" || input.autoCreateStatus === "pending"
      ? "loading"
      : "empty";
  }
  return "content";
}

function CreateWorkspaceCta() {
  return (
    <EmptyState
      title="Create your workspace"
      hint="A workspace holds your channels, projects, and team. Set one up to get started."
      action={
        <Link href="/onboarding">
          <Button variant="primary">Create workspace</Button>
        </Link>
      }
    />
  );
}

export function WorkspaceGate({ children }: { children: ReactNode }) {
  const { workspacesLoading, hasNoWorkspaces, selectWorkspace } = useWorkspace();
  const utils = trpc.useUtils();

  const ensureDefault = trpc.workspace.ensureDefault.useMutation({
    onSuccess: (ws) => {
      // Make the new workspace visible to list consumers before selecting it,
      // mirroring the onboarding create flow (avoids resolving the selection
      // against a stale, empty list).
      utils.workspace.list.setData(undefined, (prev) => {
        if (prev === undefined) return [ws];
        return prev.some((w) => w.id === ws.id) ? prev : [...prev, ws];
      });
      void utils.workspace.list.invalidate();
      selectWorkspace(ws.id);
    },
  });

  // Fire the idempotent auto-create exactly once per empty-list episode. The
  // ref guards against re-firing on re-renders; it resets if workspaces appear
  // (e.g. the user created one elsewhere) so a later empty state can retry.
  const firedRef = useRef(false);
  const { mutate: ensureDefaultMutate, isIdle } = ensureDefault;
  useEffect(() => {
    if (hasNoWorkspaces && !firedRef.current && isIdle) {
      firedRef.current = true;
      ensureDefaultMutate();
    }
    if (!hasNoWorkspaces) firedRef.current = false;
  }, [hasNoWorkspaces, isIdle, ensureDefaultMutate]);

  const state = workspaceGateState({
    workspacesLoading,
    hasNoWorkspaces,
    autoCreateStatus: ensureDefault.status,
  });

  if (state === "loading") return <LoadingState label="Loading workspace…" />;
  if (state === "empty") return <CreateWorkspaceCta />;
  return <>{children}</>;
}
