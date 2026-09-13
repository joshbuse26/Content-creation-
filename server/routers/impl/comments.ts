import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { z } from "zod";
import { getDb, hasDb, schema } from "@/db";
import { fixtureSectionComment } from "@/lib/fixtures";
import { ROLES, type Role } from "@/lib/types/enums";
import { sectionCommentSchema, type SectionComment } from "@/lib/types/entities";
import type { commentsContracts } from "@/lib/types/api";
import { getEngineDeps } from "@/pipelines/script/deps";
import { badRequest, forbidden, notFound, type HandlerOpts } from "./_shared";

/**
 * comments router (E4) — per-section comment threads for team collaboration.
 *
 * AuthZ is enforced by the contracts layer (lib/authz.ts `comment` resource):
 * read is open to every member, add/resolve/unresolve require writer+. The
 * author-or-admin REMOVE rule is ownership-sensitive and so is enforced here
 * (the role gate alone can't express "your own comment").
 *
 * No credits (no LLM). Tenancy: every read/write filters on workspace_id, and
 * the section/comment id is resolved workspace-scoped, so a cross-workspace id
 * is NOT_FOUND — indistinguishable from a missing row.
 *
 * Persistence mirrors templates.ts: Drizzle when a database is configured,
 * otherwise a shared in-memory store seeded with the fixture comment so the
 * editor's thread renders in zero-env mode.
 */

type ListInput = z.output<typeof commentsContracts.list.input>;
type AddInput = z.output<typeof commentsContracts.add.input>;
type ResolveInput = z.output<typeof commentsContracts.resolve.input>;
type RemoveInput = z.output<typeof commentsContracts.remove.input>;

const ROLE_RANK: Record<Role, number> = { viewer: 0, writer: 1, admin: 2, owner: 3 };

// ---------------------------------------------------------------------------
// In-memory store (fixture mode / tests)
// ---------------------------------------------------------------------------

let memoryRows: SectionComment[] = [{ ...fixtureSectionComment }];

/** Test hook: reset the in-memory store to its seeded state. */
export function resetCommentMemoryForTests(): void {
  memoryRows = [{ ...fixtureSectionComment }];
}

function byCreated(a: SectionComment, b: SectionComment): number {
  return a.createdAt.getTime() - b.createdAt.getTime();
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const commentsImpl = {
  async list({ ctx, input }: HandlerOpts<ListInput>): Promise<SectionComment[]> {
    // Tenancy: resolve the script workspace-scoped first — a cross-tenant
    // script id reads as NOT_FOUND.
    const deps = await getEngineDeps();
    const script = await deps.store.getScript(ctx.workspaceId, input.scriptId);
    if (script === null) notFound("script");
    if (!hasDb()) {
      return memoryRows
        .filter(
          (c) =>
            c.workspaceId === ctx.workspaceId &&
            c.scriptId === input.scriptId &&
            (input.sectionId === null || c.sectionId === input.sectionId),
        )
        .map((c) => ({ ...c }))
        .sort(byCreated);
    }
    const where = [
      eq(schema.sectionComments.workspaceId, ctx.workspaceId),
      eq(schema.sectionComments.scriptId, input.scriptId),
    ];
    if (input.sectionId !== null) {
      where.push(eq(schema.sectionComments.sectionId, input.sectionId));
    }
    const rows = await getDb()
      .select()
      .from(schema.sectionComments)
      .where(and(...where))
      .orderBy(asc(schema.sectionComments.createdAt));
    return rows.map((r) => sectionCommentSchema.parse(r));
  },

  async add({ ctx, input }: HandlerOpts<AddInput>): Promise<SectionComment> {
    // Resolve the section + its script workspace-scoped to anchor the comment
    // (and to reject a cross-tenant / unknown section as NOT_FOUND).
    const deps = await getEngineDeps();
    const section = await deps.store.getSection(ctx.workspaceId, input.sectionId);
    if (section === null) notFound("section");
    const script = await deps.store.getScript(ctx.workspaceId, section.scriptId);
    if (script === null) notFound("script");
    if (!hasDb()) {
      const now = new Date();
      const comment = sectionCommentSchema.parse({
        id: randomUUID(),
        workspaceId: ctx.workspaceId,
        projectId: script.projectId,
        scriptId: script.id,
        sectionId: section.id,
        authorUserId: ctx.userId,
        body: input.body,
        resolved: false,
        createdAt: now,
        updatedAt: now,
      });
      memoryRows.push(comment);
      return { ...comment };
    }
    const rows = await getDb()
      .insert(schema.sectionComments)
      .values({
        workspaceId: ctx.workspaceId,
        projectId: script.projectId,
        scriptId: script.id,
        sectionId: section.id,
        authorUserId: ctx.userId,
        body: input.body,
      })
      .returning();
    const row = rows[0];
    if (row === undefined) throw new Error("insert into section_comments returned no row");
    return sectionCommentSchema.parse(row);
  },

  async resolve(opts: HandlerOpts<ResolveInput>): Promise<SectionComment> {
    return setResolved(opts, true);
  },

  async unresolve(opts: HandlerOpts<ResolveInput>): Promise<SectionComment> {
    return setResolved(opts, false);
  },

  async remove({ ctx, input }: HandlerOpts<RemoveInput>): Promise<{ removed: boolean }> {
    const role = ctx.role;
    if (!hasDb()) {
      const found = memoryRows.find(
        (c) => c.id === input.commentId && c.workspaceId === ctx.workspaceId,
      );
      if (found === undefined) notFound("comment");
      assertCanRemove(found.authorUserId, ctx.userId, role);
      memoryRows = memoryRows.filter((c) => c.id !== input.commentId);
      return { removed: true };
    }
    const existing = await getDb()
      .select()
      .from(schema.sectionComments)
      .where(
        and(
          eq(schema.sectionComments.id, input.commentId),
          eq(schema.sectionComments.workspaceId, ctx.workspaceId),
        ),
      )
      .limit(1);
    const row = existing[0];
    if (row === undefined) notFound("comment");
    assertCanRemove(row.authorUserId, ctx.userId, role);
    const deleted = await getDb()
      .delete(schema.sectionComments)
      .where(
        and(
          eq(schema.sectionComments.id, input.commentId),
          eq(schema.sectionComments.workspaceId, ctx.workspaceId),
        ),
      )
      .returning({ id: schema.sectionComments.id });
    return { removed: deleted.length > 0 };
  },
} as const;

/** Author may remove their own comment; admin+ may remove any. */
function assertCanRemove(authorUserId: string, actorUserId: string, role: Role | undefined): void {
  const isAuthor = authorUserId === actorUserId;
  const isAdminPlus = role !== undefined && ROLE_RANK[role] >= ROLE_RANK.admin;
  if (!isAuthor && !isAdminPlus) {
    forbidden("only the comment's author or an admin may remove it");
  }
  // Defensive: an unrecognized role never passes.
  if (role !== undefined && !ROLES.includes(role)) badRequest("unknown role");
}

async function setResolved(
  { ctx, input }: HandlerOpts<ResolveInput>,
  resolved: boolean,
): Promise<SectionComment> {
  if (!hasDb()) {
    const found = memoryRows.find(
      (c) => c.id === input.commentId && c.workspaceId === ctx.workspaceId,
    );
    if (found === undefined) notFound("comment");
    found.resolved = resolved;
    found.updatedAt = new Date();
    return { ...found };
  }
  const rows = await getDb()
    .update(schema.sectionComments)
    .set({ resolved })
    .where(
      and(
        eq(schema.sectionComments.id, input.commentId),
        eq(schema.sectionComments.workspaceId, ctx.workspaceId),
      ),
    )
    .returning();
  const row = rows[0];
  if (row === undefined) notFound("comment");
  return sectionCommentSchema.parse(row);
}
