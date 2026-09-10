import { and, eq } from "drizzle-orm";
import { getConfig } from "@/lib/config";
import type { RoleResolver } from "@/lib/authz";
import { getDb, hasDb, schema } from "@/db";
import { getSharedWorkspaceStore } from "@/server/workspace/memory";

/**
 * Session → workspace membership resolution.
 *
 * The production resolver reads the memberships table. In fixture mode
 * without a database, the fixture user owns the fixture workspace and has no
 * access anywhere else — which keeps cross-tenant behavior testable even
 * with zero infrastructure.
 */

export const dbRoleResolver: RoleResolver = async (userId, workspaceId) => {
  const db = getDb();
  const rows = await db
    .select({ role: schema.memberships.role })
    .from(schema.memberships)
    .where(
      and(eq(schema.memberships.userId, userId), eq(schema.memberships.workspaceId, workspaceId)),
    )
    .limit(1);
  return rows[0]?.role ?? null;
};

export const fixtureRoleResolver: RoleResolver = (userId, workspaceId) => {
  // The shared in-memory workspace store is seeded with exactly the fixture
  // owner membership, so the default behavior is unchanged — but workspaces
  // and members created at runtime in fixture mode resolve too.
  return Promise.resolve(getSharedWorkspaceStore().roleFor(userId, workspaceId));
};

/** Pick the resolver for the current environment. */
export function getRoleResolver(): RoleResolver {
  if (getConfig().PROVIDERS === "fixture" || !hasDb()) {
    return fixtureRoleResolver;
  }
  return dbRoleResolver;
}
