import { z } from "zod";
import {
  apiKeyIdSchema,
  audienceAvatarIdSchema,
  channelIdSchema,
  channelStatsSnapshotIdSchema,
  chapterSetIdSchema,
  creditLedgerEntryIdSchema,
  descriptionIdSchema,
  descriptionTemplateIdSchema,
  frameIdSchema,
  ideaIdSchema,
  membershipIdSchema,
  nicheVideoIdSchema,
  partnerIdSchema,
  pipelineRunIdSchema,
  projectIdSchema,
  researchDocIdSchema,
  revisionIdSchema,
  scriptIdSchema,
  scriptSectionIdSchema,
  tagSetIdSchema,
  thumbnailConceptIdSchema,
  titleSetIdSchema,
  userIdSchema,
  voiceProfileIdSchema,
  workspaceIdSchema,
} from "./ids";
import {
  archetypeIdSchema,
  bannedClaimTypeSchema,
  BANNED_CLAIM_TYPES,
  channelModeSchema,
  contrastRuleSchema,
  creditReasonSchema,
  ctaPlacementSchema,
  faceRequirementSchema,
  generationModeSchema,
  hookStyleSchema,
  paletteTemperatureSchema,
  descriptionModeSchema,
  frameFormatSchema,
  frameOutcomeSchema,
  ideaStatusSchema,
  pipelineKindSchema,
  pipelineRunStatusSchema,
  planSchema,
  projectStatusSchema,
  researchKindSchema,
  revisionStatusSchema,
  roleSchema,
  scriptStatusSchema,
  sectionKindSchema,
  sophisticationSchema,
  syncStatusSchema,
  thumbnailStatusSchema,
  voiceSourceSchema,
} from "./enums";

/**
 * Entity schemas — FROZEN LAYER.
 *
 * The API-facing shape of every entity (camelCase, branded IDs, ISO dates as
 * Date). These are what routers return and what fixtures satisfy. They mirror
 * db/schema.ts rows; sensitive columns (oauth_refresh_token, hashed_key) are
 * deliberately absent — they never leave the server.
 */

const timestamps = {
  createdAt: z.date(),
  updatedAt: z.date(),
};

export const workspaceSchema = z.object({
  id: workspaceIdSchema,
  name: z.string().min(1).max(120),
  plan: planSchema,
  creditBalance: z.number().int(),
  billingCycleAnchor: z.date().nullable(),
  ...timestamps,
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const userSchema = z.object({
  id: userIdSchema,
  email: z.email(),
  name: z.string().nullable(),
  image: z.url().nullable(),
  ...timestamps,
});
export type User = z.infer<typeof userSchema>;

export const membershipSchema = z.object({
  id: membershipIdSchema,
  workspaceId: workspaceIdSchema,
  userId: userIdSchema,
  role: roleSchema,
  ...timestamps,
});
export type Membership = z.infer<typeof membershipSchema>;

export const channelSchema = z.object({
  id: channelIdSchema,
  workspaceId: workspaceIdSchema,
  mode: channelModeSchema,
  youtubeChannelId: z.string().min(1),
  title: z.string().min(1),
  handle: z.string().nullable(),
  nicheKeywords: z.array(z.string()),
  syncStatus: syncStatusSchema,
  lastSyncedAt: z.date().nullable(),
  ...timestamps,
});
export type Channel = z.infer<typeof channelSchema>;

export const channelStatsSnapshotSchema = z.object({
  id: channelStatsSnapshotIdSchema,
  workspaceId: workspaceIdSchema,
  channelId: channelIdSchema,
  capturedAt: z.date(),
  subs: z.number().int().nonnegative(),
  totalViews: z.number().int().nonnegative(),
  medianViews90d: z.number().int().nonnegative(),
});
export type ChannelStatsSnapshot = z.infer<typeof channelStatsSnapshotSchema>;

export const avatarPainSchema = z.object({ pain: z.string(), evidence: z.string() });
export const avatarMotivationSchema = z.object({ motivation: z.string(), evidence: z.string() });

export const audienceAvatarSchema = z.object({
  id: audienceAvatarIdSchema,
  workspaceId: workspaceIdSchema,
  channelId: channelIdSchema,
  ageRange: z.string().nullable(),
  genderSplit: z.string().nullable(),
  geo: z.array(z.string()),
  sophistication: sophisticationSchema.nullable(),
  pains: z.array(avatarPainSchema),
  motivations: z.array(avatarMotivationSchema),
  vocabularyNotes: z.string().nullable(),
  editableByUser: z.boolean(),
  aiGeneratedAt: z.date().nullable(),
  lastEditedBy: userIdSchema.nullable(),
  ...timestamps,
});
export type AudienceAvatar = z.infer<typeof audienceAvatarSchema>;

// ---------------------------------------------------------------------------
// StyleCard v2 — first-class structured model (PRODUCT-CONTRACTS §1).
// One shape for archetype cards and channel-learned cards; the owning
// voice_profiles.source (or the archetype row) distinguishes provenance.
// Legacy {rhythm, register, catchphrases, humor, pov, taboos} cards are
// upgraded by migration 0005 (SQL) and lib/style-card.ts (in-memory).
// ---------------------------------------------------------------------------

/** POV, diction register, sentence rhythm — short text fields, not prose soup. */
export const styleVoiceSchema = z.object({
  pov: z.string().max(300),
  diction: z.string().max(300),
  rhythm: z.string().max(300),
});
export type StyleVoice = z.infer<typeof styleVoiceSchema>;

/** Emotional register + what this style is never (both short text). */
export const styleToneSchema = z.object({
  register: z.string().max(300),
  never: z.string().max(300),
});
export type StyleTone = z.infer<typeof styleToneSchema>;

export const stylePacingSchema = z.object({
  /** Words-per-minute speaking target (drives runtime estimation per card). */
  wpmTarget: z.number().int().min(80).max(240),
  /** Typical section length norm in seconds. */
  sectionSeconds: z.number().int().min(20).max(600),
  /** Re-hook cadence in seconds of estimated runtime. */
  rehookSeconds: z.number().int().min(20).max(240),
});
export type StylePacing = z.infer<typeof stylePacingSchema>;

/** One allowed hook technique (frozen enum) + per-pattern guidance. Order matters: first = preferred. */
export const styleHookPatternSchema = z.object({
  technique: hookStyleSchema,
  guidance: z.string().max(500),
});
export type StyleHookPattern = z.infer<typeof styleHookPatternSchema>;

export const styleCtaHabitsSchema = z
  .object({
    placement: ctaPlacementSchema,
    /** Percent of runtime (0–100) — required iff placement === "timestamp_pct". */
    placementPct: z.number().min(0).max(100).nullable(),
    phrasingStyle: z.string().max(300),
    maxPerVideo: z.number().int().min(0).max(5),
  })
  .refine((c) => c.placement !== "timestamp_pct" || c.placementPct !== null, {
    message: "placementPct is required when placement is timestamp_pct",
  });
export type StyleCtaHabits = z.infer<typeof styleCtaHabitsSchema>;

/** Target US grade band — replaces the global Flesch ≥ 60 gate per card (§6). */
export const styleReadingLevelSchema = z
  .object({
    minGrade: z.number().int().min(1).max(16),
    maxGrade: z.number().int().min(1).max(16),
  })
  .refine((r) => r.minGrade <= r.maxGrade, { message: "minGrade must be <= maxGrade" });
export type StyleReadingLevel = z.infer<typeof styleReadingLevelSchema>;

export const styleCardSchema = z.object({
  voice: styleVoiceSchema,
  tone: styleToneSchema,
  pacing: stylePacingSchema,
  /** At least one allowed technique; the hook gate checks membership. */
  hookPatterns: z.array(styleHookPatternSchema).min(1).max(4),
  ctaHabits: styleCtaHabitsSchema,
  /** Claim types this style must never make — machine-checked hard fail (§6). */
  bannedClaims: z.array(bannedClaimTypeSchema).max(BANNED_CLAIM_TYPES.length),
  readingLevel: styleReadingLevelSchema,
  /** 1 = hushed, 5 = maximum hype. */
  energy: z.number().int().min(1).max(5),
  /**
   * 2–4 short ORIGINAL sample passages on finished cards. `TODO(seed-copy)`
   * placeholders (and empty arrays on migrated/learned cards) are permitted
   * until Josh's content pipeline supplies seed copy — NEVER a real
   * creator's words.
   */
  exampleSnippets: z.array(z.string().max(600)).max(4),
  /** Thumbnail preset keyed to the same archetype (= archetype id for archetype cards); null for cards without one yet. */
  thumbnailPresetId: z.string().min(1).nullable(),
});
export type StyleCard = z.infer<typeof styleCardSchema>;

// ---------------------------------------------------------------------------
// Thumbnail presets (PRODUCT-CONTRACTS §5) — abstract pattern rules only.
// ---------------------------------------------------------------------------

export const thumbnailPresetSchema = z.object({
  /** Preset id — equals the owning archetype id for seeded presets. */
  id: z.string().min(1).max(60),
  /** Composition rule id from the existing 20-pattern library (pipelines/thumbnails/patterns.ts). */
  compositionPatternId: z.string().min(1).max(60),
  maxOverlayWords: z.number().int().min(0).max(8),
  contrastRule: contrastRuleSchema,
  face: faceRequirementSchema,
  paletteTemperature: paletteTemperatureSchema,
});
export type ThumbnailPreset = z.infer<typeof thumbnailPresetSchema>;

// ---------------------------------------------------------------------------
// Archetypes (PRODUCT-CONTRACTS §2) — seeded, never an empty DB.
// ---------------------------------------------------------------------------

export const archetypeSchema = z.object({
  /** One of the 12 frozen slugs. */
  id: archetypeIdSchema,
  displayName: z.string().min(1).max(80),
  /** One-line pitch — `TODO(seed-copy)` prefix until final marketing copy lands. */
  pitch: z.string().min(1).max(300),
  styleCard: styleCardSchema,
  thumbnailPreset: thumbnailPresetSchema,
  sort: z.number().int().nonnegative(),
  ...timestamps,
});
export type Archetype = z.infer<typeof archetypeSchema>;

// ---------------------------------------------------------------------------
// Partners (partnered_named mode — schema stub, feature flagged OFF).
// ---------------------------------------------------------------------------

/**
 * A named-creator partner record. partnered_named generation requires one of
 * these WITH signed license fields (same DB CHECK pattern as licensed
 * voices) AND the FEATURE_PARTNERED_NAMED flag on. Stub in wave C: no
 * routers create these yet.
 */
export const partnerSchema = z
  .object({
    id: partnerIdSchema,
    name: z.string().min(1).max(120),
    styleCard: styleCardSchema.nullable(),
    licenseDocUrl: z.url().nullable(),
    licenseSignedAt: z.date().nullable(),
    enabled: z.boolean(),
    ...timestamps,
  })
  .refine((p) => !p.enabled || (p.licenseDocUrl !== null && p.licenseSignedAt !== null), {
    message: "enabled partners require licenseDocUrl and licenseSignedAt",
  });
export type Partner = z.infer<typeof partnerSchema>;

// ---------------------------------------------------------------------------
// Generation modes (PRODUCT-CONTRACTS §3)
// ---------------------------------------------------------------------------

/** Crossover blend of two archetypes; weightB is implicitly 1 - weightA. */
export const crossoverBlendSchema = z
  .object({
    a: archetypeIdSchema,
    b: archetypeIdSchema,
    weightA: z.number().min(0).max(1),
  })
  .refine((c) => c.a !== c.b, { message: "crossover archetypes must differ" });
export type CrossoverBlend = z.infer<typeof crossoverBlendSchema>;

/**
 * Mode + mode-specific reference, carried by staged script procedures (and
 * the composite generate). Consumed by server/modes.ts guards: the schema
 * enforces shape consistency; the flag/availability checks are server-side.
 */
export const generationTargetSchema = z
  .object({
    mode: generationModeSchema,
    archetypeId: archetypeIdSchema.nullable().default(null),
    crossover: crossoverBlendSchema.nullable().default(null),
    partnerId: partnerIdSchema.nullable().default(null),
    voiceProfileId: voiceProfileIdSchema.nullable().default(null),
  })
  .superRefine((g, ctx) => {
    if (g.mode === "archetype" && g.archetypeId === null) {
      ctx.addIssue({ code: "custom", message: "archetype mode requires archetypeId" });
    }
    if (g.mode === "crossover" && g.crossover === null) {
      ctx.addIssue({ code: "custom", message: "crossover mode requires crossover weights" });
    }
    if (g.mode === "partnered_named" && g.partnerId === null) {
      ctx.addIssue({ code: "custom", message: "partnered_named mode requires partnerId" });
    }
    if (g.mode === "train_on_my_channel" && g.voiceProfileId === null) {
      ctx.addIssue({ code: "custom", message: "train_on_my_channel mode requires voiceProfileId" });
    }
  });
export type GenerationTarget = z.infer<typeof generationTargetSchema>;

export const voiceProfileSchema = z
  .object({
    id: voiceProfileIdSchema,
    workspaceId: workspaceIdSchema,
    channelId: channelIdSchema,
    name: z.string().min(1),
    source: voiceSourceSchema,
    styleCard: styleCardSchema,
    licenseDocUrl: z.url().nullable(),
    licenseSignedAt: z.date().nullable(),
    ...timestamps,
  })
  .refine(
    (v) => v.source !== "licensed" || (v.licenseDocUrl !== null && v.licenseSignedAt !== null),
    {
      message: "licensed voices require licenseDocUrl and licenseSignedAt",
    },
  );
export type VoiceProfile = z.infer<typeof voiceProfileSchema>;

export const nicheVideoSchema = z.object({
  id: nicheVideoIdSchema,
  youtubeVideoId: z.string().min(1),
  channelYtid: z.string().min(1),
  title: z.string(),
  thumbnailUrl: z.url().nullable(),
  publishedAt: z.date(),
  viewCount: z.number().int().nonnegative(),
  channelMedianViews: z.number().int().nonnegative(),
  outlierRatio: z.number().nonnegative(),
  formatTags: z.array(z.string()),
  nicheKeywords: z.array(z.string()),
  lastRefreshedAt: z.date(),
});
export type NicheVideo = z.infer<typeof nicheVideoSchema>;

export const ideaSchema = z.object({
  id: ideaIdSchema,
  workspaceId: workspaceIdSchema,
  channelId: channelIdSchema,
  title: z.string().min(1),
  angle: z.string(),
  rationale: z.string(),
  evidenceVideoIds: z.array(z.string()),
  score: z.number().min(0).max(100),
  status: ideaStatusSchema,
  generatedOn: z.iso.date(),
  ...timestamps,
});
export type Idea = z.infer<typeof ideaSchema>;

export const projectSchema = z.object({
  id: projectIdSchema,
  workspaceId: workspaceIdSchema,
  channelId: channelIdSchema,
  title: z.string().min(1).max(200),
  status: projectStatusSchema,
  ideaId: ideaIdSchema.nullable(),
  targetPublishDate: z.iso.date().nullable(),
  publishedVideoId: z.string().nullable(),
  /** Wave-C mode fields (PRODUCT-CONTRACTS §3). null = legacy/voice-profile flow. */
  generationMode: generationModeSchema.nullable().default(null),
  archetypeId: archetypeIdSchema.nullable().default(null),
  crossover: crossoverBlendSchema.nullable().default(null),
  partnerId: partnerIdSchema.nullable().default(null),
  ...timestamps,
});
export type Project = z.infer<typeof projectSchema>;

export const researchDocSchema = z.object({
  id: researchDocIdSchema,
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
  kind: researchKindSchema,
  sourceUrl: z.url().nullable(),
  title: z.string(),
  content: z.string().max(200_000),
  wordCount: z.number().int().nonnegative(),
  fetchedAt: z.date(),
  ...timestamps,
});
export type ResearchDoc = z.infer<typeof researchDocSchema>;

export const frameSchema = z.object({
  id: frameIdSchema,
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
  chosen: z.boolean(),
  angle: z.string(),
  format: frameFormatSchema,
  outcome: frameOutcomeSchema,
  audienceSegment: z.string(),
  tone: z.string(),
  targetMinutes: z.number().int().positive().max(120),
  keywords: z.array(z.string()),
  ...timestamps,
});
export type Frame = z.infer<typeof frameSchema>;

export const scriptStatsSchema = z.object({
  words: z.number().int().nonnegative(),
  estRuntimeS: z.number().int().nonnegative(),
  readability: z.number(),
});
export type ScriptStats = z.infer<typeof scriptStatsSchema>;

export const scriptSchema = z.object({
  id: scriptIdSchema,
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
  version: z.number().int().positive(),
  voiceProfileId: voiceProfileIdSchema.nullable(),
  status: scriptStatusSchema,
  stats: scriptStatsSchema,
  /** Wave-C mode fields (PRODUCT-CONTRACTS §3). null = legacy/voice-profile flow. */
  generationMode: generationModeSchema.nullable().default(null),
  archetypeId: archetypeIdSchema.nullable().default(null),
  crossover: crossoverBlendSchema.nullable().default(null),
  partnerId: partnerIdSchema.nullable().default(null),
  ...timestamps,
});
export type Script = z.infer<typeof scriptSchema>;

export const factRefSchema = z.object({
  claim: z.string(),
  researchDocId: researchDocIdSchema.nullable(),
});
export type FactRef = z.infer<typeof factRefSchema>;

export const scriptSectionSchema = z.object({
  id: scriptSectionIdSchema,
  workspaceId: workspaceIdSchema,
  scriptId: scriptIdSchema,
  position: z.number().int().nonnegative(),
  kind: sectionKindSchema,
  heading: z.string(),
  body: z.string(),
  voiceProfileId: voiceProfileIdSchema.nullable(),
  locked: z.boolean(),
  estSeconds: z.number().int().nonnegative(),
  retentionNote: z.string().nullable(),
  factRefs: z.array(factRefSchema),
  ...timestamps,
});
export type ScriptSection = z.infer<typeof scriptSectionSchema>;

export const diffOpSchema = z.object({
  lineStart: z.number().int().nonnegative(),
  lineEnd: z.number().int().nonnegative(),
  replacement: z.string(),
});
export type DiffOp = z.infer<typeof diffOpSchema>;

export const revisionSchema = z.object({
  id: revisionIdSchema,
  workspaceId: workspaceIdSchema,
  scriptId: scriptIdSchema,
  sectionId: scriptSectionIdSchema,
  suggestion: z.string(),
  diff: z.array(diffOpSchema),
  status: revisionStatusSchema,
  rationale: z.string(),
  ...timestamps,
});
export type Revision = z.infer<typeof revisionSchema>;

export const titleOptionSchema = z.object({
  text: z.string().min(1).max(120),
  patternFamily: z.string(),
  score: z.number().min(0).max(100),
});
export type TitleOption = z.infer<typeof titleOptionSchema>;

export const titleSetSchema = z.object({
  id: titleSetIdSchema,
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
  options: z.array(titleOptionSchema),
  ...timestamps,
});
export type TitleSet = z.infer<typeof titleSetSchema>;

export const thumbnailConceptSchema = z.object({
  id: thumbnailConceptIdSchema,
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
  promptUsed: z.string(),
  compositionPattern: z.string(),
  imageKey: z.string().nullable(),
  status: thumbnailStatusSchema,
  ...timestamps,
});
export type ThumbnailConcept = z.infer<typeof thumbnailConceptSchema>;

export const descriptionSchema = z.object({
  id: descriptionIdSchema,
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
  mode: descriptionModeSchema,
  body: z.string(),
  templateId: descriptionTemplateIdSchema.nullable(),
  ...timestamps,
});
export type Description = z.infer<typeof descriptionSchema>;

export const descriptionTemplateSchema = z.object({
  id: descriptionTemplateIdSchema,
  workspaceId: workspaceIdSchema,
  name: z.string().min(1).max(120),
  body: z.string(),
  ...timestamps,
});
export type DescriptionTemplate = z.infer<typeof descriptionTemplateSchema>;

export const tagSetSchema = z.object({
  id: tagSetIdSchema,
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
  tags: z.array(z.string().min(1).max(60)).max(30),
  ...timestamps,
});
export type TagSet = z.infer<typeof tagSetSchema>;

export const chapterEntrySchema = z.object({
  tsSeconds: z.number().int().nonnegative(),
  label: z.string().min(1).max(120),
});
export type ChapterEntry = z.infer<typeof chapterEntrySchema>;

export const chapterSetSchema = z.object({
  id: chapterSetIdSchema,
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
  entries: z.array(chapterEntrySchema),
  ...timestamps,
});
export type ChapterSet = z.infer<typeof chapterSetSchema>;

export const pipelineRunSchema = z.object({
  id: pipelineRunIdSchema,
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema.nullable(),
  kind: pipelineKindSchema,
  stage: z.string(),
  status: pipelineRunStatusSchema,
  attempt: z.number().int().nonnegative(),
  inputHash: z.string(),
  error: z.string().nullable(),
  creditsCharged: z.number().int().nonnegative(),
  startedAt: z.date().nullable(),
  finishedAt: z.date().nullable(),
  ...timestamps,
});
export type PipelineRun = z.infer<typeof pipelineRunSchema>;

export const creditLedgerEntrySchema = z.object({
  id: creditLedgerEntryIdSchema,
  workspaceId: workspaceIdSchema,
  delta: z.number().int(),
  reason: creditReasonSchema,
  actorUserId: userIdSchema.nullable(),
  projectId: projectIdSchema.nullable(),
  pipelineRunId: pipelineRunIdSchema.nullable(),
  createdAt: z.date(),
});
export type CreditLedgerEntry = z.infer<typeof creditLedgerEntrySchema>;

/** API keys as returned to clients — the secret is shown once at creation only. */
export const apiKeySchema = z.object({
  id: apiKeyIdSchema,
  workspaceId: workspaceIdSchema,
  scopes: z.array(z.string()),
  channelIds: z.array(channelIdSchema),
  lastUsedAt: z.date().nullable(),
  revokedAt: z.date().nullable(),
  createdAt: z.date(),
});
export type ApiKey = z.infer<typeof apiKeySchema>;
