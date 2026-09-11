import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import {
  audienceAvatarSchema,
  frameSchema,
  projectSchema,
  researchDocSchema,
  revisionSchema,
  scriptSchema,
  scriptSectionSchema,
  titleSetSchema,
  voiceProfileSchema,
  type AudienceAvatar,
  type Frame,
  type Project,
  type ResearchDoc,
  type Revision,
  type Script,
  type ScriptSection,
  type TitleSet,
  type VoiceProfile,
} from "@/lib/types/entities";
import type {
  ChannelId,
  FrameId,
  ProjectId,
  ResearchDocId,
  RevisionId,
  ScriptId,
  ScriptSectionId,
  VoiceProfileId,
  WorkspaceId,
} from "@/lib/types/ids";
import type { Plan, ProjectStatus, ScriptStatus } from "@/lib/types/enums";
import type { HookCandidate, QualityGateReport } from "@/lib/types/pipeline";
import type {
  ApplyRevisionParams,
  CreditRecord,
  EngineStore,
  NewFrame,
  NewProject,
  NewResearchDoc,
  NewRevision,
  NewScriptModeFields,
  NewSection,
  ProjectListFilter,
  ProjectPatch,
  SectionPatch,
} from "./types";

/**
 * True when the error (or anything in its cause chain) is a Postgres
 * unique-constraint violation (SQLSTATE 23505). Drizzle may wrap the pg
 * error, so the chain is walked.
 */
export function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current !== null && typeof current === "object"; depth++) {
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Drizzle-backed EngineStore — production persistence for A2's pipelines.
 * Every query filters on the denormalized workspace_id (spec §3 convention).
 */
export class DrizzleEngineStore implements EngineStore {
  private qualityReports = new Map<string, QualityGateReport>();
  private hookCandidates = new Map<string, HookCandidate[]>();

  async getWorkspacePlan(workspaceId: WorkspaceId): Promise<Plan | null> {
    const rows = await getDb()
      .select({ plan: schema.workspaces.plan })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, workspaceId))
      .limit(1);
    return rows[0]?.plan ?? null;
  }

  async getProject(workspaceId: WorkspaceId, projectId: ProjectId): Promise<Project | null> {
    const rows = await getDb()
      .select()
      .from(schema.projects)
      .where(and(eq(schema.projects.id, projectId), eq(schema.projects.workspaceId, workspaceId)))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : projectSchema.parse(row);
  }

  async listProjects(workspaceId: WorkspaceId, filter: ProjectListFilter): Promise<Project[]> {
    const conditions = [eq(schema.projects.workspaceId, workspaceId)];
    if (filter.channelId !== undefined) {
      conditions.push(eq(schema.projects.channelId, filter.channelId));
    }
    if (filter.status !== undefined) {
      conditions.push(eq(schema.projects.status, filter.status));
    }
    const rows = await getDb()
      .select()
      .from(schema.projects)
      .where(and(...conditions))
      .orderBy(desc(schema.projects.updatedAt))
      .limit(filter.limit);
    return rows.map((r) => projectSchema.parse(r));
  }

  async createProject(project: NewProject): Promise<Project> {
    const rows = await getDb()
      .insert(schema.projects)
      .values({
        workspaceId: project.workspaceId,
        channelId: project.channelId,
        title: project.title,
        ideaId: project.ideaId,
        generationMode: project.generationMode ?? null,
        archetypeId: project.archetypeId ?? null,
        crossover: project.crossover ?? null,
        partnerId: project.partnerId ?? null,
      })
      .returning();
    const row = rows[0];
    if (row === undefined) throw new Error("createProject: insert returned no row");
    return projectSchema.parse(row);
  }

  async updateProject(
    workspaceId: WorkspaceId,
    projectId: ProjectId,
    patch: ProjectPatch,
  ): Promise<Project | null> {
    const rows = await getDb()
      .update(schema.projects)
      .set(patch)
      .where(and(eq(schema.projects.id, projectId), eq(schema.projects.workspaceId, workspaceId)))
      .returning();
    const row = rows[0];
    return row === undefined ? null : projectSchema.parse(row);
  }

  async deleteProject(workspaceId: WorkspaceId, projectId: ProjectId): Promise<boolean> {
    const rows = await getDb()
      .delete(schema.projects)
      .where(and(eq(schema.projects.id, projectId), eq(schema.projects.workspaceId, workspaceId)))
      .returning({ id: schema.projects.id });
    return rows.length > 0;
  }

  async updateProjectStatus(
    workspaceId: WorkspaceId,
    projectId: ProjectId,
    status: ProjectStatus,
  ): Promise<void> {
    await getDb()
      .update(schema.projects)
      .set({ status })
      .where(and(eq(schema.projects.id, projectId), eq(schema.projects.workspaceId, workspaceId)));
  }

  async getAvatarForChannel(channelId: ChannelId): Promise<AudienceAvatar | null> {
    const rows = await getDb()
      .select()
      .from(schema.audienceAvatars)
      .where(eq(schema.audienceAvatars.channelId, channelId))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : audienceAvatarSchema.parse(row);
  }

  async getVoiceProfile(
    workspaceId: WorkspaceId,
    voiceProfileId: VoiceProfileId,
  ): Promise<VoiceProfile | null> {
    const rows = await getDb()
      .select()
      .from(schema.voiceProfiles)
      .where(
        and(
          eq(schema.voiceProfiles.id, voiceProfileId),
          eq(schema.voiceProfiles.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : voiceProfileSchema.parse(row);
  }

  async listVoiceProfiles(workspaceId: WorkspaceId): Promise<VoiceProfile[]> {
    const rows = await getDb()
      .select()
      .from(schema.voiceProfiles)
      .where(eq(schema.voiceProfiles.workspaceId, workspaceId))
      .orderBy(schema.voiceProfiles.name);
    return rows.map((r) => voiceProfileSchema.parse(r));
  }

  // -- research -------------------------------------------------------------

  async listResearchDocs(workspaceId: WorkspaceId, projectId: ProjectId): Promise<ResearchDoc[]> {
    const rows = await getDb()
      .select()
      .from(schema.researchDocs)
      .where(
        and(
          eq(schema.researchDocs.projectId, projectId),
          eq(schema.researchDocs.workspaceId, workspaceId),
        ),
      )
      .orderBy(schema.researchDocs.createdAt);
    return rows.map((r) => researchDocSchema.parse(r));
  }

  async getResearchDoc(
    workspaceId: WorkspaceId,
    researchDocId: ResearchDocId,
  ): Promise<ResearchDoc | null> {
    const rows = await getDb()
      .select()
      .from(schema.researchDocs)
      .where(
        and(
          eq(schema.researchDocs.id, researchDocId),
          eq(schema.researchDocs.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : researchDocSchema.parse(row);
  }

  async insertResearchDoc(doc: NewResearchDoc): Promise<ResearchDoc> {
    const rows = await getDb().insert(schema.researchDocs).values(doc).returning();
    const row = rows[0];
    if (row === undefined) throw new Error("insert into research_docs returned no row");
    return researchDocSchema.parse(row);
  }

  async removeResearchDoc(
    workspaceId: WorkspaceId,
    researchDocId: ResearchDocId,
  ): Promise<boolean> {
    const rows = await getDb()
      .delete(schema.researchDocs)
      .where(
        and(
          eq(schema.researchDocs.id, researchDocId),
          eq(schema.researchDocs.workspaceId, workspaceId),
        ),
      )
      .returning({ id: schema.researchDocs.id });
    return rows.length > 0;
  }

  // -- frames ---------------------------------------------------------------

  async listFrames(workspaceId: WorkspaceId, projectId: ProjectId): Promise<Frame[]> {
    const rows = await getDb()
      .select()
      .from(schema.frames)
      .where(
        and(eq(schema.frames.projectId, projectId), eq(schema.frames.workspaceId, workspaceId)),
      )
      .orderBy(schema.frames.createdAt);
    return rows.map((r) => frameSchema.parse(r));
  }

  async getFrame(workspaceId: WorkspaceId, frameId: FrameId): Promise<Frame | null> {
    const rows = await getDb()
      .select()
      .from(schema.frames)
      .where(and(eq(schema.frames.id, frameId), eq(schema.frames.workspaceId, workspaceId)))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : frameSchema.parse(row);
  }

  async insertFrames(frames: NewFrame[]): Promise<Frame[]> {
    const rows = await getDb().insert(schema.frames).values(frames).returning();
    return rows.map((r) => frameSchema.parse(r));
  }

  async chooseFrame(workspaceId: WorkspaceId, frameId: FrameId): Promise<Frame | null> {
    return await getDb().transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(schema.frames)
        .where(and(eq(schema.frames.id, frameId), eq(schema.frames.workspaceId, workspaceId)))
        .limit(1);
      const frame = rows[0];
      if (frame === undefined) return null;
      await tx
        .update(schema.frames)
        .set({ chosen: false })
        .where(eq(schema.frames.projectId, frame.projectId));
      const updated = await tx
        .update(schema.frames)
        .set({ chosen: true })
        .where(eq(schema.frames.id, frameId))
        .returning();
      const row = updated[0];
      return row === undefined ? null : frameSchema.parse(row);
    });
  }

  async updateFrame(
    workspaceId: WorkspaceId,
    frameId: FrameId,
    fields: Partial<
      Pick<
        Frame,
        "angle" | "format" | "outcome" | "audienceSegment" | "tone" | "targetMinutes" | "keywords"
      >
    >,
  ): Promise<Frame | null> {
    const rows = await getDb()
      .update(schema.frames)
      .set(fields)
      .where(and(eq(schema.frames.id, frameId), eq(schema.frames.workspaceId, workspaceId)))
      .returning();
    const row = rows[0];
    return row === undefined ? null : frameSchema.parse(row);
  }

  // -- scripts + sections ---------------------------------------------------

  async createScript(
    params: {
      workspaceId: WorkspaceId;
      projectId: ProjectId;
      voiceProfileId: VoiceProfileId | null;
    } & NewScriptModeFields,
  ): Promise<Script> {
    const attempt = async (): Promise<Script> =>
      await getDb().transaction(async (tx) => {
        const versions = await tx
          .select({ max: sql<number | null>`max(${schema.scripts.version})` })
          .from(schema.scripts)
          .where(eq(schema.scripts.projectId, params.projectId));
        const nextVersion = (versions[0]?.max ?? 0) + 1;
        const rows = await tx
          .insert(schema.scripts)
          .values({
            workspaceId: params.workspaceId,
            projectId: params.projectId,
            version: nextVersion,
            voiceProfileId: params.voiceProfileId,
            status: "outlining",
            generationMode: params.generationMode ?? null,
            archetypeId: params.archetypeId ?? null,
            crossover: params.crossover ?? null,
            partnerId: params.partnerId ?? null,
          })
          .returning();
        const row = rows[0];
        if (row === undefined) throw new Error("insert into scripts returned no row");
        return scriptSchema.parse(row);
      });
    try {
      return await attempt();
    } catch (err) {
      // Version race: two concurrent creates computed the same max(version)
      // and collided on scripts_project_version_uq. Recompute once and retry.
      if (!isUniqueViolation(err)) throw err;
      return await attempt();
    }
  }

  async getScript(workspaceId: WorkspaceId, scriptId: ScriptId): Promise<Script | null> {
    const rows = await getDb()
      .select()
      .from(schema.scripts)
      .where(and(eq(schema.scripts.id, scriptId), eq(schema.scripts.workspaceId, workspaceId)))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : scriptSchema.parse(row);
  }

  async listScriptVersions(workspaceId: WorkspaceId, projectId: ProjectId): Promise<Script[]> {
    const rows = await getDb()
      .select()
      .from(schema.scripts)
      .where(
        and(eq(schema.scripts.projectId, projectId), eq(schema.scripts.workspaceId, workspaceId)),
      )
      .orderBy(desc(schema.scripts.version));
    return rows.map((r) => scriptSchema.parse(r));
  }

  async updateScript(
    workspaceId: WorkspaceId,
    scriptId: ScriptId,
    patch: { status?: ScriptStatus; stats?: Script["stats"]; version?: number },
  ): Promise<void> {
    await getDb()
      .update(schema.scripts)
      .set(patch)
      .where(and(eq(schema.scripts.id, scriptId), eq(schema.scripts.workspaceId, workspaceId)));
  }

  async replaceSections(
    workspaceId: WorkspaceId,
    scriptId: ScriptId,
    sections: NewSection[],
  ): Promise<ScriptSection[]> {
    return await getDb().transaction(async (tx) => {
      await tx.delete(schema.scriptSections).where(eq(schema.scriptSections.scriptId, scriptId));
      if (sections.length === 0) return [];
      const rows = await tx
        .insert(schema.scriptSections)
        .values(
          sections.map((s) => ({
            workspaceId,
            scriptId,
            position: s.position,
            kind: s.kind,
            heading: s.heading,
            body: s.body,
            voiceProfileId: s.voiceProfileId ?? null,
            estSeconds: s.estSeconds,
            retentionNote: s.retentionNote,
            factRefs: s.factRefs,
          })),
        )
        .returning();
      return rows.map((r) => scriptSectionSchema.parse(r)).sort((a, b) => a.position - b.position);
    });
  }

  async listSections(workspaceId: WorkspaceId, scriptId: ScriptId): Promise<ScriptSection[]> {
    const rows = await getDb()
      .select()
      .from(schema.scriptSections)
      .where(
        and(
          eq(schema.scriptSections.scriptId, scriptId),
          eq(schema.scriptSections.workspaceId, workspaceId),
        ),
      )
      .orderBy(schema.scriptSections.position);
    return rows.map((r) => scriptSectionSchema.parse(r));
  }

  async getSection(
    workspaceId: WorkspaceId,
    sectionId: ScriptSectionId,
  ): Promise<ScriptSection | null> {
    const rows = await getDb()
      .select()
      .from(schema.scriptSections)
      .where(
        and(
          eq(schema.scriptSections.id, sectionId),
          eq(schema.scriptSections.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : scriptSectionSchema.parse(row);
  }

  async updateSection(
    workspaceId: WorkspaceId,
    sectionId: ScriptSectionId,
    patch: SectionPatch,
  ): Promise<ScriptSection | null> {
    const rows = await getDb()
      .update(schema.scriptSections)
      .set(patch)
      .where(
        and(
          eq(schema.scriptSections.id, sectionId),
          eq(schema.scriptSections.workspaceId, workspaceId),
        ),
      )
      .returning();
    const row = rows[0];
    return row === undefined ? null : scriptSectionSchema.parse(row);
  }

  async reorderSections(
    workspaceId: WorkspaceId,
    scriptId: ScriptId,
    sectionIds: ScriptSectionId[],
  ): Promise<ScriptSection[] | null> {
    return await getDb().transaction(async (tx) => {
      const rows = await tx
        .select({ id: schema.scriptSections.id })
        .from(schema.scriptSections)
        .where(
          and(
            eq(schema.scriptSections.scriptId, scriptId),
            eq(schema.scriptSections.workspaceId, workspaceId),
          ),
        );
      const ids = new Set<string>(sectionIds);
      if (rows.length !== sectionIds.length || ids.size !== sectionIds.length) return null;
      if (!rows.every((r) => ids.has(r.id))) return null;
      for (let position = 0; position < sectionIds.length; position++) {
        const sectionId = sectionIds[position];
        if (sectionId === undefined) continue;
        await tx
          .update(schema.scriptSections)
          .set({ position })
          .where(
            and(
              eq(schema.scriptSections.id, sectionId),
              eq(schema.scriptSections.workspaceId, workspaceId),
            ),
          );
      }
      const updated = await tx
        .select()
        .from(schema.scriptSections)
        .where(
          and(
            eq(schema.scriptSections.scriptId, scriptId),
            eq(schema.scriptSections.workspaceId, workspaceId),
          ),
        )
        .orderBy(schema.scriptSections.position);
      return updated.map((r) => scriptSectionSchema.parse(r));
    });
  }

  // -- revisions ------------------------------------------------------------

  async insertRevisions(revisions: NewRevision[]): Promise<Revision[]> {
    if (revisions.length === 0) return [];
    const rows = await getDb().insert(schema.revisions).values(revisions).returning();
    return rows.map((r) => revisionSchema.parse(r));
  }

  async listRevisions(workspaceId: WorkspaceId, scriptId: ScriptId): Promise<Revision[]> {
    const rows = await getDb()
      .select()
      .from(schema.revisions)
      .where(
        and(eq(schema.revisions.scriptId, scriptId), eq(schema.revisions.workspaceId, workspaceId)),
      )
      .orderBy(schema.revisions.createdAt);
    return rows.map((r) => revisionSchema.parse(r));
  }

  async getRevision(workspaceId: WorkspaceId, revisionId: RevisionId): Promise<Revision | null> {
    const rows = await getDb()
      .select()
      .from(schema.revisions)
      .where(
        and(eq(schema.revisions.id, revisionId), eq(schema.revisions.workspaceId, workspaceId)),
      )
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : revisionSchema.parse(row);
  }

  async applyRevision(
    params: ApplyRevisionParams,
  ): Promise<{ revision: Revision; section: ScriptSection }> {
    return await getDb().transaction(async (tx) => {
      const sectionRows = await tx
        .update(schema.scriptSections)
        .set({ body: params.newBody, estSeconds: params.newEstSeconds })
        .where(
          and(
            eq(schema.scriptSections.id, params.sectionId),
            eq(schema.scriptSections.workspaceId, params.workspaceId),
          ),
        )
        .returning();
      const revisionRows = await tx
        .update(schema.revisions)
        .set({ status: "accepted" })
        .where(
          and(
            eq(schema.revisions.id, params.revisionId),
            eq(schema.revisions.workspaceId, params.workspaceId),
          ),
        )
        .returning();
      await tx
        .update(schema.scripts)
        .set({
          version: sql`${schema.scripts.version} + 1`,
          stats: params.newStats,
          status: "revising",
        })
        .where(
          and(
            eq(schema.scripts.id, params.scriptId),
            eq(schema.scripts.workspaceId, params.workspaceId),
          ),
        );
      const section = sectionRows[0];
      const revision = revisionRows[0];
      if (section === undefined || revision === undefined) {
        throw new Error("applyRevision: revision or section not found");
      }
      return {
        revision: revisionSchema.parse(revision),
        section: scriptSectionSchema.parse(section),
      };
    });
  }

  async rejectRevision(workspaceId: WorkspaceId, revisionId: RevisionId): Promise<Revision | null> {
    const rows = await getDb()
      .update(schema.revisions)
      .set({ status: "rejected" })
      .where(
        and(eq(schema.revisions.id, revisionId), eq(schema.revisions.workspaceId, workspaceId)),
      )
      .returning();
    const row = rows[0];
    return row === undefined ? null : revisionSchema.parse(row);
  }

  // -- titles ---------------------------------------------------------------

  async insertTitleSet(params: {
    workspaceId: WorkspaceId;
    projectId: ProjectId;
    options: TitleSet["options"];
  }): Promise<TitleSet> {
    const rows = await getDb().insert(schema.titleSets).values(params).returning();
    const row = rows[0];
    if (row === undefined) throw new Error("insert into title_sets returned no row");
    return titleSetSchema.parse(row);
  }

  async latestTitleSet(workspaceId: WorkspaceId, projectId: ProjectId): Promise<TitleSet | null> {
    const rows = await getDb()
      .select()
      .from(schema.titleSets)
      .where(
        and(
          eq(schema.titleSets.projectId, projectId),
          eq(schema.titleSets.workspaceId, workspaceId),
        ),
      )
      .orderBy(desc(schema.titleSets.createdAt))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : titleSetSchema.parse(row);
  }

  // -- quality reports (process-local cache; recomputable from sections) ----

  saveQualityReport(scriptId: ScriptId, report: QualityGateReport): void {
    this.qualityReports.set(scriptId, report);
  }

  getCachedQualityReport(scriptId: ScriptId): QualityGateReport | null {
    return this.qualityReports.get(scriptId) ?? null;
  }

  // -- hook candidates (process-local cache; no table in frozen schema) -----

  saveHookCandidates(scriptId: ScriptId, candidates: HookCandidate[]): void {
    this.hookCandidates.set(scriptId, candidates);
  }

  getHookCandidates(scriptId: ScriptId): HookCandidate[] | null {
    return this.hookCandidates.get(scriptId) ?? null;
  }

  // -- credits --------------------------------------------------------------

  async recordCredits(record: CreditRecord): Promise<void> {
    if (record.skipDebit === true) return;
    const idempotencyKey = record.idempotencyKey ?? null;
    await getDb().transaction(async (tx) => {
      const values = {
        workspaceId: record.workspaceId,
        delta: record.delta,
        reason: record.reason,
        actorUserId: record.actorUserId,
        projectId: record.projectId,
        idempotencyKey,
      };
      const inserted =
        idempotencyKey === null
          ? await tx
              .insert(schema.creditLedger)
              .values(values)
              .returning({ id: schema.creditLedger.id })
          : await tx
              .insert(schema.creditLedger)
              .values(values)
              .onConflictDoNothing({
                target: schema.creditLedger.idempotencyKey,
                where: sql`${schema.creditLedger.idempotencyKey} IS NOT NULL`,
              })
              .returning({ id: schema.creditLedger.id });
      // Conflict on the idempotency key ⇒ this charge already happened
      // (e.g. a BullMQ retry after the ledger write) — never touch the
      // balance a second time.
      if (inserted.length === 0) return;
      await tx
        .update(schema.workspaces)
        .set({ creditBalance: sql`${schema.workspaces.creditBalance} + ${record.delta}` })
        .where(eq(schema.workspaces.id, record.workspaceId));
    });
  }
}
