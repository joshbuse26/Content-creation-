import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FIXTURE_IDS } from "@/lib/fixtures";
import { asUserId } from "@/lib/types/ids";
import { workspaceHandlers } from "@/server/routers/impl/workspace";
import {
  getSharedWorkspaceStore,
  resetSharedWorkspaceStoreForTests,
} from "@/server/workspace/memory";

/**
 * P0 regression — workspace.ensureDefault (empty-workspace bootstrap).
 *
 * A brand-new user with zero memberships must be able to land in a usable app
 * instead of spinning forever. ensureDefault auto-creates a single default
 * workspace, and must be IDEMPOTENT: calling it again (or on every empty-list
 * load) never creates a second workspace. Runs against the in-memory store
 * (no DATABASE_URL), same as the other workspace handler tests.
 */

describe("workspace.ensureDefault bootstrap", () => {
  beforeEach(() => {
    resetSharedWorkspaceStoreForTests();
  });
  afterEach(() => {
    resetSharedWorkspaceStoreForTests();
  });

  it("creates a default workspace for a user with none", async () => {
    // A fresh user id that has no seeded membership.
    const store = getSharedWorkspaceStore();
    const user = store.findOrCreateUserByEmail("newbie@example.com");
    const ctx = { userId: asUserId(user.id) };

    expect(await workspaceHandlers.list({ ctx })).toHaveLength(0);

    const ws = await workspaceHandlers.ensureDefault({ ctx });
    expect(ws.role).toBe("owner");
    expect(await workspaceHandlers.list({ ctx })).toHaveLength(1);
  });

  it("is idempotent — calling twice yields exactly one workspace", async () => {
    const store = getSharedWorkspaceStore();
    const user = store.findOrCreateUserByEmail("newbie@example.com");
    const ctx = { userId: asUserId(user.id) };

    const first = await workspaceHandlers.ensureDefault({ ctx });
    const second = await workspaceHandlers.ensureDefault({ ctx });

    expect(second.id).toBe(first.id);
    expect(await workspaceHandlers.list({ ctx })).toHaveLength(1);
  });

  it("returns the existing workspace without creating another (fixture user)", async () => {
    // The fixture user already owns the seeded fixture workspace.
    const ctx = { userId: asUserId(FIXTURE_IDS.user) };
    const before = await workspaceHandlers.list({ ctx });
    expect(before.length).toBeGreaterThan(0);

    const ws = await workspaceHandlers.ensureDefault({ ctx });
    expect(ws.id).toBe(before[0]?.id);
    // No new workspace was created.
    expect(await workspaceHandlers.list({ ctx })).toHaveLength(before.length);
  });
});
