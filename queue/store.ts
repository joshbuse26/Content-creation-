import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { PipelineKind } from "@/lib/types/enums";
import {
  RunClaimConflictError,
  type ActiveRunKey,
  type PipelineRunRecord,
  type PipelineRunStore,
} from "./pipeline-runner";

/** Postgres unique_violation (the active-claim partial unique index). */
function isUniqueViolation(err: unknown): boolean {
  for (let cursor: unknown = err; cursor instanceof Error; cursor = cursor.cause) {
    if ((cursor as { code?: unknown }).code === "23505") return true;
  }
  return false;
}

/** Drizzle-backed pipeline_runs store — the production PipelineRunStore. */
export class DrizzlePipelineRunStore implements PipelineRunStore {
  async create(run: Omit<PipelineRunRecord, "id">): Promise<PipelineRunRecord> {
    const db = getDb();
    let rows: { id: string }[];
    try {
      rows = await db
        .insert(schema.pipelineRuns)
        .values({
          workspaceId: run.workspaceId,
          projectId: run.projectId,
          kind: run.kind,
          stage: run.stage,
          status: run.status,
          attempt: run.attempt,
          inputHash: run.inputHash,
          error: run.error,
          creditsCharged: run.creditsCharged,
          output: run.output ?? null,
        })
        .returning({ id: schema.pipelineRuns.id });
    } catch (err) {
      // pipeline_runs_active_claim_idx: an identical run already holds the
      // active claim — surface the typed conflict, never a raw DB error.
      if (isUniqueViolation(err)) throw new RunClaimConflictError();
      throw err;
    }
    const row = rows[0];
    if (row === undefined) throw new Error("insert into pipeline_runs returned no row");
    return { ...run, id: row.id };
  }

  async update(
    id: string,
    patch: Partial<
      Pick<PipelineRunRecord, "status" | "attempt" | "error" | "creditsCharged" | "output">
    >,
  ): Promise<void> {
    const db = getDb();
    await db
      .update(schema.pipelineRuns)
      .set({
        ...patch,
        ...(patch.status === "running" ? { startedAt: new Date() } : {}),
        ...(patch.status === "done" || patch.status === "failed" ? { finishedAt: new Date() } : {}),
      })
      .where(eq(schema.pipelineRuns.id, id));
  }

  async find(key: {
    workspaceId: string;
    projectId: string | null;
    kind: PipelineKind;
    stage: string;
    inputHash: string;
  }): Promise<PipelineRunRecord | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.pipelineRuns)
      .where(
        and(
          eq(schema.pipelineRuns.workspaceId, key.workspaceId),
          key.projectId === null
            ? isNull(schema.pipelineRuns.projectId)
            : eq(schema.pipelineRuns.projectId, key.projectId),
          eq(schema.pipelineRuns.kind, key.kind),
          eq(schema.pipelineRuns.stage, key.stage),
          eq(schema.pipelineRuns.inputHash, key.inputHash),
        ),
      )
      .orderBy(desc(schema.pipelineRuns.createdAt))
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      projectId: row.projectId,
      kind: row.kind,
      stage: row.stage,
      status: row.status,
      attempt: row.attempt,
      inputHash: row.inputHash,
      error: row.error,
      creditsCharged: row.creditsCharged,
      output: row.output ?? null,
    };
  }

  async findRunning(key: ActiveRunKey): Promise<{ id: string; updatedAt: Date } | null> {
    const db = getDb();
    const rows = await db
      .select({ id: schema.pipelineRuns.id, updatedAt: schema.pipelineRuns.updatedAt })
      .from(schema.pipelineRuns)
      .where(
        and(
          eq(schema.pipelineRuns.workspaceId, key.workspaceId),
          key.projectId === null
            ? isNull(schema.pipelineRuns.projectId)
            : eq(schema.pipelineRuns.projectId, key.projectId),
          eq(schema.pipelineRuns.kind, key.kind),
          eq(schema.pipelineRuns.inputHash, key.inputHash),
          eq(schema.pipelineRuns.status, "running"),
        ),
      )
      .orderBy(desc(schema.pipelineRuns.updatedAt))
      .limit(1);
    return rows[0] ?? null;
  }
}
