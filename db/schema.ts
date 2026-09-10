import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  CHANNEL_MODES,
  CREDIT_REASONS,
  DESCRIPTION_MODES,
  FRAME_FORMATS,
  FRAME_OUTCOMES,
  IDEA_STATUSES,
  PIPELINE_KINDS,
  PIPELINE_RUN_STATUSES,
  PLANS,
  PROJECT_STATUSES,
  RESEARCH_KINDS,
  REVISION_STATUSES,
  ROLES,
  SCRIPT_STATUSES,
  SECTION_KINDS,
  SOPHISTICATION_LEVELS,
  SYNC_STATUSES,
  THUMBNAIL_STATUSES,
  VOICE_SOURCES,
} from "@/lib/types/enums";

/**
 * FROZEN LAYER — full schema per build spec §3, including tables for
 * features cut to v1.1 (outlier index, thumbnails, templates, api_keys):
 * schema changes later are the expensive kind.
 *
 * Conventions: uuid pk, created_at/updated_at timestamptz, FK indexes on
 * every relation, workspace_id denormalized onto every tenant row for
 * row-level authz checks. Soft delete only where noted.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const planEnum = pgEnum("plan", PLANS);
export const roleEnum = pgEnum("role", ROLES);
export const channelModeEnum = pgEnum("channel_mode", CHANNEL_MODES);
export const syncStatusEnum = pgEnum("sync_status", SYNC_STATUSES);
export const sophisticationEnum = pgEnum("sophistication", SOPHISTICATION_LEVELS);
export const voiceSourceEnum = pgEnum("voice_source", VOICE_SOURCES);
export const ideaStatusEnum = pgEnum("idea_status", IDEA_STATUSES);
export const projectStatusEnum = pgEnum("project_status", PROJECT_STATUSES);
export const researchKindEnum = pgEnum("research_kind", RESEARCH_KINDS);
export const frameFormatEnum = pgEnum("frame_format", FRAME_FORMATS);
export const frameOutcomeEnum = pgEnum("frame_outcome", FRAME_OUTCOMES);
export const scriptStatusEnum = pgEnum("script_status", SCRIPT_STATUSES);
export const sectionKindEnum = pgEnum("section_kind", SECTION_KINDS);
export const revisionStatusEnum = pgEnum("revision_status", REVISION_STATUSES);
export const thumbnailStatusEnum = pgEnum("thumbnail_status", THUMBNAIL_STATUSES);
export const descriptionModeEnum = pgEnum("description_mode", DESCRIPTION_MODES);
export const pipelineKindEnum = pgEnum("pipeline_kind", PIPELINE_KINDS);
export const pipelineRunStatusEnum = pgEnum("pipeline_run_status", PIPELINE_RUN_STATUSES);
export const creditReasonEnum = pgEnum("credit_reason", CREDIT_REASONS);

// ---------------------------------------------------------------------------
// Column helpers
// ---------------------------------------------------------------------------

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ---------------------------------------------------------------------------
// Tenancy core
// ---------------------------------------------------------------------------

export const workspaces = pgTable(
  "workspaces",
  {
    id: id(),
    name: text("name").notNull(),
    plan: planEnum("plan").notNull().default("free"),
    stripeCustomerId: text("stripe_customer_id"),
    creditBalance: integer("credit_balance").notNull().default(0),
    billingCycleAnchor: timestamp("billing_cycle_anchor", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Overdraft floor (0 for now): a charge may never push the balance
    // negative — the dispatch-time requireCredits gate is the primary
    // control, this CHECK is the database-level backstop.
    check("workspaces_credit_balance_floor", sql`${t.creditBalance} >= 0`),
  ],
);

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name"),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull().default("viewer"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("memberships_workspace_user_uq").on(t.workspaceId, t.userId),
    index("memberships_user_idx").on(t.userId),
  ],
);

// ---------------------------------------------------------------------------
// Auth.js (database sessions + magic-link verification)
// ---------------------------------------------------------------------------

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.providerAccountId] }),
    index("accounts_user_idx").on(t.userId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    sessionToken: text("session_token").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export const channels = pgTable(
  "channels",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    mode: channelModeEnum("mode").notNull(),
    youtubeChannelId: text("youtube_channel_id").notNull(),
    title: text("title").notNull(),
    handle: text("handle"),
    /** Encrypted at rest with pgcrypto (pgp_sym_encrypt) — never stored plaintext. */
    oauthRefreshToken: text("oauth_refresh_token"),
    nicheKeywords: text("niche_keywords").array().notNull().default([]),
    syncStatus: syncStatusEnum("sync_status").notNull().default("never"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("channels_workspace_idx").on(t.workspaceId),
    uniqueIndex("channels_workspace_ytid_uq").on(t.workspaceId, t.youtubeChannelId),
  ],
);

export const channelStatsSnapshots = pgTable(
  "channel_stats_snapshots",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    subs: integer("subs").notNull(),
    totalViews: integer("total_views").notNull(),
    medianViews90d: integer("median_views_90d").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("channel_stats_snapshots_channel_idx").on(t.channelId),
    index("channel_stats_snapshots_workspace_idx").on(t.workspaceId),
  ],
);

export const audienceAvatars = pgTable(
  "audience_avatars",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .unique()
      .references(() => channels.id, { onDelete: "cascade" }),
    ageRange: text("age_range"),
    genderSplit: text("gender_split"),
    geo: text("geo").array().notNull().default([]),
    sophistication: sophisticationEnum("sophistication"),
    pains: jsonb("pains").$type<{ pain: string; evidence: string }[]>().notNull().default([]),
    motivations: jsonb("motivations")
      .$type<{ motivation: string; evidence: string }[]>()
      .notNull()
      .default([]),
    vocabularyNotes: text("vocabulary_notes"),
    editableByUser: boolean("editable_by_user").notNull().default(true),
    aiGeneratedAt: timestamp("ai_generated_at", { withTimezone: true }),
    lastEditedBy: uuid("last_edited_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("audience_avatars_workspace_idx").on(t.workspaceId)],
);

export const voiceProfiles = pgTable(
  "voice_profiles",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    source: voiceSourceEnum("source").notNull(),
    styleCard: jsonb("style_card")
      .$type<{
        rhythm: string;
        register: string;
        catchphrases: string[];
        humor: string;
        pov: string;
        taboos: string[];
      }>()
      .notNull(),
    licenseDocUrl: text("license_doc_url"),
    licenseSignedAt: timestamp("license_signed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("voice_profiles_channel_idx").on(t.channelId),
    index("voice_profiles_workspace_idx").on(t.workspaceId),
    // Licensed voices require BOTH license fields non-null. No exceptions.
    check(
      "voice_profiles_license_required",
      sql`${t.source} <> 'licensed' OR (${t.licenseDocUrl} IS NOT NULL AND ${t.licenseSignedAt} IS NOT NULL)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Ideation (v1.1 feature — table ships now)
// ---------------------------------------------------------------------------

export const nicheVideos = pgTable(
  "niche_videos",
  {
    id: id(),
    youtubeVideoId: text("youtube_video_id").notNull().unique(),
    channelYtid: text("channel_ytid").notNull(),
    title: text("title").notNull(),
    thumbnailUrl: text("thumbnail_url"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    viewCount: integer("view_count").notNull(),
    channelMedianViews: integer("channel_median_views").notNull(),
    outlierRatio: numeric("outlier_ratio", { precision: 10, scale: 2 }).notNull(),
    formatTags: text("format_tags").array().notNull().default([]),
    nicheKeywords: text("niche_keywords").array().notNull().default([]),
    lastRefreshedAt: timestamp("last_refreshed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("niche_videos_channel_ytid_idx").on(t.channelYtid)],
);

export const ideas = pgTable(
  "ideas",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    angle: text("angle").notNull(),
    rationale: text("rationale").notNull(),
    evidenceVideoIds: text("evidence_video_ids").array().notNull().default([]),
    score: numeric("score", { precision: 5, scale: 2 }).notNull(),
    status: ideaStatusEnum("status").notNull().default("new"),
    generatedOn: date("generated_on").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("ideas_channel_idx").on(t.channelId),
    index("ideas_workspace_idx").on(t.workspaceId),
  ],
);

// ---------------------------------------------------------------------------
// Projects & the scripting loop
// ---------------------------------------------------------------------------

export const projects = pgTable(
  "projects",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: projectStatusEnum("status").notNull().default("idea"),
    ideaId: uuid("idea_id").references(() => ideas.id, { onDelete: "set null" }),
    targetPublishDate: date("target_publish_date"),
    publishedVideoId: text("published_video_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("projects_workspace_idx").on(t.workspaceId),
    index("projects_channel_idx").on(t.channelId),
    index("projects_idea_idx").on(t.ideaId),
  ],
);

export const researchDocs = pgTable(
  "research_docs",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: researchKindEnum("kind").notNull(),
    sourceUrl: text("source_url"),
    title: text("title").notNull(),
    /** Capped at 200KB — enforced in the API layer. */
    content: text("content").notNull(),
    wordCount: integer("word_count").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("research_docs_project_idx").on(t.projectId),
    index("research_docs_workspace_idx").on(t.workspaceId),
  ],
);

export const frames = pgTable(
  "frames",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    chosen: boolean("chosen").notNull().default(false),
    angle: text("angle").notNull(),
    format: frameFormatEnum("format").notNull(),
    outcome: frameOutcomeEnum("outcome").notNull(),
    audienceSegment: text("audience_segment").notNull(),
    tone: text("tone").notNull(),
    targetMinutes: integer("target_minutes").notNull(),
    keywords: text("keywords").array().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("frames_project_idx").on(t.projectId),
    index("frames_workspace_idx").on(t.workspaceId),
  ],
);

export const scripts = pgTable(
  "scripts",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    voiceProfileId: uuid("voice_profile_id").references(() => voiceProfiles.id, {
      onDelete: "set null",
    }),
    status: scriptStatusEnum("status").notNull().default("outlining"),
    stats: jsonb("stats")
      .$type<{ words: number; estRuntimeS: number; readability: number }>()
      .notNull()
      .default({ words: 0, estRuntimeS: 0, readability: 0 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("scripts_project_idx").on(t.projectId),
    index("scripts_workspace_idx").on(t.workspaceId),
    index("scripts_voice_profile_idx").on(t.voiceProfileId),
    uniqueIndex("scripts_project_version_uq").on(t.projectId, t.version),
  ],
);

export const scriptSections = pgTable(
  "script_sections",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    scriptId: uuid("script_id")
      .notNull()
      .references(() => scripts.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    kind: sectionKindEnum("kind").notNull(),
    heading: text("heading").notNull(),
    body: text("body").notNull(),
    /** Multi-voice override (v1.1). */
    voiceProfileId: uuid("voice_profile_id").references(() => voiceProfiles.id, {
      onDelete: "set null",
    }),
    locked: boolean("locked").notNull().default(false),
    estSeconds: integer("est_seconds").notNull().default(0),
    retentionNote: text("retention_note"),
    factRefs: jsonb("fact_refs")
      .$type<{ claim: string; researchDocId: string | null }[]>()
      .notNull()
      .default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("script_sections_script_idx").on(t.scriptId),
    index("script_sections_workspace_idx").on(t.workspaceId),
    uniqueIndex("script_sections_script_position_uq").on(t.scriptId, t.position),
  ],
);

export const revisions = pgTable(
  "revisions",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    scriptId: uuid("script_id")
      .notNull()
      .references(() => scripts.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => scriptSections.id, { onDelete: "cascade" }),
    suggestion: text("suggestion").notNull(),
    diff: jsonb("diff")
      .$type<{ lineStart: number; lineEnd: number; replacement: string }[]>()
      .notNull(),
    status: revisionStatusEnum("status").notNull().default("pending"),
    rationale: text("rationale").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("revisions_script_idx").on(t.scriptId),
    index("revisions_section_idx").on(t.sectionId),
    index("revisions_workspace_idx").on(t.workspaceId),
  ],
);

// ---------------------------------------------------------------------------
// Packaging
// ---------------------------------------------------------------------------

export const titleSets = pgTable(
  "title_sets",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    options: jsonb("options")
      .$type<{ text: string; patternFamily: string; score: number }[]>()
      .notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("title_sets_project_idx").on(t.projectId),
    index("title_sets_workspace_idx").on(t.workspaceId),
  ],
);

export const thumbnailConcepts = pgTable(
  "thumbnail_concepts",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    promptUsed: text("prompt_used").notNull(),
    compositionPattern: text("composition_pattern").notNull(),
    /** Object-storage key — never a third-party URL. */
    imageKey: text("image_key"),
    status: thumbnailStatusEnum("status").notNull().default("candidate"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("thumbnail_concepts_project_idx").on(t.projectId),
    index("thumbnail_concepts_workspace_idx").on(t.workspaceId),
  ],
);

export const descriptionTemplates = pgTable(
  "description_templates",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Body with {{slots}}. */
    body: text("body").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("description_templates_workspace_idx").on(t.workspaceId)],
);

export const descriptions = pgTable(
  "descriptions",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    mode: descriptionModeEnum("mode").notNull(),
    body: text("body").notNull(),
    templateId: uuid("template_id").references(() => descriptionTemplates.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("descriptions_project_idx").on(t.projectId),
    index("descriptions_workspace_idx").on(t.workspaceId),
    index("descriptions_template_idx").on(t.templateId),
  ],
);

export const tagSets = pgTable(
  "tag_sets",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    tags: text("tags").array().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("tag_sets_project_idx").on(t.projectId),
    index("tag_sets_workspace_idx").on(t.workspaceId),
  ],
);

export const chapters = pgTable(
  "chapters",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Derived from sections' est_seconds; editable. */
    entries: jsonb("entries").$type<{ tsSeconds: number; label: string }[]>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("chapters_project_idx").on(t.projectId),
    index("chapters_workspace_idx").on(t.workspaceId),
  ],
);

// ---------------------------------------------------------------------------
// Pipelines, credits, API keys
// ---------------------------------------------------------------------------

export const pipelineRuns = pgTable(
  "pipeline_runs",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    kind: pipelineKindEnum("kind").notNull(),
    stage: text("stage").notNull(),
    status: pipelineRunStatusEnum("status").notNull().default("queued"),
    attempt: integer("attempt").notNull().default(0),
    inputHash: text("input_hash").notNull(),
    error: text("error"),
    creditsCharged: integer("credits_charged").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("pipeline_runs_project_idx").on(t.projectId),
    index("pipeline_runs_workspace_idx").on(t.workspaceId),
    index("pipeline_runs_kind_stage_idx").on(t.kind, t.stage),
  ],
);

/**
 * Append-only: no UPDATE or DELETE ever (enforced by convention + nightly
 * reconciliation of workspaces.credit_balance against SUM(delta)).
 */
export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    delta: integer("delta").notNull(),
    reason: creditReasonEnum("reason").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    pipelineRunId: uuid("pipeline_run_id").references(() => pipelineRuns.id, {
      onDelete: "set null",
    }),
    /** Charge dedupe key (e.g. `<reason>:<run input hash>`) — a retried or
     *  re-run pipeline completion writes at most one entry per key. */
    idempotencyKey: text("idempotency_key"),
    createdAt: createdAt(),
  },
  (t) => [
    index("credit_ledger_workspace_idx").on(t.workspaceId),
    index("credit_ledger_project_idx").on(t.projectId),
    index("credit_ledger_pipeline_run_idx").on(t.pipelineRunId),
    index("credit_ledger_actor_idx").on(t.actorUserId),
    uniqueIndex("credit_ledger_idempotency_uq")
      .on(t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
  ],
);

/** MCP access keys (v1.1 feature — table ships now). */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    hashedKey: text("hashed_key").notNull().unique(),
    scopes: text("scopes").array().notNull().default([]),
    channelIds: uuid("channel_ids").array().notNull().default([]),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("api_keys_workspace_idx").on(t.workspaceId)],
);
