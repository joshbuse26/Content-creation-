import { randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { getDb, hasDb, schema } from "@/db";
import { fixtureThumbnailConcept } from "@/lib/fixtures";
import { thumbnailConceptSchema, type ThumbnailConcept } from "@/lib/types/entities";
import type { SubjectMode } from "@/lib/types/enums";

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
  // -- Optional board fields (WAVE-D / E2). Omitted → the one-shot defaults
  //    (null board, no overlay/preset/subject/mood, not favorited, sort 0),
  //    so the existing single-shot insert path is byte-for-byte unchanged.
  boardId?: string | null;
  overlayText?: string | null;
  presetId?: string | null;
  subjectMode?: string | null;
  colorMood?: string | null;
  brief?: string | null;
  referenceImageKey?: string | null;
  sort?: number;
}

/** Tweak update (WAVE-D / E2): the fields a regenerate-this-one rewrites. */
export interface ThumbnailConceptTweak {
  imageKey: string | null;
  promptUsed: string;
  compositionPattern: string;
  overlayText: string | null;
  presetId: string | null;
  subjectMode: SubjectMode | null;
  colorMood: string | null;
  /** Omitted = unchanged; null = cleared. */
  brief?: string | null;
  referenceImageKey?: string | null;
}

/** A board is a batch of sibling concepts sharing one board_id. */
export interface ThumbnailBoard {
  /** null groups the legacy / one-shot concepts that carry no board_id. */
  boardId: string | null;
  /** Most recent createdAt among the board's concepts (board recency key). */
  createdAt: Date;
  concepts: ThumbnailConcept[];
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
    boardId: args.boardId ?? null,
    overlayText: args.overlayText ?? null,
    presetId: args.presetId ?? null,
    subjectMode: args.subjectMode ?? null,
    colorMood: args.colorMood ?? null,
    brief: args.brief ?? null,
    referenceImageKey: args.referenceImageKey ?? null,
    favorited: false,
    sort: args.sort ?? 0,
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
        boardId: a.boardId ?? null,
        overlayText: a.overlayText ?? null,
        presetId: a.presetId ?? null,
        subjectMode: a.subjectMode ?? null,
        colorMood: a.colorMood ?? null,
        brief: a.brief ?? null,
        referenceImageKey: a.referenceImageKey ?? null,
        sort: a.sort ?? 0,
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

// ---------------------------------------------------------------------------
// Board reads + board-concept mutations (WAVE-D / E2)
// ---------------------------------------------------------------------------

/**
 * All concepts of one board (batch), ordered by their explicit `sort` then
 * creation time. Workspace-scoped; an empty result covers both "no such
 * board" and "board in another workspace" (no cross-tenant leak).
 */
export async function listBoardConcepts(
  workspaceId: string,
  projectId: string,
  boardId: string,
): Promise<ThumbnailConcept[]> {
  if (!hasDb()) {
    return memoryRows
      .filter(
        (c) => c.workspaceId === workspaceId && c.projectId === projectId && c.boardId === boardId,
      )
      .map((c) => ({ ...c }))
      .sort((a, b) => a.sort - b.sort || a.createdAt.getTime() - b.createdAt.getTime());
  }
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.thumbnailConcepts)
    .where(
      and(
        eq(schema.thumbnailConcepts.workspaceId, workspaceId),
        eq(schema.thumbnailConcepts.projectId, projectId),
        eq(schema.thumbnailConcepts.boardId, boardId),
      ),
    )
    .orderBy(asc(schema.thumbnailConcepts.sort), asc(schema.thumbnailConcepts.createdAt));
  return rows.map((r) => thumbnailConceptSchema.parse(r));
}

/**
 * All of a project's concepts grouped into boards, newest board first.
 * Concepts within a board keep their `sort` order. Legacy / one-shot rows
 * (board_id null) are grouped together under a single null-board entry so the
 * whiteboard surfaces them too. Workspace-scoped.
 */
export async function listThumbnailBoards(
  workspaceId: string,
  projectId: string,
): Promise<ThumbnailBoard[]> {
  const concepts = await listThumbnailConcepts(workspaceId, projectId);
  const groups = new Map<string, ThumbnailConcept[]>();
  for (const c of concepts) {
    const key = c.boardId ?? "__none__";
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [c]);
    else bucket.push(c);
  }
  const boards: ThumbnailBoard[] = [];
  for (const [key, list] of groups) {
    const sorted = [...list].sort(
      (a, b) => a.sort - b.sort || a.createdAt.getTime() - b.createdAt.getTime(),
    );
    const createdAt = sorted.reduce(
      (max, c) => (c.createdAt.getTime() > max.getTime() ? c.createdAt : max),
      sorted[0]?.createdAt ?? new Date(0),
    );
    boards.push({ boardId: key === "__none__" ? null : key, createdAt, concepts: sorted });
  }
  // Newest board first; the null-board (legacy) group sorts by its own recency.
  return boards.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * Toggle a concept's favorite flag. Returns the updated concept, or null when
 * it does not exist in the workspace (tenancy). Never charges.
 */
export async function setThumbnailConceptFavorited(
  workspaceId: string,
  conceptId: string,
  favorited: boolean,
): Promise<ThumbnailConcept | null> {
  if (!hasDb()) {
    const target = memoryRows.find((c) => c.id === conceptId && c.workspaceId === workspaceId);
    if (target === undefined) return null;
    target.favorited = favorited;
    target.updatedAt = new Date();
    return { ...target };
  }
  const db = getDb();
  const updated = await db
    .update(schema.thumbnailConcepts)
    .set({ favorited })
    .where(
      and(
        eq(schema.thumbnailConcepts.id, conceptId),
        eq(schema.thumbnailConcepts.workspaceId, workspaceId),
      ),
    )
    .returning();
  const row = updated[0];
  return row === undefined ? null : thumbnailConceptSchema.parse(row);
}

/**
 * Rewrite a concept's image + whiteboard params in place (the tweak /
 * "regenerate this one" path). Returns the updated concept, or null when it
 * does not exist in the workspace (tenancy).
 */
export async function applyThumbnailConceptTweak(
  workspaceId: string,
  conceptId: string,
  tweak: ThumbnailConceptTweak,
): Promise<ThumbnailConcept | null> {
  if (!hasDb()) {
    const target = memoryRows.find((c) => c.id === conceptId && c.workspaceId === workspaceId);
    if (target === undefined) return null;
    target.imageKey = tweak.imageKey;
    target.promptUsed = tweak.promptUsed;
    target.compositionPattern = tweak.compositionPattern;
    target.overlayText = tweak.overlayText;
    target.presetId = tweak.presetId;
    target.subjectMode = tweak.subjectMode;
    target.colorMood = tweak.colorMood;
    if (tweak.brief !== undefined) target.brief = tweak.brief;
    if (tweak.referenceImageKey !== undefined) target.referenceImageKey = tweak.referenceImageKey;
    target.updatedAt = new Date();
    return { ...target };
  }
  const db = getDb();
  const updated = await db
    .update(schema.thumbnailConcepts)
    .set({
      imageKey: tweak.imageKey,
      promptUsed: tweak.promptUsed,
      compositionPattern: tweak.compositionPattern,
      overlayText: tweak.overlayText,
      presetId: tweak.presetId,
      subjectMode: tweak.subjectMode,
      colorMood: tweak.colorMood,
      ...(tweak.brief !== undefined ? { brief: tweak.brief } : {}),
      ...(tweak.referenceImageKey !== undefined
        ? { referenceImageKey: tweak.referenceImageKey }
        : {}),
    })
    .where(
      and(
        eq(schema.thumbnailConcepts.id, conceptId),
        eq(schema.thumbnailConcepts.workspaceId, workspaceId),
      ),
    )
    .returning();
  const row = updated[0];
  return row === undefined ? null : thumbnailConceptSchema.parse(row);
}
