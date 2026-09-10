import { randomUUID } from "node:crypto";
import {
  fixtureAvatar,
  fixtureFrame,
  fixtureProject,
  fixtureResearchDoc,
  fixtureRevision,
  fixtureScript,
  fixtureSections,
  fixtureVoiceProfile,
  fixtureWorkspace,
} from "@/lib/fixtures";
import type {
  AudienceAvatar,
  Frame,
  Project,
  ResearchDoc,
  Revision,
  Script,
  ScriptSection,
  TitleSet,
  VoiceProfile,
} from "@/lib/types/entities";
import {
  frameIdSchema,
  projectIdSchema,
  researchDocIdSchema,
  revisionIdSchema,
  scriptIdSchema,
  scriptSectionIdSchema,
  titleSetIdSchema,
  type ChannelId,
  type FrameId,
  type ProjectId,
  type ResearchDocId,
  type RevisionId,
  type ScriptId,
  type ScriptSectionId,
  type VoiceProfileId,
  type WorkspaceId,
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
  NewSection,
  ProjectListFilter,
  ProjectPatch,
  SectionPatch,
} from "./types";

const clone = <T>(value: T): T => structuredClone(value);
const cloneOrNull = <T>(value: T | undefined): T | null =>
  value === undefined ? null : structuredClone(value);

/**
 * In-memory EngineStore — fixture mode and tests. Seeded with the shared
 * fixtures so a zero-env boot has a workspace, project, chosen frame,
 * research, a script with sections, a pending revision, and credits.
 * Reads return CLONES so callers can never mutate store state in place.
 */
export class InMemoryEngineStore implements EngineStore {
  private plans = new Map<string, Plan>();
  private projects: Project[] = [];
  private avatars: AudienceAvatar[] = [];
  private voiceProfiles: VoiceProfile[] = [];
  private researchDocs: ResearchDoc[] = [];
  private frames: Frame[] = [];
  private scripts: Script[] = [];
  private sections: ScriptSection[] = [];
  private revisions: Revision[] = [];
  private titleSets: TitleSet[] = [];
  private qualityReports = new Map<string, QualityGateReport>();
  private hookCandidates = new Map<string, HookCandidate[]>();
  /** Append-only, mirrors credit_ledger semantics. */
  public readonly creditEntries: CreditRecord[] = [];

  constructor(options: { seedFixtures?: boolean } = {}) {
    if (options.seedFixtures ?? true) {
      this.plans.set(fixtureWorkspace.id, fixtureWorkspace.plan);
      this.projects.push({ ...fixtureProject });
      this.avatars.push({ ...fixtureAvatar });
      this.voiceProfiles.push({ ...fixtureVoiceProfile });
      this.researchDocs.push({ ...fixtureResearchDoc });
      this.frames.push({ ...fixtureFrame });
      this.scripts.push({ ...fixtureScript });
      this.sections.push(...fixtureSections.map((s) => ({ ...s })));
      this.revisions.push({ ...fixtureRevision });
    }
  }

  // -- test/seed helpers ----------------------------------------------------

  setPlan(workspaceId: WorkspaceId, plan: Plan): void {
    this.plans.set(workspaceId, plan);
  }

  seedProject(project: Project): void {
    this.projects.push({ ...project });
  }

  seedFrame(frame: Frame): void {
    this.frames.push({ ...frame });
  }

  seedVoiceProfile(profile: VoiceProfile): void {
    this.voiceProfiles.push({ ...profile });
  }

  seedAvatar(avatar: AudienceAvatar): void {
    this.avatars.push({ ...avatar });
  }

  // -- context --------------------------------------------------------------

  getWorkspacePlan(workspaceId: WorkspaceId): Promise<Plan | null> {
    return Promise.resolve(this.plans.get(workspaceId as string) ?? null);
  }

  getProject(workspaceId: WorkspaceId, projectId: ProjectId): Promise<Project | null> {
    return Promise.resolve(
      cloneOrNull(this.projects.find((p) => p.id === projectId && p.workspaceId === workspaceId)),
    );
  }

  listProjects(workspaceId: WorkspaceId, filter: ProjectListFilter): Promise<Project[]> {
    const rows = this.projects
      .filter(
        (p) =>
          p.workspaceId === workspaceId &&
          (filter.channelId === undefined || p.channelId === filter.channelId) &&
          (filter.status === undefined || p.status === filter.status),
      )
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, filter.limit);
    return Promise.resolve(clone(rows));
  }

  createProject(project: NewProject): Promise<Project> {
    const now = new Date();
    const row: Project = {
      id: projectIdSchema.parse(randomUUID()),
      workspaceId: project.workspaceId,
      channelId: project.channelId,
      title: project.title,
      status: "idea",
      ideaId: project.ideaId,
      targetPublishDate: null,
      publishedVideoId: null,
      createdAt: now,
      updatedAt: now,
    };
    this.projects.push(row);
    return Promise.resolve(clone(row));
  }

  updateProject(
    workspaceId: WorkspaceId,
    projectId: ProjectId,
    patch: ProjectPatch,
  ): Promise<Project | null> {
    const project = this.projects.find((p) => p.id === projectId && p.workspaceId === workspaceId);
    if (project === undefined) return Promise.resolve(null);
    if (patch.title !== undefined) project.title = patch.title;
    if (patch.status !== undefined) project.status = patch.status;
    if (patch.targetPublishDate !== undefined) project.targetPublishDate = patch.targetPublishDate;
    if (patch.publishedVideoId !== undefined) project.publishedVideoId = patch.publishedVideoId;
    project.updatedAt = new Date();
    return Promise.resolve(clone(project));
  }

  deleteProject(workspaceId: WorkspaceId, projectId: ProjectId): Promise<boolean> {
    const index = this.projects.findIndex(
      (p) => p.id === projectId && p.workspaceId === workspaceId,
    );
    if (index === -1) return Promise.resolve(false);
    this.projects.splice(index, 1);
    return Promise.resolve(true);
  }

  updateProjectStatus(
    workspaceId: WorkspaceId,
    projectId: ProjectId,
    status: ProjectStatus,
  ): Promise<void> {
    const project = this.projects.find((p) => p.id === projectId && p.workspaceId === workspaceId);
    if (project !== undefined) {
      project.status = status;
      project.updatedAt = new Date();
    }
    return Promise.resolve();
  }

  getAvatarForChannel(channelId: ChannelId): Promise<AudienceAvatar | null> {
    return Promise.resolve(cloneOrNull(this.avatars.find((a) => a.channelId === channelId)));
  }

  getVoiceProfile(
    workspaceId: WorkspaceId,
    voiceProfileId: VoiceProfileId,
  ): Promise<VoiceProfile | null> {
    return Promise.resolve(
      cloneOrNull(
        this.voiceProfiles.find((v) => v.id === voiceProfileId && v.workspaceId === workspaceId),
      ),
    );
  }

  // -- research -------------------------------------------------------------

  listResearchDocs(workspaceId: WorkspaceId, projectId: ProjectId): Promise<ResearchDoc[]> {
    return Promise.resolve(
      clone(
        this.researchDocs.filter((d) => d.projectId === projectId && d.workspaceId === workspaceId),
      ),
    );
  }

  getResearchDoc(
    workspaceId: WorkspaceId,
    researchDocId: ResearchDocId,
  ): Promise<ResearchDoc | null> {
    return Promise.resolve(
      cloneOrNull(
        this.researchDocs.find((d) => d.id === researchDocId && d.workspaceId === workspaceId),
      ),
    );
  }

  insertResearchDoc(doc: NewResearchDoc): Promise<ResearchDoc> {
    const now = new Date();
    const row: ResearchDoc = {
      id: researchDocIdSchema.parse(randomUUID()),
      ...doc,
      fetchedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    this.researchDocs.push(row);
    return Promise.resolve(clone(row));
  }

  removeResearchDoc(workspaceId: WorkspaceId, researchDocId: ResearchDocId): Promise<boolean> {
    const before = this.researchDocs.length;
    this.researchDocs = this.researchDocs.filter(
      (d) => !(d.id === researchDocId && d.workspaceId === workspaceId),
    );
    return Promise.resolve(this.researchDocs.length < before);
  }

  // -- frames ---------------------------------------------------------------

  listFrames(workspaceId: WorkspaceId, projectId: ProjectId): Promise<Frame[]> {
    return Promise.resolve(
      clone(this.frames.filter((f) => f.projectId === projectId && f.workspaceId === workspaceId)),
    );
  }

  getFrame(workspaceId: WorkspaceId, frameId: FrameId): Promise<Frame | null> {
    return Promise.resolve(
      cloneOrNull(this.frames.find((f) => f.id === frameId && f.workspaceId === workspaceId)),
    );
  }

  insertFrames(frames: NewFrame[]): Promise<Frame[]> {
    const now = new Date();
    const rows = frames.map((f): Frame => {
      return {
        id: frameIdSchema.parse(randomUUID()),
        ...f,
        createdAt: now,
        updatedAt: now,
      };
    });
    this.frames.push(...rows);
    return Promise.resolve(clone(rows));
  }

  chooseFrame(workspaceId: WorkspaceId, frameId: FrameId): Promise<Frame | null> {
    const frame = this.frames.find((f) => f.id === frameId && f.workspaceId === workspaceId);
    if (frame === undefined) return Promise.resolve(null);
    for (const sibling of this.frames) {
      if (sibling.projectId === frame.projectId) {
        sibling.chosen = sibling.id === frame.id;
        sibling.updatedAt = new Date();
      }
    }
    return Promise.resolve(clone(frame));
  }

  updateFrame(
    workspaceId: WorkspaceId,
    frameId: FrameId,
    fields: Partial<
      Pick<
        Frame,
        "angle" | "format" | "outcome" | "audienceSegment" | "tone" | "targetMinutes" | "keywords"
      >
    >,
  ): Promise<Frame | null> {
    const frame = this.frames.find((f) => f.id === frameId && f.workspaceId === workspaceId);
    if (frame === undefined) return Promise.resolve(null);
    Object.assign(frame, fields);
    frame.updatedAt = new Date();
    return Promise.resolve(clone(frame));
  }

  // -- scripts + sections ---------------------------------------------------

  createScript(params: {
    workspaceId: WorkspaceId;
    projectId: ProjectId;
    voiceProfileId: VoiceProfileId | null;
  }): Promise<Script> {
    const now = new Date();
    const maxVersion = this.scripts
      .filter((s) => s.projectId === params.projectId)
      .reduce((max, s) => Math.max(max, s.version), 0);
    const row: Script = {
      id: scriptIdSchema.parse(randomUUID()),
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      version: maxVersion + 1,
      voiceProfileId: params.voiceProfileId,
      status: "outlining",
      stats: { words: 0, estRuntimeS: 0, readability: 0 },
      createdAt: now,
      updatedAt: now,
    };
    this.scripts.push(row);
    return Promise.resolve(clone(row));
  }

  getScript(workspaceId: WorkspaceId, scriptId: ScriptId): Promise<Script | null> {
    return Promise.resolve(
      cloneOrNull(this.scripts.find((s) => s.id === scriptId && s.workspaceId === workspaceId)),
    );
  }

  listScriptVersions(workspaceId: WorkspaceId, projectId: ProjectId): Promise<Script[]> {
    return Promise.resolve(
      clone(
        this.scripts
          .filter((s) => s.projectId === projectId && s.workspaceId === workspaceId)
          .sort((a, b) => b.version - a.version),
      ),
    );
  }

  updateScript(
    workspaceId: WorkspaceId,
    scriptId: ScriptId,
    patch: { status?: ScriptStatus; stats?: Script["stats"]; version?: number },
  ): Promise<void> {
    const script = this.scripts.find((s) => s.id === scriptId && s.workspaceId === workspaceId);
    if (script !== undefined) {
      if (patch.status !== undefined) script.status = patch.status;
      if (patch.stats !== undefined) script.stats = patch.stats;
      if (patch.version !== undefined) script.version = patch.version;
      script.updatedAt = new Date();
    }
    return Promise.resolve();
  }

  replaceSections(
    workspaceId: WorkspaceId,
    scriptId: ScriptId,
    sections: NewSection[],
  ): Promise<ScriptSection[]> {
    this.sections = this.sections.filter((s) => s.scriptId !== scriptId);
    const now = new Date();
    const rows = sections.map((s): ScriptSection => ({
      id: scriptSectionIdSchema.parse(randomUUID()),
      workspaceId,
      scriptId,
      position: s.position,
      kind: s.kind,
      heading: s.heading,
      body: s.body,
      voiceProfileId: null,
      locked: false,
      estSeconds: s.estSeconds,
      retentionNote: s.retentionNote,
      factRefs: s.factRefs,
      createdAt: now,
      updatedAt: now,
    }));
    this.sections.push(...rows);
    return Promise.resolve(clone(rows));
  }

  listSections(workspaceId: WorkspaceId, scriptId: ScriptId): Promise<ScriptSection[]> {
    return Promise.resolve(
      clone(
        this.sections
          .filter((s) => s.scriptId === scriptId && s.workspaceId === workspaceId)
          .sort((a, b) => a.position - b.position),
      ),
    );
  }

  getSection(workspaceId: WorkspaceId, sectionId: ScriptSectionId): Promise<ScriptSection | null> {
    return Promise.resolve(
      cloneOrNull(this.sections.find((s) => s.id === sectionId && s.workspaceId === workspaceId)),
    );
  }

  updateSection(
    workspaceId: WorkspaceId,
    sectionId: ScriptSectionId,
    patch: SectionPatch,
  ): Promise<ScriptSection | null> {
    const section = this.sections.find((s) => s.id === sectionId && s.workspaceId === workspaceId);
    if (section === undefined) return Promise.resolve(null);
    if (patch.heading !== undefined) section.heading = patch.heading;
    if (patch.body !== undefined) section.body = patch.body;
    if (patch.locked !== undefined) section.locked = patch.locked;
    if (patch.estSeconds !== undefined) section.estSeconds = patch.estSeconds;
    if (patch.retentionNote !== undefined) section.retentionNote = patch.retentionNote;
    if (patch.factRefs !== undefined) section.factRefs = patch.factRefs;
    section.updatedAt = new Date();
    return Promise.resolve(clone(section));
  }

  reorderSections(
    workspaceId: WorkspaceId,
    scriptId: ScriptId,
    sectionIds: ScriptSectionId[],
  ): Promise<ScriptSection[] | null> {
    const rows = this.sections.filter(
      (s) => s.scriptId === scriptId && s.workspaceId === workspaceId,
    );
    const ids = new Set<string>(sectionIds);
    if (rows.length !== sectionIds.length || ids.size !== sectionIds.length) {
      return Promise.resolve(null);
    }
    if (!rows.every((s) => ids.has(s.id))) return Promise.resolve(null);
    const now = new Date();
    for (const section of rows) {
      const position = sectionIds.indexOf(section.id);
      if (section.position !== position) {
        section.position = position;
        section.updatedAt = now;
      }
    }
    return Promise.resolve(clone([...rows].sort((a, b) => a.position - b.position)));
  }

  // -- revisions ------------------------------------------------------------

  insertRevisions(revisions: NewRevision[]): Promise<Revision[]> {
    const now = new Date();
    const rows = revisions.map((r): Revision => ({
      id: revisionIdSchema.parse(randomUUID()),
      ...r,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    }));
    this.revisions.push(...rows);
    return Promise.resolve(clone(rows));
  }

  listRevisions(workspaceId: WorkspaceId, scriptId: ScriptId): Promise<Revision[]> {
    return Promise.resolve(
      clone(this.revisions.filter((r) => r.scriptId === scriptId && r.workspaceId === workspaceId)),
    );
  }

  getRevision(workspaceId: WorkspaceId, revisionId: RevisionId): Promise<Revision | null> {
    return Promise.resolve(
      cloneOrNull(this.revisions.find((r) => r.id === revisionId && r.workspaceId === workspaceId)),
    );
  }

  applyRevision(
    params: ApplyRevisionParams,
  ): Promise<{ revision: Revision; section: ScriptSection }> {
    const revision = this.revisions.find(
      (r) => r.id === params.revisionId && r.workspaceId === params.workspaceId,
    );
    const section = this.sections.find(
      (s) => s.id === params.sectionId && s.workspaceId === params.workspaceId,
    );
    const script = this.scripts.find(
      (s) => s.id === params.scriptId && s.workspaceId === params.workspaceId,
    );
    if (revision === undefined || section === undefined || script === undefined) {
      return Promise.reject(new Error("applyRevision: revision, section, or script not found"));
    }
    const now = new Date();
    section.body = params.newBody;
    section.estSeconds = params.newEstSeconds;
    section.updatedAt = now;
    revision.status = "accepted";
    revision.updatedAt = now;
    script.version += 1;
    script.stats = params.newStats;
    script.status = "revising";
    script.updatedAt = now;
    return Promise.resolve({ revision: clone(revision), section: clone(section) });
  }

  rejectRevision(workspaceId: WorkspaceId, revisionId: RevisionId): Promise<Revision | null> {
    const revision = this.revisions.find(
      (r) => r.id === revisionId && r.workspaceId === workspaceId,
    );
    if (revision === undefined) return Promise.resolve(null);
    revision.status = "rejected";
    revision.updatedAt = new Date();
    return Promise.resolve(clone(revision));
  }

  // -- titles ---------------------------------------------------------------

  insertTitleSet(params: {
    workspaceId: WorkspaceId;
    projectId: ProjectId;
    options: TitleSet["options"];
  }): Promise<TitleSet> {
    const now = new Date();
    const row: TitleSet = {
      id: titleSetIdSchema.parse(randomUUID()),
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      options: params.options,
      createdAt: now,
      updatedAt: now,
    };
    this.titleSets.push(row);
    return Promise.resolve(clone(row));
  }

  latestTitleSet(workspaceId: WorkspaceId, projectId: ProjectId): Promise<TitleSet | null> {
    const rows = this.titleSets.filter(
      (t) => t.projectId === projectId && t.workspaceId === workspaceId,
    );
    return Promise.resolve(cloneOrNull(rows.at(-1)));
  }

  // -- quality reports ------------------------------------------------------

  saveQualityReport(scriptId: ScriptId, report: QualityGateReport): void {
    this.qualityReports.set(scriptId, report);
  }

  getCachedQualityReport(scriptId: ScriptId): QualityGateReport | null {
    return this.qualityReports.get(scriptId) ?? null;
  }

  // -- hook candidates (process-local cache, like quality reports) ----------

  saveHookCandidates(scriptId: ScriptId, candidates: HookCandidate[]): void {
    this.hookCandidates.set(scriptId, clone(candidates));
  }

  getHookCandidates(scriptId: ScriptId): HookCandidate[] | null {
    const candidates = this.hookCandidates.get(scriptId);
    return candidates === undefined ? null : clone(candidates);
  }

  // -- credits --------------------------------------------------------------

  recordCredits(record: CreditRecord): Promise<void> {
    this.creditEntries.push(record);
    return Promise.resolve();
  }
}
