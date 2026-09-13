import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { getDb, hasDb, schema } from "@/db";
import {
  fixtureContentPackHook,
  fixtureContentPackOutline,
  fixtureDescriptionTemplate,
} from "@/lib/fixtures";
import type { templatesContracts } from "@/lib/types/api";
import { descriptionTemplateSchema, type DescriptionTemplate } from "@/lib/types/entities";
import { contentTemplateSchema, type ContentTemplate } from "@/lib/types/pipeline";
import { getEngineDeps } from "@/pipelines/script/deps";
import { badRequest, notFound, type HandlerOpts } from "./_shared";

/**
 * templates router — description templates CRUD (spec §5.11 / §6).
 *
 * AuthZ is enforced by the contracts layer: `template` create/update/delete
 * requires admin+ (lib/authz.ts role matrix), read is open to every member —
 * writers USE templates (description.generate takes templateId), admins
 * MANAGE them.
 *
 * Persistence: Drizzle when a database is configured; otherwise a shared
 * in-memory store seeded with the fixture template so zero-env mode works
 * end-to-end. The packaging pipeline's template lookup
 * (pipelines/packaging/persist.ts findDescriptionTemplate) reads the same
 * store in fixture mode, so a template created here is immediately usable in
 * description generation.
 */

type ListInput = z.output<typeof templatesContracts.list.input>;
type CreateInput = z.output<typeof templatesContracts.create.input>;
type UpdateInput = z.output<typeof templatesContracts.update.input>;
type RemoveInput = z.output<typeof templatesContracts.remove.input>;
type SaveContentPackInput = z.output<typeof templatesContracts.saveContentPack.input>;
type ListContentPacksInput = z.output<typeof templatesContracts.listContentPacks.input>;
type ApplyContentPackInput = z.output<typeof templatesContracts.applyContentPack.input>;
type RemoveContentPackInput = z.output<typeof templatesContracts.removeContentPack.input>;

// ---------------------------------------------------------------------------
// In-memory store (fixture mode / tests)
// ---------------------------------------------------------------------------

let memoryRows: DescriptionTemplate[] = [{ ...fixtureDescriptionTemplate }];
let contentPackRows: ContentTemplate[] = [
  { ...fixtureContentPackOutline },
  { ...fixtureContentPackHook },
];

/** Test hook: reset the in-memory store to its seeded state. */
export function resetTemplateMemoryForTests(): void {
  memoryRows = [{ ...fixtureDescriptionTemplate }];
  contentPackRows = [{ ...fixtureContentPackOutline }, { ...fixtureContentPackHook }];
}

/**
 * Fixture-mode template lookup for the packaging pipeline (imported by
 * pipelines/packaging/persist.ts when no database is configured).
 */
export function findTemplateInMemory(
  workspaceId: string,
  templateId: string,
): { name: string; body: string } | null {
  const found = memoryRows.find((t) => t.id === templateId && t.workspaceId === workspaceId);
  return found === undefined ? null : { name: found.name, body: found.body };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const templatesImpl = {
  async list({ ctx }: HandlerOpts<ListInput>): Promise<DescriptionTemplate[]> {
    if (!hasDb()) {
      return memoryRows
        .filter((t) => t.workspaceId === ctx.workspaceId)
        .map((t) => ({ ...t }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    const rows = await getDb()
      .select()
      .from(schema.descriptionTemplates)
      .where(eq(schema.descriptionTemplates.workspaceId, ctx.workspaceId))
      .orderBy(asc(schema.descriptionTemplates.name));
    return rows.map((r) => descriptionTemplateSchema.parse(r));
  },

  async create({ ctx, input }: HandlerOpts<CreateInput>): Promise<DescriptionTemplate> {
    if (!hasDb()) {
      const now = new Date();
      const template = descriptionTemplateSchema.parse({
        id: randomUUID(),
        workspaceId: ctx.workspaceId,
        name: input.name,
        body: input.body,
        createdAt: now,
        updatedAt: now,
      });
      memoryRows.push(template);
      return { ...template };
    }
    const rows = await getDb()
      .insert(schema.descriptionTemplates)
      .values({ workspaceId: ctx.workspaceId, name: input.name, body: input.body })
      .returning();
    const row = rows[0];
    if (row === undefined) throw new Error("insert into description_templates returned no row");
    return descriptionTemplateSchema.parse(row);
  },

  async update({ ctx, input }: HandlerOpts<UpdateInput>): Promise<DescriptionTemplate> {
    if (!hasDb()) {
      const found = memoryRows.find(
        (t) => t.id === input.templateId && t.workspaceId === ctx.workspaceId,
      );
      if (found === undefined) notFound("template");
      if (input.name !== undefined) found.name = input.name;
      if (input.body !== undefined) found.body = input.body;
      found.updatedAt = new Date();
      return { ...found };
    }
    const patch: { name?: string; body?: string } = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.body !== undefined) patch.body = input.body;
    if (Object.keys(patch).length === 0) {
      // Nothing to change — return the current row (still a workspace-scoped read).
      const rows = await getDb()
        .select()
        .from(schema.descriptionTemplates)
        .where(
          and(
            eq(schema.descriptionTemplates.id, input.templateId),
            eq(schema.descriptionTemplates.workspaceId, ctx.workspaceId),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (row === undefined) notFound("template");
      return descriptionTemplateSchema.parse(row);
    }
    const rows = await getDb()
      .update(schema.descriptionTemplates)
      .set(patch)
      .where(
        and(
          eq(schema.descriptionTemplates.id, input.templateId),
          eq(schema.descriptionTemplates.workspaceId, ctx.workspaceId),
        ),
      )
      .returning();
    const row = rows[0];
    if (row === undefined) notFound("template");
    return descriptionTemplateSchema.parse(row);
  },

  async remove({ ctx, input }: HandlerOpts<RemoveInput>): Promise<{ removed: boolean }> {
    if (!hasDb()) {
      const before = memoryRows.length;
      memoryRows = memoryRows.filter(
        (t) => !(t.id === input.templateId && t.workspaceId === ctx.workspaceId),
      );
      if (memoryRows.length === before) notFound("template");
      return { removed: true };
    }
    const rows = await getDb()
      .delete(schema.descriptionTemplates)
      .where(
        and(
          eq(schema.descriptionTemplates.id, input.templateId),
          eq(schema.descriptionTemplates.workspaceId, ctx.workspaceId),
        ),
      )
      .returning({ id: schema.descriptionTemplates.id });
    if (rows.length === 0) notFound("template");
    return { removed: true };
  },

  // -------------------------------------------------------------------------
  // Reusable content packs (E4) — outline / hook_pack. Separate table
  // (content_templates); the description-template CRUD above is untouched.
  // -------------------------------------------------------------------------

  async saveContentPack({
    ctx,
    input,
  }: HandlerOpts<SaveContentPackInput>): Promise<ContentTemplate> {
    if (!hasDb()) {
      const now = new Date();
      const pack = contentTemplateSchema.parse({
        id: randomUUID(),
        workspaceId: ctx.workspaceId,
        channelId: input.channelId,
        kind: input.payload.kind,
        name: input.name,
        payload: input.payload,
        createdAt: now,
        updatedAt: now,
      });
      contentPackRows.push(pack);
      return { ...pack };
    }
    const rows = await getDb()
      .insert(schema.contentTemplates)
      .values({
        workspaceId: ctx.workspaceId,
        channelId: input.channelId,
        kind: input.payload.kind,
        name: input.name,
        payload: input.payload,
      })
      .returning();
    const row = rows[0];
    if (row === undefined) throw new Error("insert into content_templates returned no row");
    return contentTemplateSchema.parse(row);
  },

  async listContentPacks({
    ctx,
    input,
  }: HandlerOpts<ListContentPacksInput>): Promise<ContentTemplate[]> {
    // Channel isolation: a channel id returns that channel's packs PLUS the
    // workspace-wide (null-channel) ones; a pack tagged to a DIFFERENT channel
    // is never returned. channelId null returns only the workspace-wide packs.
    const matchesChannel = (packChannelId: string | null): boolean => {
      if (packChannelId === null) return true;
      return input.channelId !== null && packChannelId === input.channelId;
    };
    const matchesKind = (kind: string): boolean => input.kind === null || kind === input.kind;
    if (!hasDb()) {
      return contentPackRows
        .filter(
          (p) =>
            p.workspaceId === ctx.workspaceId && matchesChannel(p.channelId) && matchesKind(p.kind),
        )
        .map((p) => ({ ...p }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    const rows = await getDb()
      .select()
      .from(schema.contentTemplates)
      .where(eq(schema.contentTemplates.workspaceId, ctx.workspaceId))
      .orderBy(asc(schema.contentTemplates.name));
    return rows
      .map((r) => contentTemplateSchema.parse(r))
      .filter((p) => matchesChannel(p.channelId) && matchesKind(p.kind));
  },

  async applyContentPack({ ctx, input }: HandlerOpts<ApplyContentPackInput>) {
    // Resolve the pack + project workspace-scoped (cross-tenant → NOT_FOUND).
    const deps = await getEngineDeps();
    const project = await deps.store.getProject(ctx.workspaceId, input.projectId);
    if (project === null) notFound("project");
    const pack = await findContentPack(ctx.workspaceId, input.contentTemplateId);
    if (pack === null) notFound("content pack");
    // Channel isolation: a channel-tagged pack may only be applied to a
    // project on that same channel. Workspace-wide packs (null channel) apply
    // anywhere in the workspace.
    if (pack.channelId !== null && pack.channelId !== project.channelId) {
      badRequest("this pack belongs to a different channel and cannot be applied to this project");
    }
    return { contentTemplate: pack, payload: pack.payload };
  },

  async removeContentPack({
    ctx,
    input,
  }: HandlerOpts<RemoveContentPackInput>): Promise<{ removed: boolean }> {
    if (!hasDb()) {
      const before = contentPackRows.length;
      contentPackRows = contentPackRows.filter(
        (p) => !(p.id === input.contentTemplateId && p.workspaceId === ctx.workspaceId),
      );
      if (contentPackRows.length === before) notFound("content pack");
      return { removed: true };
    }
    const rows = await getDb()
      .delete(schema.contentTemplates)
      .where(
        and(
          eq(schema.contentTemplates.id, input.contentTemplateId),
          eq(schema.contentTemplates.workspaceId, ctx.workspaceId),
        ),
      )
      .returning({ id: schema.contentTemplates.id });
    if (rows.length === 0) notFound("content pack");
    return { removed: true };
  },
} as const;

/** Find one content pack, workspace-scoped (null when absent / cross-tenant). */
async function findContentPack(
  workspaceId: string,
  contentTemplateId: string,
): Promise<ContentTemplate | null> {
  if (!hasDb()) {
    const found = contentPackRows.find(
      (p) => p.id === contentTemplateId && p.workspaceId === workspaceId,
    );
    return found === undefined ? null : { ...found };
  }
  const rows = await getDb()
    .select()
    .from(schema.contentTemplates)
    .where(
      and(
        eq(schema.contentTemplates.id, contentTemplateId),
        eq(schema.contentTemplates.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : contentTemplateSchema.parse(row);
}
