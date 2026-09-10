import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { PipelineKind } from "@/lib/types/enums";
import type { PipelineRunRecord, PipelineRunStore } from "./pipeline-runner";

/** Drizzle-backed pipeline_runs store — the production PipelineRunStore. */
export class DrizzlePipelineRunStore implements PipelineRunStore {
  async create(run: Omit<PipelineRunRecord, "id">): Promise<PipelineRunRecord> {
    const db = getDb();
    const rows = await db
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
      })
      .returning({ id: schema.pipelineRuns.id });
    const row = rows[0];
    if (row === undefined) throw new Error("insert into pipeline_runs returned no row");
    return { ...run, id: row.id };
  }

  async update(
    id: string,
    patch: Partial<Pick<PipelineRunRecord, "status" | "attempt" | "error" | "creditsCharged">>,
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
    };
  }
}
