import type {
  AudienceAvatar,
  Frame,
  Project,
  ResearchDoc,
  Revision,
  Script,
  ScriptSection,
  ScriptStats,
  TitleSet,
  VoiceProfile,
} from "@/lib/types/entities";
import type {
  ChannelId,
  FrameId,
  ProjectId,
  ResearchDocId,
  RevisionId,
  ScriptId,
  ScriptSectionId,
  TitleSetId,
  VoiceProfileId,
  WorkspaceId,
} from "@/lib/types/ids";
import type {
  CreditReason,
  Plan,
  ProjectStatus,
  ResearchKind,
  ScriptStatus,
  SectionKind,
} from "@/lib/types/enums";
import type { HookCandidate, QualityGateReport } from "@/lib/types/pipeline";
import type { FactRef, DiffOp, TitleOption } from "@/lib/types/entities";

/**
 * EngineStore — persistence behind A2's pipelines and router impls.
 *
 * Two implementations: Drizzle-backed (production, selected when
 * DATABASE_URL is set) and in-memory (fixture mode / tests — seeded with
 * the shared fixtures so the whole product works with zero env).
 *
 * Every read takes workspaceId and filters on the denormalized
 * workspace_id column — tenancy is enforced at the row level here IN
 * ADDITION to the router-level assertAccess middleware.
 */

export interface NewResearchDoc {
  workspaceId: WorkspaceId;
  projectId: ProjectId;
  kind: ResearchKind;
  sourceUrl: string | null;
  title: string;
  content: string;
  wordCount: number;
}

export interface NewFrame {
  workspaceId: WorkspaceId;
  projectId: ProjectId;
  chosen: boolean;
  angle: string;
  format: Frame["format"];
  outcome: Frame["outcome"];
  audienceSegment: string;
  tone: string;
  targetMinutes: number;
  keywords: string[];
}

export interface NewSection {
  position: number;
  kind: SectionKind;
  heading: string;
  body: string;
  estSeconds: number;
  retentionNote: string | null;
  factRefs: FactRef[];
  /** Multi-voice override (v1.1) — undefined ⇒ null (no override). */
  voiceProfileId?: VoiceProfileId | null;
}

export interface SectionPatch {
  heading?: string;
  body?: string;
  locked?: boolean;
  estSeconds?: number;
  retentionNote?: string | null;
  factRefs?: FactRef[];
  /** Multi-voice override (v1.1) — undefined ⇒ unchanged, null ⇒ cleared. */
  voiceProfileId?: VoiceProfileId | null;
}

export interface NewRevision {
  workspaceId: WorkspaceId;
  scriptId: ScriptId;
  sectionId: ScriptSectionId;
  suggestion: string;
  diff: DiffOp[];
  rationale: string;
}

export interface ApplyRevisionParams {
  workspaceId: WorkspaceId;
  revisionId: RevisionId;
  sectionId: ScriptSectionId;
  scriptId: ScriptId;
  newBody: string;
  newEstSeconds: number;
  newStats: ScriptStats;
}

export interface CreditRecord {
  workspaceId: WorkspaceId;
  delta: number;
  reason: CreditReason;
  actorUserId: string | null;
  projectId: ProjectId | null;
  /**
   * Charge dedupe key (typically `<reason>:<run input hash>`). When set, a
   * second recordCredits call with the same key is a no-op — this is what
   * makes completion charges safe under BullMQ retries and identical
   * re-runs. Omit/null for entries that must always append (grants,
   * purchases, refunds).
   */
  idempotencyKey?: string | null;
  /**
   * When true, stores skip the ledger write AND the balance debit.
   * Used for the free-admin bypass (ADMIN_EMAILS / owner-admin role).
   * Not persisted — never a DB column.
   */
  skipDebit?: boolean;
}

export interface NewProject {
  workspaceId: WorkspaceId;
  channelId: ChannelId;
  title: string;
  ideaId: Project["ideaId"];
  /** Wave-C mode fields — omitted/undefined ⇒ null (legacy flow). */
  generationMode?: Project["generationMode"];
  archetypeId?: Project["archetypeId"];
  crossover?: Project["crossover"];
  partnerId?: Project["partnerId"];
}

/** Wave-C mode fields accepted by createScript (undefined ⇒ null). */
export interface NewScriptModeFields {
  generationMode?: Script["generationMode"];
  archetypeId?: Script["archetypeId"];
  crossover?: Script["crossover"];
  partnerId?: Script["partnerId"];
}

export interface ProjectPatch {
  title?: string;
  status?: ProjectStatus;
  targetPublishDate?: string | null;
  publishedVideoId?: string | null;
  /** Wave-C mode fields (project.setGenerationTarget) — undefined ⇒ unchanged, null ⇒ cleared. */
  generationMode?: Project["generationMode"];
  archetypeId?: Project["archetypeId"];
  crossover?: Project["crossover"];
  partnerId?: Project["partnerId"];
}

export interface ProjectListFilter {
  channelId?: ChannelId;
  status?: ProjectStatus;
  limit: number;
}

export interface EngineStore {
  // Workspace / project / channel context
  getWorkspacePlan(workspaceId: WorkspaceId): Promise<Plan | null>;
  getProject(workspaceId: WorkspaceId, projectId: ProjectId): Promise<Project | null>;
  listProjects(workspaceId: WorkspaceId, filter: ProjectListFilter): Promise<Project[]>;
  createProject(project: NewProject): Promise<Project>;
  updateProject(
    workspaceId: WorkspaceId,
    projectId: ProjectId,
    patch: ProjectPatch,
  ): Promise<Project | null>;
  deleteProject(workspaceId: WorkspaceId, projectId: ProjectId): Promise<boolean>;
  updateProjectStatus(
    workspaceId: WorkspaceId,
    projectId: ProjectId,
    status: ProjectStatus,
  ): Promise<void>;
  getAvatarForChannel(channelId: ChannelId): Promise<AudienceAvatar | null>;
  getVoiceProfile(
    workspaceId: WorkspaceId,
    voiceProfileId: VoiceProfileId,
  ): Promise<VoiceProfile | null>;
  /** All voice profiles in the workspace (for the editor's section-voice picker). */
  listVoiceProfiles(workspaceId: WorkspaceId): Promise<VoiceProfile[]>;

  // Research docs
  listResearchDocs(workspaceId: WorkspaceId, projectId: ProjectId): Promise<ResearchDoc[]>;
  getResearchDoc(
    workspaceId: WorkspaceId,
    researchDocId: ResearchDocId,
  ): Promise<ResearchDoc | null>;
  insertResearchDoc(doc: NewResearchDoc): Promise<ResearchDoc>;
  removeResearchDoc(workspaceId: WorkspaceId, researchDocId: ResearchDocId): Promise<boolean>;

  // Frames
  listFrames(workspaceId: WorkspaceId, projectId: ProjectId): Promise<Frame[]>;
  getFrame(workspaceId: WorkspaceId, frameId: FrameId): Promise<Frame | null>;
  insertFrames(frames: NewFrame[]): Promise<Frame[]>;
  /** Sets chosen=true on this frame and false on its project siblings. */
  chooseFrame(workspaceId: WorkspaceId, frameId: FrameId): Promise<Frame | null>;
  updateFrame(
    workspaceId: WorkspaceId,
    frameId: FrameId,
    fields: Partial<
      Pick<
        Frame,
        "angle" | "format" | "outcome" | "audienceSegment" | "tone" | "targetMinutes" | "keywords"
      >
    >,
  ): Promise<Frame | null>;

  // Scripts + sections
  createScript(
    params: {
      workspaceId: WorkspaceId;
      projectId: ProjectId;
      voiceProfileId: VoiceProfileId | null;
    } & NewScriptModeFields,
  ): Promise<Script>;
  getScript(workspaceId: WorkspaceId, scriptId: ScriptId): Promise<Script | null>;
  listScriptVersions(workspaceId: WorkspaceId, projectId: ProjectId): Promise<Script[]>;
  updateScript(
    workspaceId: WorkspaceId,
    scriptId: ScriptId,
    patch: { status?: ScriptStatus; stats?: ScriptStats; version?: number },
  ): Promise<void>;
  /** Deletes existing sections of the script and inserts these, in order. */
  replaceSections(
    workspaceId: WorkspaceId,
    scriptId: ScriptId,
    sections: NewSection[],
  ): Promise<ScriptSection[]>;
  listSections(workspaceId: WorkspaceId, scriptId: ScriptId): Promise<ScriptSection[]>;
  getSection(workspaceId: WorkspaceId, sectionId: ScriptSectionId): Promise<ScriptSection | null>;
  updateSection(
    workspaceId: WorkspaceId,
    sectionId: ScriptSectionId,
    patch: SectionPatch,
  ): Promise<ScriptSection | null>;
  /**
   * Persist a new section order (positions become the index of each id in
   * sectionIds). Returns null when sectionIds is not a permutation of the
   * script's sections.
   */
  reorderSections(
    workspaceId: WorkspaceId,
    scriptId: ScriptId,
    sectionIds: ScriptSectionId[],
  ): Promise<ScriptSection[] | null>;

  // Revisions
  insertRevisions(revisions: NewRevision[]): Promise<Revision[]>;
  listRevisions(workspaceId: WorkspaceId, scriptId: ScriptId): Promise<Revision[]>;
  getRevision(workspaceId: WorkspaceId, revisionId: RevisionId): Promise<Revision | null>;
  /**
   * Accept: atomically writes the section's new body, marks the revision
   * accepted, bumps the script version and updates stats. Rolls back as a
   * unit on failure (DB transaction in production).
   */
  applyRevision(
    params: ApplyRevisionParams,
  ): Promise<{ revision: Revision; section: ScriptSection }>;
  rejectRevision(workspaceId: WorkspaceId, revisionId: RevisionId): Promise<Revision | null>;

  // Titles
  insertTitleSet(params: {
    workspaceId: WorkspaceId;
    projectId: ProjectId;
    options: TitleOption[];
  }): Promise<TitleSet>;
  latestTitleSet(workspaceId: WorkspaceId, projectId: ProjectId): Promise<TitleSet | null>;

  // Quality reports — no dedicated table in the frozen schema; kept in a
  // process-local cache and recomputable from persisted sections (the gate
  // is pure code), so getQualityReport never returns stale-wrong data.
  saveQualityReport(scriptId: ScriptId, report: QualityGateReport): void;
  getCachedQualityReport(scriptId: ScriptId): QualityGateReport | null;

  // Hook candidates — same story as quality reports: no table in the frozen
  // schema, so the stage-3 candidates live in a process-local cache and
  // script.get returns null after a restart (editor falls back locally).
  saveHookCandidates(scriptId: ScriptId, candidates: HookCandidate[]): void;
  getHookCandidates(scriptId: ScriptId): HookCandidate[] | null;

  // Credits (ledger + balance; append-only ledger)
  recordCredits(record: CreditRecord): Promise<void>;
}

export type { TitleSetId };
