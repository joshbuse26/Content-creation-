import { TRPCError } from "@trpc/server";
import { ROLES, type Role } from "@/lib/types/enums";
import type { UserId, WorkspaceId } from "@/lib/types/ids";

/**
 * Authorization — the hard gate (build spec §4).
 *
 * Every object access goes through assertAccess. IDs from the client are
 * never trusted: the role is resolved server-side from the memberships table
 * (or an injected resolver in tests/fixture mode), and non-membership is a
 * FORBIDDEN, indistinguishable from a missing workspace.
 *
 * Matrix: viewer = read · writer = +create/edit content · admin = +channels/
 * members/templates · owner = +billing/API keys.
 */

export const RESOURCES = [
  "workspace",
  "member",
  "channel",
  "avatar",
  "voiceProfile",
  "idea",
  "project",
  "research",
  "frame",
  "script",
  "revision",
  "titles",
  "thumbnail",
  "description",
  "tags",
  "chapters",
  "template",
  "dashboard",
  "billing",
  "apiKey",
  // Wave C: seeded archetype catalog — readable by every member, writable
  // by no role (rows come from seed/fixture data only).
  "archetype",
  // Wave D: chat threads/messages — content a writer creates and manages.
  "chat",
] as const;
export type Resource = (typeof RESOURCES)[number];

export const ACTIONS = ["read", "create", "update", "delete"] as const;
export type Action = (typeof ACTIONS)[number];

/** Content resources a writer may create/edit/delete. */
const WRITER_RESOURCES: readonly Resource[] = [
  "idea",
  "project",
  "research",
  "frame",
  "script",
  "revision",
  "titles",
  "thumbnail",
  "description",
  "tags",
  "chapters",
  "avatar",
  "voiceProfile",
  "chat",
];

/** Admin adds channel management, members, templates, workspace settings. */
const ADMIN_RESOURCES: readonly Resource[] = [
  ...WRITER_RESOURCES,
  "channel",
  "member",
  "template",
  "workspace",
];

/** Owner adds billing and API keys. */
const OWNER_RESOURCES: readonly Resource[] = [...ADMIN_RESOURCES, "billing", "apiKey"];

const ROLE_RANK: Record<Role, number> = { viewer: 0, writer: 1, admin: 2, owner: 3 };

/** Resources whose read is restricted beyond plain membership. */
const OWNER_READ_RESOURCES: readonly Resource[] = ["apiKey"];
const ADMIN_READ_RESOURCES: readonly Resource[] = [];

export function can(role: Role, resource: Resource, action: Action): boolean {
  if (action === "read") {
    if (OWNER_READ_RESOURCES.includes(resource)) return role === "owner";
    if (ADMIN_READ_RESOURCES.includes(resource)) return ROLE_RANK[role] >= ROLE_RANK.admin;
    // Billing summaries are visible to admins and owners only.
    if (resource === "billing") return ROLE_RANK[role] >= ROLE_RANK.admin;
    return true; // every member can read content
  }
  switch (role) {
    case "viewer":
      return false;
    case "writer":
      return WRITER_RESOURCES.includes(resource);
    case "admin":
      return ADMIN_RESOURCES.includes(resource);
    case "owner":
      return OWNER_RESOURCES.includes(resource);
  }
}

/**
 * Resolves a user's role in a workspace, or null when not a member.
 * The production resolver queries the memberships table (server/membership.ts);
 * tests and fixture mode inject their own.
 */
export type RoleResolver = (userId: UserId, workspaceId: WorkspaceId) => Promise<Role | null>;

export async function assertAccess(
  userId: UserId,
  workspaceId: WorkspaceId,
  resource: Resource,
  action: Action,
  resolveRole: RoleResolver,
): Promise<Role> {
  const role = await resolveRole(userId, workspaceId);
  if (role === null || !ROLES.includes(role)) {
    // Not a member — same error as no-permission so tenancy is not probeable.
    throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
  }
  if (!can(role, resource, action)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
  }
  return role;
}
