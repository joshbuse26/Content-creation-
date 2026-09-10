import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getDb, hasDb, schema } from "@/db";
import { fixtureThumbnailConcept } from "@/lib/fixtures";
import { thumbnailConceptSchema, type ThumbnailConcept } from "@/lib/types/entities";

/**
 * thumbnail_concepts persistence. Drizzle when a database is configured;
 * otherwise a shared in-memory store (seeded with the fixture concept so
 * zero-env demo mode shows the text-brief fallback card) — real inserts and
 * status changes work end-to-end without Postgres, mirroring how projects
 * and scripts behave in fixture mode.
 *
 * Every read and write is scoped by the denormalized workspace_id (spec §4).
 */

export interface NewThumbnailConcept {
  workspaceId: string;
  projectId: string;
  promptUsed: string;
  compositionPattern: string;
  imageKey: string | null;
}

// ---------------------------------------------------------------------------
// In-memory store (fixture mode / tests)
// ---------------------------------------------------------------------------

let memoryRows: ThumbnailConcept[] = [{ ...fixtureThumbnailConcept }];

/** Test hook: reset the in-memory store to its seeded state. */
export function resetThumbnailMemoryForTests(): void {
  memoryRows = [{ ...fixtureThumbnailConcept }];
}

function memoryInsert(args: NewThumbnailConcept): ThumbnailConcept {
  const now = new Date();
  const concept = thumbnailConceptSchema.parse({
    id: randomUUID(),
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    promptUsed: args.promptUsed,
    compositionPattern: args.compositionPattern,
    imageKey: args.imageKey,
    status: "candidate",
    createdAt: now,
    updatedAt: now,
  });
  memoryRows.push(concept);
  return concept;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function insertThumbnailConcepts(
  args: NewThumbnailConcept[],
): Promise<ThumbnailConcept[]> {
  if (args.length === 0) return [];
  if (!hasDb()) {
    return args.map((a) => memoryInsert(a));
  }
  const db = getDb();
  const rows = await db
    .insert(schema.thumbnailConcepts)
    .values(
      args.map((a) => ({
        workspaceId: a.workspaceId,
        projectId: a.projectId,
        promptUsed: a.promptUsed,
        compositionPattern: a.compositionPattern,
        imageKey: a.imageKey,
      })),
    )
    .returning();
  return rows.map((r) => thumbnailConceptSchema.parse(r));
}

export async function listThumbnailConcepts(
  workspaceId: string,
  projectId: string,
): Promise<ThumbnailConcept[]> {
  if (!hasDb()) {
    return memoryRows
      .filter((c) => c.workspaceId === workspaceId && c.projectId === projectId)
      .map((c) => ({ ...c }))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.thumbnailConcepts)
    .where(
      and(
        eq(schema.thumbnailConcepts.projectId, projectId),
        eq(schema.thumbnailConcepts.workspaceId, workspaceId),
      ),
    )
    .orderBy(desc(schema.thumbnailConcepts.createdAt));
  return rows.map((r) => thumbnailConceptSchema.parse(r));
}

export async function getThumbnailConcept(
  workspaceId: string,
  conceptId: string,
): Promise<ThumbnailConcept | null> {
  if (!hasDb()) {
    const found = memoryRows.find((c) => c.id === conceptId && c.workspaceId === workspaceId);
    return found === undefined ? null : { ...found };
  }
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.thumbnailConcepts)
    .where(
      and(
        eq(schema.thumbnailConcepts.id, conceptId),
        eq(schema.thumbnailConcepts.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : thumbnailConceptSchema.parse(row);
}

/**
 * Mark one concept chosen and demote any previously chosen concept of the
 * same project back to candidate (a project has at most one chosen
 * thumbnail). Returns the chosen concept, or null when it does not exist in
 * the workspace.
 */
export async function chooseThumbnailConcept(
  workspaceId: string,
  conceptId: string,
): Promise<ThumbnailConcept | null> {
  if (!hasDb()) {
    const target = memoryRows.find((c) => c.id === conceptId && c.workspaceId === workspaceId);
    if (target === undefined) return null;
    const now = new Date();
    for (const c of memoryRows) {
      if (c.projectId === target.projectId && c.status === "chosen" && c.id !== target.id) {
        c.status = "candidate";
        c.updatedAt = now;
      }
    }
    target.status = "chosen";
    target.updatedAt = now;
    return { ...target };
  }
  const db = getDb();
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(schema.thumbnailConcepts)
      .where(
        and(
          eq(schema.thumbnailConcepts.id, conceptId),
          eq(schema.thumbnailConcepts.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    const target = rows[0];
    if (target === undefined) return null;
    await tx
      .update(schema.thumbnailConcepts)
      .set({ status: "candidate" })
      .where(
        and(
          eq(schema.thumbnailConcepts.projectId, target.projectId),
          eq(schema.thumbnailConcepts.workspaceId, workspaceId),
          eq(schema.thumbnailConcepts.status, "chosen"),
        ),
      );
    const updated = await tx
      .update(schema.thumbnailConcepts)
      .set({ status: "chosen" })
      .where(
        and(
          eq(schema.thumbnailConcepts.id, conceptId),
          eq(schema.thumbnailConcepts.workspaceId, workspaceId),
        ),
      )
      .returning();
    const row = updated[0];
    return row === undefined ? null : thumbnailConceptSchema.parse(row);
  });
}
