import { and, desc, eq } from "drizzle-orm";
import { getDb, hasDb, schema } from "@/db";
import { fixtureChapterSet, fixtureDescription, fixtureTagSet } from "@/lib/fixtures";
import {
  chapterSetSchema,
  descriptionSchema,
  tagSetSchema,
  type ChapterEntry,
  type ChapterSet,
  type Description,
  type TagSet,
} from "@/lib/types/entities";
import type { DescriptionMode } from "@/lib/types/enums";

/**
 * Packaging persistence — descriptions, tag_sets, chapters rows. Every read
 * and write is scoped by the denormalized workspace_id. In fixture mode
 * (no DATABASE_URL) the generated content is returned on top of the fixture
 * entities so the packaging loop works end-to-end with zero env.
 */

const now = () => new Date();

// ---------------------------------------------------------------------------
// Descriptions
// ---------------------------------------------------------------------------

export async function insertDescription(args: {
  workspaceId: string;
  projectId: string;
  mode: DescriptionMode;
  body: string;
  templateId: string | null;
}): Promise<Description> {
  if (!hasDb()) {
    return descriptionSchema.parse({
      ...fixtureDescription,
      mode: args.mode,
      body: args.body,
      templateId: null,
      createdAt: now(),
      updatedAt: now(),
    });
  }
  const db = getDb();
  const rows = await db
    .insert(schema.descriptions)
    .values({
      workspaceId: args.workspaceId,
      projectId: args.projectId,
      mode: args.mode,
      body: args.body,
      templateId: args.templateId,
    })
    .returning();
  const row = rows[0];
  if (row === undefined) throw new Error("insert into descriptions returned no row");
  return descriptionSchema.parse(row);
}

export async function listDescriptions(
  workspaceId: string,
  projectId: string,
): Promise<Description[]> {
  if (!hasDb()) return [fixtureDescription];
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.descriptions)
    .where(
      and(
        eq(schema.descriptions.projectId, projectId),
        eq(schema.descriptions.workspaceId, workspaceId),
      ),
    )
    .orderBy(desc(schema.descriptions.createdAt));
  return rows.map((r) => descriptionSchema.parse(r));
}

export async function updateDescriptionBody(
  workspaceId: string,
  descriptionId: string,
  body: string,
): Promise<Description> {
  if (!hasDb()) {
    return descriptionSchema.parse({ ...fixtureDescription, body, updatedAt: now() });
  }
  const db = getDb();
  const rows = await db
    .update(schema.descriptions)
    .set({ body })
    .where(
      and(
        eq(schema.descriptions.id, descriptionId),
        eq(schema.descriptions.workspaceId, workspaceId),
      ),
    )
    .returning();
  const row = rows[0];
  if (row === undefined) throw new Error("description not found in workspace");
  return descriptionSchema.parse(row);
}

export async function findDescriptionTemplate(
  workspaceId: string,
  templateId: string,
): Promise<{ name: string; body: string } | null> {
  if (!hasDb()) return null;
  const db = getDb();
  const rows = await db
    .select({ name: schema.descriptionTemplates.name, body: schema.descriptionTemplates.body })
    .from(schema.descriptionTemplates)
    .where(
      and(
        eq(schema.descriptionTemplates.id, templateId),
        eq(schema.descriptionTemplates.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Tag sets
// ---------------------------------------------------------------------------

export async function insertTagSet(args: {
  workspaceId: string;
  projectId: string;
  tags: string[];
}): Promise<TagSet> {
  if (!hasDb()) {
    return tagSetSchema.parse({
      ...fixtureTagSet,
      tags: args.tags,
      createdAt: now(),
      updatedAt: now(),
    });
  }
  const db = getDb();
  const rows = await db
    .insert(schema.tagSets)
    .values({ workspaceId: args.workspaceId, projectId: args.projectId, tags: args.tags })
    .returning();
  const row = rows[0];
  if (row === undefined) throw new Error("insert into tag_sets returned no row");
  return tagSetSchema.parse(row);
}

export async function latestTagSet(workspaceId: string, projectId: string): Promise<TagSet | null> {
  if (!hasDb()) return fixtureTagSet;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.tagSets)
    .where(
      and(eq(schema.tagSets.projectId, projectId), eq(schema.tagSets.workspaceId, workspaceId)),
    )
    .orderBy(desc(schema.tagSets.createdAt))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : tagSetSchema.parse(row);
}

export async function updateTagSetTags(
  workspaceId: string,
  tagSetId: string,
  tags: string[],
): Promise<TagSet> {
  if (!hasDb()) {
    return tagSetSchema.parse({ ...fixtureTagSet, tags, updatedAt: now() });
  }
  const db = getDb();
  const rows = await db
    .update(schema.tagSets)
    .set({ tags })
    .where(and(eq(schema.tagSets.id, tagSetId), eq(schema.tagSets.workspaceId, workspaceId)))
    .returning();
  const row = rows[0];
  if (row === undefined) throw new Error("tag set not found in workspace");
  return tagSetSchema.parse(row);
}

// ---------------------------------------------------------------------------
// Chapter sets
// ---------------------------------------------------------------------------

export async function insertChapterSet(args: {
  workspaceId: string;
  projectId: string;
  entries: ChapterEntry[];
}): Promise<ChapterSet> {
  if (!hasDb()) {
    return chapterSetSchema.parse({
      ...fixtureChapterSet,
      entries: args.entries,
      createdAt: now(),
      updatedAt: now(),
    });
  }
  const db = getDb();
  const rows = await db
    .insert(schema.chapters)
    .values({ workspaceId: args.workspaceId, projectId: args.projectId, entries: args.entries })
    .returning();
  const row = rows[0];
  if (row === undefined) throw new Error("insert into chapters returned no row");
  return chapterSetSchema.parse(row);
}

export async function latestChapterSet(
  workspaceId: string,
  projectId: string,
): Promise<ChapterSet | null> {
  if (!hasDb()) return fixtureChapterSet;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.chapters)
    .where(
      and(eq(schema.chapters.projectId, projectId), eq(schema.chapters.workspaceId, workspaceId)),
    )
    .orderBy(desc(schema.chapters.createdAt))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : chapterSetSchema.parse(row);
}

export async function updateChapterSetEntries(
  workspaceId: string,
  chapterSetId: string,
  entries: ChapterEntry[],
): Promise<ChapterSet> {
  if (!hasDb()) {
    return chapterSetSchema.parse({ ...fixtureChapterSet, entries, updatedAt: now() });
  }
  const db = getDb();
  const rows = await db
    .update(schema.chapters)
    .set({ entries })
    .where(and(eq(schema.chapters.id, chapterSetId), eq(schema.chapters.workspaceId, workspaceId)))
    .returning();
  const row = rows[0];
  if (row === undefined) throw new Error("chapter set not found in workspace");
  return chapterSetSchema.parse(row);
}
