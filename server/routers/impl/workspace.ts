import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import { getDb, hasDb, schema } from "@/db";
import type { workspaceContracts } from "@/lib/types/api";
import {
  membershipSchema,
  userSchema,
  workspaceSchema,
  type Membership,
  type User,
  type Workspace,
} from "@/lib/types/entities";
import type { Role } from "@/lib/types/enums";
import { asUserId, type UserId, type WorkspaceId } from "@/lib/types/ids";
import { getSharedWorkspaceStore } from "@/server/workspace/memory";
import { badRequest, notFound } from "./_shared";

/**
 * workspace router implementation — Drizzle-backed with the in-memory
 * fallback for keyless fixture mode (the fixture role resolver reads the
 * same store, so workspaces created at runtime stay reachable).
 *
 * Every tenant read/write filters on workspace_id; member management guards
 * the last owner so a workspace can never end up ownerless.
 */

interface ProtectedCtx {
  userId: UserId;
}

interface WorkspaceCtx {
  userId: UserId;
  workspaceId: WorkspaceId;
}

type CreateInput = z.output<typeof workspaceContracts.create.input>;
type UpdateInput = z.output<typeof workspaceContracts.update.input>;
type InviteInput = z.output<typeof workspaceContracts.invite.input>;
type SetRoleInput = z.output<typeof workspaceContracts.setRole.input>;
type RemoveMemberInput = z.output<typeof workspaceContracts.removeMember.input>;

const FREE_PLAN_CREDITS = 8;

async function dbOwnerCount(workspaceId: WorkspaceId): Promise<number> {
  const rows = await getDb()
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .where(
      and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.role, "owner")),
    );
  return rows.length;
}

async function dbMembership(workspaceId: WorkspaceId, userId: string): Promise<Membership | null> {
  const rows = await getDb()
    .select()
    .from(schema.memberships)
    .where(
      and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.userId, userId)),
    )
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : membershipSchema.parse(row);
}

/** Refuses role changes/removals that would leave the workspace ownerless. */
async function assertNotLastOwner(
  workspaceId: WorkspaceId,
  target: Membership,
  nextRole: Role | null,
  ownerCount: () => Promise<number> | number,
): Promise<void> {
  if (target.role !== "owner" || nextRole === "owner") return;
  const owners = await ownerCount();
  if (owners <= 1) badRequest("cannot remove or demote the workspace's last owner");
}

export const workspaceHandlers = {
  async list(opts: { ctx: ProtectedCtx }): Promise<(Workspace & { role: Role })[]> {
    if (!hasDb()) {
      return getSharedWorkspaceStore().listForUser(opts.ctx.userId);
    }
    const rows = await getDb()
      .select({ workspace: schema.workspaces, role: schema.memberships.role })
      .from(schema.memberships)
      .innerJoin(schema.workspaces, eq(schema.memberships.workspaceId, schema.workspaces.id))
      .where(eq(schema.memberships.userId, opts.ctx.userId));
    return rows.map((r) => ({ ...workspaceSchema.parse(r.workspace), role: r.role }));
  },

  async get(opts: { ctx: WorkspaceCtx }): Promise<Workspace> {
    if (!hasDb()) {
      const workspace = getSharedWorkspaceStore().get(opts.ctx.workspaceId);
      if (workspace === null) notFound("workspace");
      return workspace;
    }
    const rows = await getDb()
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, opts.ctx.workspaceId))
      .limit(1);
    const row = rows[0];
    if (row === undefined) notFound("workspace");
    return workspaceSchema.parse(row);
  },

  async create(opts: { ctx: ProtectedCtx; input: CreateInput }): Promise<Workspace> {
    if (!hasDb()) {
      return getSharedWorkspaceStore().create(opts.input.name, opts.ctx.userId);
    }
    return await getDb().transaction(async (tx) => {
      const inserted = await tx
        .insert(schema.workspaces)
        .values({ name: opts.input.name, plan: "free", creditBalance: FREE_PLAN_CREDITS })
        .returning();
      const workspace = inserted[0];
      if (workspace === undefined) throw new Error("workspace insert returned no row");
      await tx.insert(schema.memberships).values({
        workspaceId: workspace.id,
        userId: opts.ctx.userId,
        role: "owner",
      });
      await tx.insert(schema.creditLedger).values({
        workspaceId: workspace.id,
        delta: FREE_PLAN_CREDITS,
        reason: "plan_grant",
        actorUserId: opts.ctx.userId,
      });
      return workspaceSchema.parse(workspace);
    });
  },

  async update(opts: { ctx: WorkspaceCtx; input: UpdateInput }): Promise<Workspace> {
    if (!hasDb()) {
      const workspace = getSharedWorkspaceStore().rename(opts.ctx.workspaceId, opts.input.name);
      if (workspace === null) notFound("workspace");
      return workspace;
    }
    const rows = await getDb()
      .update(schema.workspaces)
      .set({ name: opts.input.name })
      .where(eq(schema.workspaces.id, opts.ctx.workspaceId))
      .returning();
    const row = rows[0];
    if (row === undefined) notFound("workspace");
    return workspaceSchema.parse(row);
  },

  async members(opts: { ctx: WorkspaceCtx }): Promise<(Membership & { user: User })[]> {
    if (!hasDb()) {
      return getSharedWorkspaceStore().members(opts.ctx.workspaceId);
    }
    const rows = await getDb()
      .select({ membership: schema.memberships, user: schema.users })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
      .where(eq(schema.memberships.workspaceId, opts.ctx.workspaceId));
    return rows.map((r) => ({
      ...membershipSchema.parse(r.membership),
      user: userSchema.parse(r.user),
    }));
  },

  async invite(opts: { ctx: WorkspaceCtx; input: InviteInput }): Promise<Membership> {
    if (opts.input.role === "owner") {
      badRequest("ownership is transferred via setRole, not invite");
    }
    if (!hasDb()) {
      const store = getSharedWorkspaceStore();
      const user = store.findOrCreateUserByEmail(opts.input.email);
      const existing = store.membershipFor(opts.ctx.workspaceId, user.id);
      if (existing !== null) badRequest("that user is already a member of this workspace");
      return store.upsertMembership(opts.ctx.workspaceId, user.id, opts.input.role);
    }
    return await getDb().transaction(async (tx) => {
      const found = await tx
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, opts.input.email.toLowerCase()))
        .limit(1);
      let userId = found[0]?.id;
      if (userId === undefined) {
        // Pre-provision the account; sign-in via magic link claims it (same
        // email key the Auth.js adapter uses).
        const created = await tx
          .insert(schema.users)
          .values({ id: randomUUID(), email: opts.input.email.toLowerCase() })
          .returning({ id: schema.users.id });
        userId = created[0]?.id;
        if (userId === undefined) throw new Error("user insert returned no row");
      }
      const existing = await tx
        .select({ id: schema.memberships.id })
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.workspaceId, opts.ctx.workspaceId),
            eq(schema.memberships.userId, userId),
          ),
        )
        .limit(1);
      if (existing.length > 0) badRequest("that user is already a member of this workspace");
      const inserted = await tx
        .insert(schema.memberships)
        .values({ workspaceId: opts.ctx.workspaceId, userId, role: opts.input.role })
        .returning();
      const row = inserted[0];
      if (row === undefined) throw new Error("membership insert returned no row");
      return membershipSchema.parse(row);
    });
  },

  async setRole(opts: { ctx: WorkspaceCtx; input: SetRoleInput }): Promise<Membership> {
    const targetUserId = asUserId(opts.input.userId);
    if (!hasDb()) {
      const store = getSharedWorkspaceStore();
      const target = store.membershipFor(opts.ctx.workspaceId, targetUserId);
      if (target === null) notFound("membership");
      await assertNotLastOwner(opts.ctx.workspaceId, target, opts.input.role, () =>
        store.ownerCount(opts.ctx.workspaceId),
      );
      return store.upsertMembership(opts.ctx.workspaceId, targetUserId, opts.input.role);
    }
    const target = await dbMembership(opts.ctx.workspaceId, targetUserId);
    if (target === null) notFound("membership");
    await assertNotLastOwner(opts.ctx.workspaceId, target, opts.input.role, () =>
      dbOwnerCount(opts.ctx.workspaceId),
    );
    const rows = await getDb()
      .update(schema.memberships)
      .set({ role: opts.input.role })
      .where(
        and(
          eq(schema.memberships.workspaceId, opts.ctx.workspaceId),
          eq(schema.memberships.userId, targetUserId),
        ),
      )
      .returning();
    const row = rows[0];
    if (row === undefined) notFound("membership");
    return membershipSchema.parse(row);
  },

  async removeMember(opts: {
    ctx: WorkspaceCtx;
    input: RemoveMemberInput;
  }): Promise<{ removed: boolean }> {
    const targetUserId = asUserId(opts.input.userId);
    if (!hasDb()) {
      const store = getSharedWorkspaceStore();
      const target = store.membershipFor(opts.ctx.workspaceId, targetUserId);
      if (target === null) return { removed: false };
      await assertNotLastOwner(opts.ctx.workspaceId, target, null, () =>
        store.ownerCount(opts.ctx.workspaceId),
      );
      return { removed: store.removeMembership(opts.ctx.workspaceId, targetUserId) };
    }
    const target = await dbMembership(opts.ctx.workspaceId, targetUserId);
    if (target === null) return { removed: false };
    await assertNotLastOwner(opts.ctx.workspaceId, target, null, () =>
      dbOwnerCount(opts.ctx.workspaceId),
    );
    const rows = await getDb()
      .delete(schema.memberships)
      .where(
        and(
          eq(schema.memberships.workspaceId, opts.ctx.workspaceId),
          eq(schema.memberships.userId, targetUserId),
        ),
      )
      .returning({ id: schema.memberships.id });
    return { removed: rows.length > 0 };
  },
} as const;
