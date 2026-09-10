import { randomUUID } from "node:crypto";
import { fixtureMembership, fixtureUser, fixtureWorkspace } from "@/lib/fixtures";
import {
  membershipIdSchema,
  userIdSchema,
  workspaceIdSchema,
  type UserId,
  type WorkspaceId,
} from "@/lib/types/ids";
import type { Membership, User, Workspace } from "@/lib/types/entities";
import type { Role } from "@/lib/types/enums";

/**
 * In-memory workspace/membership store — keyless fixture mode. Seeded with
 * the fixture workspace + owner so a zero-env boot has a working tenant, and
 * consulted by the fixture role resolver (server/membership.ts) so
 * workspaces created at runtime in fixture mode are actually reachable
 * through the authz middleware.
 */
export class InMemoryWorkspaceStore {
  readonly workspaces: Workspace[] = [];
  readonly users: User[] = [];
  readonly memberships: Membership[] = [];

  constructor() {
    this.workspaces.push({ ...fixtureWorkspace });
    this.users.push({ ...fixtureUser });
    this.memberships.push({ ...fixtureMembership });
  }

  roleFor(userId: UserId, workspaceId: WorkspaceId): Role | null {
    const membership = this.memberships.find(
      (m) => m.userId === userId && m.workspaceId === workspaceId,
    );
    return membership?.role ?? null;
  }

  listForUser(userId: UserId): (Workspace & { role: Role })[] {
    return this.memberships
      .filter((m) => m.userId === userId)
      .flatMap((m) => {
        const workspace = this.workspaces.find((w) => w.id === m.workspaceId);
        return workspace === undefined ? [] : [{ ...workspace, role: m.role }];
      });
  }

  get(workspaceId: WorkspaceId): Workspace | null {
    const workspace = this.workspaces.find((w) => w.id === workspaceId);
    return workspace === undefined ? null : { ...workspace };
  }

  create(name: string, ownerUserId: UserId): Workspace {
    const now = new Date();
    const workspace: Workspace = {
      id: workspaceIdSchema.parse(randomUUID()),
      name,
      plan: "free",
      creditBalance: 8,
      billingCycleAnchor: null,
      createdAt: now,
      updatedAt: now,
    };
    this.workspaces.push(workspace);
    this.memberships.push({
      id: membershipIdSchema.parse(randomUUID()),
      workspaceId: workspace.id,
      userId: ownerUserId,
      role: "owner",
      createdAt: now,
      updatedAt: now,
    });
    return { ...workspace };
  }

  rename(workspaceId: WorkspaceId, name: string): Workspace | null {
    const workspace = this.workspaces.find((w) => w.id === workspaceId);
    if (workspace === undefined) return null;
    workspace.name = name;
    workspace.updatedAt = new Date();
    return { ...workspace };
  }

  members(workspaceId: WorkspaceId): (Membership & { user: User })[] {
    return this.memberships
      .filter((m) => m.workspaceId === workspaceId)
      .flatMap((m) => {
        const user = this.users.find((u) => u.id === m.userId);
        return user === undefined ? [] : [{ ...m, user: { ...user } }];
      });
  }

  findOrCreateUserByEmail(email: string): User {
    const existing = this.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (existing !== undefined) return { ...existing };
    const now = new Date();
    const user: User = {
      id: userIdSchema.parse(randomUUID()),
      email,
      name: null,
      image: null,
      createdAt: now,
      updatedAt: now,
    };
    this.users.push(user);
    return { ...user };
  }

  upsertMembership(workspaceId: WorkspaceId, userId: UserId, role: Role): Membership {
    const existing = this.memberships.find(
      (m) => m.workspaceId === workspaceId && m.userId === userId,
    );
    const now = new Date();
    if (existing !== undefined) {
      existing.role = role;
      existing.updatedAt = now;
      return { ...existing };
    }
    const membership: Membership = {
      id: membershipIdSchema.parse(randomUUID()),
      workspaceId,
      userId,
      role,
      createdAt: now,
      updatedAt: now,
    };
    this.memberships.push(membership);
    return { ...membership };
  }

  membershipFor(workspaceId: WorkspaceId, userId: UserId): Membership | null {
    const membership = this.memberships.find(
      (m) => m.workspaceId === workspaceId && m.userId === userId,
    );
    return membership === undefined ? null : { ...membership };
  }

  ownerCount(workspaceId: WorkspaceId): number {
    return this.memberships.filter((m) => m.workspaceId === workspaceId && m.role === "owner")
      .length;
  }

  removeMembership(workspaceId: WorkspaceId, userId: UserId): boolean {
    const index = this.memberships.findIndex(
      (m) => m.workspaceId === workspaceId && m.userId === userId,
    );
    if (index === -1) return false;
    this.memberships.splice(index, 1);
    return true;
  }
}

let shared: InMemoryWorkspaceStore | undefined;

export function getSharedWorkspaceStore(): InMemoryWorkspaceStore {
  shared ??= new InMemoryWorkspaceStore();
  return shared;
}

export function resetSharedWorkspaceStoreForTests(): void {
  shared = undefined;
}
