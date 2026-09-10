import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { FIXTURE_IDS } from "@/lib/fixtures";
import type { Role } from "@/lib/types/enums";
import { asUserId, workspaceIdSchema, type UserId } from "@/lib/types/ids";
import { workspaceHandlers } from "@/server/routers/impl/workspace";
import {
  getSharedWorkspaceStore,
  resetSharedWorkspaceStoreForTests,
} from "@/server/workspace/memory";

/**
 * Regression tests for the workspace.setRole privilege-escalation fix:
 * only an owner may grant or revoke the owner role, or modify/remove
 * another owner. Runs against the in-memory store (no DATABASE_URL).
 */

const workspaceId = workspaceIdSchema.parse(FIXTURE_IDS.workspace);
const ownerUserId = asUserId(FIXTURE_IDS.user);

function seedMember(email: string, role: Role): UserId {
  const store = getSharedWorkspaceStore();
  const user = store.findOrCreateUserByEmail(email);
  const userId = asUserId(user.id);
  store.upsertMembership(workspaceId, userId, role);
  return userId;
}

function ctxFor(userId: UserId, role: Role) {
  return { userId, workspaceId, role };
}

async function expectTrpcCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toSatisfy(
    (err: unknown) => err instanceof TRPCError && err.code === code,
  );
}

describe("workspace.setRole owner guard", () => {
  beforeEach(() => {
    resetSharedWorkspaceStoreForTests();
  });
  afterEach(() => {
    resetSharedWorkspaceStoreForTests();
  });

  it("FORBIDDEN when an admin tries to self-promote to owner", async () => {
    const adminId = seedMember("admin@example.com", "admin");
    await expectTrpcCode(
      workspaceHandlers.setRole({
        ctx: ctxFor(adminId, "admin"),
        input: { workspaceId, userId: adminId, role: "owner" },
      }),
      "FORBIDDEN",
    );
    // Role unchanged.
    expect(getSharedWorkspaceStore().roleFor(adminId, workspaceId)).toBe("admin");
  });

  it("FORBIDDEN when an admin tries to promote someone else to owner", async () => {
    const adminId = seedMember("admin@example.com", "admin");
    const writerId = seedMember("writer@example.com", "writer");
    await expectTrpcCode(
      workspaceHandlers.setRole({
        ctx: ctxFor(adminId, "admin"),
        input: { workspaceId, userId: writerId, role: "owner" },
      }),
      "FORBIDDEN",
    );
  });

  it("FORBIDDEN when an admin tries to demote an owner", async () => {
    const adminId = seedMember("admin@example.com", "admin");
    const coOwnerId = seedMember("co-owner@example.com", "owner");
    await expectTrpcCode(
      workspaceHandlers.setRole({
        ctx: ctxFor(adminId, "admin"),
        input: { workspaceId, userId: coOwnerId, role: "viewer" },
      }),
      "FORBIDDEN",
    );
    expect(getSharedWorkspaceStore().roleFor(coOwnerId, workspaceId)).toBe("owner");
  });

  it("FORBIDDEN when an admin tries to remove an owner", async () => {
    const adminId = seedMember("admin@example.com", "admin");
    const coOwnerId = seedMember("co-owner@example.com", "owner");
    await expectTrpcCode(
      workspaceHandlers.removeMember({
        ctx: ctxFor(adminId, "admin"),
        input: { workspaceId, userId: coOwnerId },
      }),
      "FORBIDDEN",
    );
    expect(getSharedWorkspaceStore().roleFor(coOwnerId, workspaceId)).toBe("owner");
  });

  it("an owner may promote a member to owner and demote a co-owner", async () => {
    const adminId = seedMember("admin@example.com", "admin");
    const promoted = await workspaceHandlers.setRole({
      ctx: ctxFor(ownerUserId, "owner"),
      input: { workspaceId, userId: adminId, role: "owner" },
    });
    expect(promoted.role).toBe("owner");

    const demoted = await workspaceHandlers.setRole({
      ctx: ctxFor(ownerUserId, "owner"),
      input: { workspaceId, userId: adminId, role: "admin" },
    });
    expect(demoted.role).toBe("admin");
  });

  it("still refuses demoting the last owner (BAD_REQUEST)", async () => {
    await expectTrpcCode(
      workspaceHandlers.setRole({
        ctx: ctxFor(ownerUserId, "owner"),
        input: { workspaceId, userId: ownerUserId, role: "admin" },
      }),
      "BAD_REQUEST",
    );
  });

  it("admins can still manage non-owner roles", async () => {
    const adminId = seedMember("admin@example.com", "admin");
    const writerId = seedMember("writer@example.com", "writer");
    const updated = await workspaceHandlers.setRole({
      ctx: ctxFor(adminId, "admin"),
      input: { workspaceId, userId: writerId, role: "viewer" },
    });
    expect(updated.role).toBe("viewer");
  });
});
