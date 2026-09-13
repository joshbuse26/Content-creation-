import { beforeEach, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import type { Session } from "next-auth";
import { FIXTURE_IDS } from "@/lib/fixtures";
import type { RoleResolver } from "@/lib/authz";
import { asWorkspaceId } from "@/lib/types/ids";
import { fixtureRoleResolver } from "@/server/membership";
import { resetCommentMemoryForTests } from "@/server/routers/impl/comments";
import { appRouter } from "@/server/routers";
import { createCallerFactory, type TrpcContext } from "@/server/trpc";

/**
 * E4 — per-section comment threads through the real tRPC middleware.
 * Role gating (viewer read-only, writer+ add/resolve, author-or-admin remove),
 * tenancy (cross-workspace → FORBIDDEN), and no-credit by contract.
 */

const createCaller = createCallerFactory(appRouter);
const WS = asWorkspaceId(FIXTURE_IDS.workspace);

/** A second user id — used for the "not the author" remove case. */
const OTHER_USER = "00000000-0000-4000-8000-0000000000e9";

function ctxFor(
  role: "viewer" | "writer" | "admin" | "owner" | null,
  userId: string = FIXTURE_IDS.user,
): TrpcContext {
  const resolveRole: RoleResolver = (_u, w) =>
    Promise.resolve((w as string) === FIXTURE_IDS.workspace ? role : null);
  const session: Session | null = {
    user: { id: userId },
    expires: new Date(Date.now() + 3_600_000).toISOString(),
  };
  return { session, resolveRole, requestId: "test-request" };
}

beforeEach(() => {
  resetCommentMemoryForTests();
});

describe("comments — role gating", () => {
  it("every member can list comments; the fixture comment is seeded", async () => {
    const caller = createCaller(ctxFor("viewer"));
    const comments = await caller.comments.list({
      workspaceId: WS,
      scriptId: FIXTURE_IDS.script,
      sectionId: null,
    });
    expect(comments.length).toBeGreaterThanOrEqual(1);
    expect(comments.some((c) => c.id === FIXTURE_IDS.sectionComment)).toBe(true);
  });

  it("a viewer cannot add, resolve, or remove a comment (FORBIDDEN)", async () => {
    const viewer = createCaller(ctxFor("viewer"));
    for (const attempt of [
      viewer.comments.add({ workspaceId: WS, sectionId: FIXTURE_IDS.sectionHook, body: "no" }),
      viewer.comments.resolve({ workspaceId: WS, commentId: FIXTURE_IDS.sectionComment }),
      viewer.comments.remove({ workspaceId: WS, commentId: FIXTURE_IDS.sectionComment }),
    ]) {
      const err = await attempt.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe("FORBIDDEN");
    }
  });

  it("a writer can add, resolve, and unresolve a comment", async () => {
    const writer = createCaller(ctxFor("writer"));
    const added = await writer.comments.add({
      workspaceId: WS,
      sectionId: FIXTURE_IDS.sectionHook,
      body: "Tighten the open loop.",
    });
    expect(added.body).toBe("Tighten the open loop.");
    expect(added.resolved).toBe(false);
    expect(added.authorUserId).toBe(FIXTURE_IDS.user);
    // It carries the section's script + project (anchored server-side).
    expect(added.scriptId).toBe(FIXTURE_IDS.script);

    const resolved = await writer.comments.resolve({ workspaceId: WS, commentId: added.id });
    expect(resolved.resolved).toBe(true);
    const reopened = await writer.comments.unresolve({ workspaceId: WS, commentId: added.id });
    expect(reopened.resolved).toBe(false);
  });
});

describe("comments — author-or-admin remove rule", () => {
  it("the author may remove their own comment", async () => {
    const writer = createCaller(ctxFor("writer"));
    const added = await writer.comments.add({
      workspaceId: WS,
      sectionId: FIXTURE_IDS.sectionHook,
      body: "mine",
    });
    const removed = await writer.comments.remove({ workspaceId: WS, commentId: added.id });
    expect(removed.removed).toBe(true);
  });

  it("a writer who is NOT the author cannot remove another member's comment", async () => {
    // The seeded fixture comment is authored by FIXTURE_IDS.user; act as a
    // different writer.
    const otherWriter = createCaller(ctxFor("writer", OTHER_USER));
    const err = await otherWriter.comments
      .remove({ workspaceId: WS, commentId: FIXTURE_IDS.sectionComment })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("FORBIDDEN");
  });

  it("an admin may remove any member's comment", async () => {
    const admin = createCaller(ctxFor("admin", OTHER_USER));
    const removed = await admin.comments.remove({
      workspaceId: WS,
      commentId: FIXTURE_IDS.sectionComment,
    });
    expect(removed.removed).toBe(true);
  });
});

describe("comments — tenancy", () => {
  it("cross-workspace access is FORBIDDEN through the middleware", async () => {
    const caller = createCaller({
      session: {
        user: { id: FIXTURE_IDS.user },
        expires: new Date(Date.now() + 3_600_000).toISOString(),
      },
      resolveRole: fixtureRoleResolver,
      requestId: "test-request",
    });
    const err = await caller.comments
      .list({
        workspaceId: asWorkspaceId(FIXTURE_IDS.otherWorkspace),
        scriptId: FIXTURE_IDS.script,
        sectionId: null,
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("FORBIDDEN");
  });

  it("an unknown section id is NOT_FOUND on add", async () => {
    const writer = createCaller(ctxFor("writer"));
    const err = await writer.comments
      .add({
        workspaceId: WS,
        sectionId: "00000000-0000-4000-8000-00000000dead",
        body: "ghost",
      })
      .catch((e: unknown) => e);
    expect((err as TRPCError).code).toBe("NOT_FOUND");
  });
});
