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
import type { CrossoverBlend, StyleCard, ThumbnailPreset } from "@/lib/types/entities";
import type { ContentPackPayload } from "@/lib/types/pipeline";
import {
  CHANNEL_MODES,
  CHAT_ROLES,
  CONTENT_PACK_KINDS,
  CREDIT_REASONS,
  DESCRIPTION_MODES,
  GENERATION_MODES,
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
export const generationModeEnum = pgEnum("generation_mode", GENERATION_MODES);
export const chatRoleEnum = pgEnum("chat_role", CHAT_ROLES);
export const contentPackKindEnum = pgEnum("content_pack_kind", CONTENT_PACK_KINDS);

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
    // -- B3 billing columns (approved narrow frozen-layer change: nullable
    //    columns on workspaces only — approved narrow class, v1.1) ---------
    /** Active Stripe subscription backing the paid plan. */
    stripeSubscriptionId: text("stripe_subscription_id"),
    /** End of the current billing period (from Stripe); cycle progress + downgrade boundary. */
    billingPeriodEnd: timestamp("billing_period_end", { withTimezone: true }),
    /** Plan to apply at the next period boundary (downgrades — spec §7). */
    pendingPlan: planEnum("pending_plan"),
    /** First failed payment of the current incident; null = healthy. Read-only after 7-day grace. */
    paymentFailedAt: timestamp("payment_failed_at", { withTimezone: true }),
    /** Overage credits metered to Stripe this cycle (reset on invoice.paid); null = 0. */
    overageUsed: integer("overage_used"),
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
    /** StyleCard v2 (PRODUCT-CONTRACTS §1) — structured shape in
     *  lib/types/entities.ts styleCardSchema. Legacy rows are transformed
     *  by migration 0005. */
    styleCard: jsonb("style_card").$type<StyleCard>().notNull(),
    licenseDocUrl: text("license_doc_url"),
    licenseSignedAt: timestamp("license_signed_at", { withTimezone: true }),
    // -- wave-D train_on_my_channel derivation (WAVE-D-PLAN §2c) ------------
    /** Channel a source="trained" card was derived from; null otherwise.
     *  No FK: the derivation may remix from competitor channel ytids not
     *  present as owned channels. Consent-gated derivation ships in D2. */
    trainedFromChannelId: uuid("trained_from_channel_id"),
    /** When the trained card was derived; null for non-trained sources. */
    trainedAt: timestamp("trained_at", { withTimezone: true }),
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
    // Trained voices must record the channel they were derived from
    // (consent + provenance). Mirrors the licensed-voice CHECK pattern.
    // The source is cast to text so the CHECK does not "use" the freshly
    // added 'trained' enum value inside the same migration transaction that
    // ALTER TYPE ... ADD VALUE it (Postgres rejects that); text comparison
    // is equivalent and transaction-safe.
    check(
      "voice_profiles_trained_provenance",
      sql`${t.source}::text <> 'trained' OR ${t.trainedFromChannelId} IS NOT NULL`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Archetypes & partners (wave C — PRODUCT-CONTRACTS §2/§3/§5)
// ---------------------------------------------------------------------------

/**
 * The 12 seeded generation archetypes — GLOBAL (not tenant-scoped), never an
 * empty table (scripts/seed.ts seeds all 12; fixture mode serves them from
 * lib/archetypes.ts). id is the frozen slug from ARCHETYPE_IDS, not a uuid.
 * Style cards + thumbnail presets are ORIGINAL generic craft — no real
 * creator's name, catchphrase, or wording, ever.
 */
export const archetypes = pgTable("archetypes", {
  /** Frozen slug (lib/types/enums.ts ARCHETYPE_IDS). */
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  pitch: text("pitch").notNull(),
  styleCard: jsonb("style_card").$type<StyleCard>().notNull(),
  thumbnailPreset: jsonb("thumbnail_preset").$type<ThumbnailPreset>().notNull(),
  sort: integer("sort").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Named-creator partners (partnered_named mode) — STUB, feature-flagged off
 * (FEATURE_PARTNERED_NAMED). Global like archetypes. Reuses the
 * licensed-voice constraint pattern: a partner can never be enabled without
 * both signed-license fields on file. No routers write this table in wave C.
 */
export const partners = pgTable(
  "partners",
  {
    id: id(),
    name: text("name").notNull(),
    styleCard: jsonb("style_card").$type<StyleCard>(),
    licenseDocUrl: text("license_doc_url"),
    licenseSignedAt: timestamp("license_signed_at", { withTimezone: true }),
    enabled: boolean("enabled").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Enabled partners require BOTH license fields non-null. No exceptions.
    check(
      "partners_license_required",
      sql`${t.enabled} = false OR (${t.licenseDocUrl} IS NOT NULL AND ${t.licenseSignedAt} IS NOT NULL)`,
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
    // -- wave-C mode columns (PRODUCT-CONTRACTS §3); null = legacy flow ----
    generationMode: generationModeEnum("generation_mode"),
    archetypeId: text("archetype_id").references(() => archetypes.id, { onDelete: "set null" }),
    /** {a, b, weightA} — weightB is 1 - weightA. Only for mode=crossover. */
    crossover: jsonb("crossover").$type<CrossoverBlend>(),
    partnerId: uuid("partner_id").references(() => partners.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("projects_workspace_idx").on(t.workspaceId),
    index("projects_channel_idx").on(t.channelId),
    index("projects_idea_idx").on(t.ideaId),
    index("projects_archetype_idx").on(t.archetypeId),
    index("projects_partner_idx").on(t.partnerId),
    check(
      "projects_mode_archetype_required",
      sql`${t.generationMode} IS DISTINCT FROM 'archetype' OR ${t.archetypeId} IS NOT NULL`,
    ),
    check(
      "projects_mode_crossover_required",
      sql`${t.generationMode} IS DISTINCT FROM 'crossover' OR ${t.crossover} IS NOT NULL`,
    ),
    check(
      "projects_mode_partner_required",
      sql`${t.generationMode} IS DISTINCT FROM 'partnered_named' OR ${t.partnerId} IS NOT NULL`,
    ),
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
    // -- wave-C mode columns (PRODUCT-CONTRACTS §3); null = legacy flow ----
    generationMode: generationModeEnum("generation_mode"),
    archetypeId: text("archetype_id").references(() => archetypes.id, { onDelete: "set null" }),
    /** {a, b, weightA} — weightB is 1 - weightA. Only for mode=crossover. */
    crossover: jsonb("crossover").$type<CrossoverBlend>(),
    partnerId: uuid("partner_id").references(() => partners.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("scripts_project_idx").on(t.projectId),
    index("scripts_workspace_idx").on(t.workspaceId),
    index("scripts_voice_profile_idx").on(t.voiceProfileId),
    uniqueIndex("scripts_project_version_uq").on(t.projectId, t.version),
    index("scripts_archetype_idx").on(t.archetypeId),
    index("scripts_partner_idx").on(t.partnerId),
    check(
      "scripts_mode_archetype_required",
      sql`${t.generationMode} IS DISTINCT FROM 'archetype' OR ${t.archetypeId} IS NOT NULL`,
    ),
    check(
      "scripts_mode_crossover_required",
      sql`${t.generationMode} IS DISTINCT FROM 'crossover' OR ${t.crossover} IS NOT NULL`,
    ),
    check(
      "scripts_mode_partner_required",
      sql`${t.generationMode} IS DISTINCT FROM 'partnered_named' OR ${t.partnerId} IS NOT NULL`,
    ),
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
    // -- Thumbnail whiteboard board columns (WAVE-D / E2) — ADDITIVE. Every
    //    column is nullable or defaulted, so existing rows and the one-shot
    //    `generate` path are unaffected (all writes through the existing
    //    insert leave these at their defaults). No FK on board_id: it only
    //    groups a batch of sibling rows, not a tenant relation.
    /** Groups a batch of concepts generated together; null for one-shot rows. */
    boardId: uuid("board_id"),
    /** User overlay text folded into the concept's image prompt. */
    overlayText: text("overlay_text"),
    /** Archetype/preset key this concept was generated under. */
    presetId: text("preset_id"),
    /** Subject slot: face | no_face | object (stored as text). */
    subjectMode: text("subject_mode"),
    /** Color mood label (see COLOR_MOODS; stored as text). */
    colorMood: text("color_mood"),
    favorited: boolean("favorited").notNull().default(false),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("thumbnail_concepts_project_idx").on(t.projectId),
    index("thumbnail_concepts_workspace_idx").on(t.workspaceId),
    index("thumbnail_concepts_board_idx").on(t.boardId),
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
    /** Stage output payload (wave-C adversarial F2): persisted on completion
     *  so an identical re-submit re-serves instead of recomputing on live
     *  LLM. Null for legacy rows and streamed (non-sync) stages. */
    output: jsonb("output").$type<unknown>(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("pipeline_runs_project_idx").on(t.projectId),
    index("pipeline_runs_workspace_idx").on(t.workspaceId),
    index("pipeline_runs_kind_stage_idx").on(t.kind, t.stage),
    // Atomic runner claim (wave-C adversarial F6): at most one ACTIVE stage
    // row per pipeline input — a concurrent identical dispatch loses the
    // insert race and surfaces as CONFLICT instead of executing twice.
    uniqueIndex("pipeline_runs_active_claim_idx")
      .on(t.kind, t.inputHash)
      .where(sql`${t.status} in ('queued', 'running')`),
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

/**
 * Processed Stripe webhook events (B3 — approved narrow frozen-layer change:
 * new table). The unique event id makes webhook handling idempotent: an
 * event whose id is already recorded is acknowledged without re-applying
 * side effects. Ledger writes are additionally keyed on the event id via
 * credit_ledger.idempotency_key as a second, independent guard.
 */
export const stripeEvents = pgTable(
  "stripe_events",
  {
    id: id(),
    /** Stripe event id (`evt_…`) — unique ⇒ at-most-once processing. */
    eventId: text("event_id").notNull().unique(),
    type: text("type").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("stripe_events_type_idx").on(t.type)],
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

// ---------------------------------------------------------------------------
// Chat (Wave D — WAVE-D-PLAN §2a). Chat-first surface. A thread is either
// project-scoped (project_id set) or a workspace-level coach (project_id
// null). Messages are ordered by (thread_id, seq); workspace_id is
// denormalized onto messages for row-level authz, same as every tenant row.
// ---------------------------------------------------------------------------

export const chatThreads = pgTable(
  "chat_threads",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** null = workspace-level "coach" thread (not scoped to one project). */
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("chat_threads_workspace_project_idx").on(t.workspaceId, t.projectId),
    index("chat_threads_project_idx").on(t.projectId),
  ],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: id(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => chatThreads.id, { onDelete: "cascade" }),
    /** Denormalized for row-level authz checks. */
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    role: chatRoleEnum("role").notNull(),
    content: text("content").notNull(),
    /** Tool calls proposed by an assistant message; null otherwise. */
    toolCalls: jsonb("tool_calls").$type<
      {
        toolCallId: string;
        name: string;
        args: Record<string, unknown>;
        estimatedCredits: number;
      }[]
    >(),
    /** Links a `tool` result message back to the proposing call; null otherwise. */
    toolCallId: text("tool_call_id"),
    /** Credits charged for this message's tool execution (chat itself is free). */
    creditsCharged: integer("credits_charged").notNull().default(0),
    /** Monotonic per-thread ordering key. */
    seq: integer("seq").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("chat_messages_workspace_idx").on(t.workspaceId),
    uniqueIndex("chat_messages_thread_seq_uq").on(t.threadId, t.seq),
  ],
);

// ---------------------------------------------------------------------------
// Team collaboration (Wave E — E4). Section comments are a light,
// poll/invalidate comment thread per script section (not realtime); reusable
// content packs capture a proven outline or hook set for reuse within a
// channel. Both are tenant rows: workspace_id denormalized for row-level
// authz, every read/write filtered on it.
// ---------------------------------------------------------------------------

export const sectionComments = pgTable(
  "section_comments",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    scriptId: uuid("script_id")
      .notNull()
      .references(() => scripts.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => scriptSections.id, { onDelete: "cascade" }),
    /** The member who wrote the comment; kept for the author-or-admin remove rule. */
    authorUserId: uuid("author_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    resolved: boolean("resolved").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("section_comments_section_idx").on(t.sectionId),
    index("section_comments_script_idx").on(t.scriptId),
    index("section_comments_workspace_idx").on(t.workspaceId),
  ],
);

/**
 * Reusable content packs (outline / hook_pack). Scoped per workspace,
 * taggable per channel (channel_id null = workspace-wide). payload jsonb holds
 * the saved outline structure or hook set (lib/types/pipeline.ts
 * contentPackPayloadSchema). Admin+ manage; any member reads; writer applies.
 */
export const contentTemplates = pgTable(
  "content_templates",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** null = workspace-wide pack (offered for every channel). */
    channelId: uuid("channel_id").references(() => channels.id, { onDelete: "cascade" }),
    kind: contentPackKindEnum("kind").notNull(),
    name: text("name").notNull(),
    payload: jsonb("payload").$type<ContentPackPayload>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("content_templates_workspace_idx").on(t.workspaceId),
    index("content_templates_channel_idx").on(t.channelId),
    index("content_templates_kind_idx").on(t.kind),
  ],
);
