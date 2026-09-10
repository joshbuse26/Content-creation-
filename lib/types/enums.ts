import { z } from "zod";

/**
 * Shared enums — FROZEN LAYER.
 *
 * These arrays are the single source of truth for both the Zod schemas and
 * the Drizzle pgEnums (db/schema.ts imports them). Keep the two in sync by
 * never defining enum literals anywhere else.
 */

export const PLANS = ["free", "starter", "team", "agency"] as const;
export const planSchema = z.enum(PLANS);
export type Plan = z.infer<typeof planSchema>;

export const ROLES = ["owner", "admin", "writer", "viewer"] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

export const CHANNEL_MODES = ["oauth", "public"] as const;
export const channelModeSchema = z.enum(CHANNEL_MODES);
export type ChannelMode = z.infer<typeof channelModeSchema>;

export const SYNC_STATUSES = ["never", "queued", "syncing", "synced", "failed"] as const;
export const syncStatusSchema = z.enum(SYNC_STATUSES);
export type SyncStatus = z.infer<typeof syncStatusSchema>;

export const SOPHISTICATION_LEVELS = ["beginner", "intermediate", "advanced", "expert"] as const;
export const sophisticationSchema = z.enum(SOPHISTICATION_LEVELS);
export type Sophistication = z.infer<typeof sophisticationSchema>;

/**
 * "archetype" added in wave C (C0, approved): style cards derived from a
 * seeded archetype share one StyleCard shape with channel-learned cards —
 * `source` is what distinguishes them (PRODUCT-CONTRACTS §1).
 */
export const VOICE_SOURCES = ["own_channel", "samples", "licensed", "archetype"] as const;
export const voiceSourceSchema = z.enum(VOICE_SOURCES);
export type VoiceSource = z.infer<typeof voiceSourceSchema>;

/** Script generation modes (PRODUCT-CONTRACTS §3). Feature-gating:
 *  partnered_named is rejected server-side unless FEATURE_PARTNERED_NAMED is
 *  on (server/modes.ts); train_on_my_channel is enum-only in this wave. */
export const GENERATION_MODES = [
  "archetype",
  "crossover",
  "partnered_named",
  "train_on_my_channel",
] as const;
export const generationModeSchema = z.enum(GENERATION_MODES);
export type GenerationMode = z.infer<typeof generationModeSchema>;

/**
 * The 12 seeded archetype ids — FROZEN slugs (PRODUCT-CONTRACTS §2).
 * Archetype ids are these slugs, not UUIDs; the archetypes table's pk is
 * text. Never add a real creator's name here.
 */
export const ARCHETYPE_IDS = [
  "high-stakes-challenge",
  "calm-explainer",
  "data-storyteller",
  "investigative-narrator",
  "rapid-listicle",
  "contrarian-essayist",
  "hands-on-builder",
  "friendly-coach",
  "deadpan-comedian",
  "hype-gamer",
  "cozy-vlogger",
  "story-time-confessional",
] as const;
export const archetypeIdSchema = z.enum(ARCHETYPE_IDS);
export type ArchetypeId = z.infer<typeof archetypeIdSchema>;

/** StyleCard.ctaHabits.placement rule (PRODUCT-CONTRACTS §1):
 *  timestamp_pct = at ~placementPct% of runtime; after_payoff = directly
 *  after a chapter's payoff; end_only = only after the last chapter. */
export const CTA_PLACEMENTS = ["timestamp_pct", "after_payoff", "end_only"] as const;
export const ctaPlacementSchema = z.enum(CTA_PLACEMENTS);
export type CtaPlacement = z.infer<typeof ctaPlacementSchema>;

/**
 * Machine-checkable claim types for StyleCard.bannedClaims — each maps to a
 * conservative pattern set in lib/style-gates.ts (checked by code, not
 * vibes; PRODUCT-CONTRACTS §1/§6).
 */
export const BANNED_CLAIM_TYPES = [
  "guaranteed_results",
  "medical_claims",
  "financial_promises",
  "absolute_superlatives",
  "fear_mongering",
] as const;
export const bannedClaimTypeSchema = z.enum(BANNED_CLAIM_TYPES);
export type BannedClaimType = z.infer<typeof bannedClaimTypeSchema>;

// Thumbnail preset vocabulary (PRODUCT-CONTRACTS §5) — abstract pattern
// rules only; presets live in jsonb, so these are Zod-only enums (no pgEnum).
export const CONTRAST_RULES = ["light_on_dark", "dark_on_light", "complementary"] as const;
export const contrastRuleSchema = z.enum(CONTRAST_RULES);
export type ContrastRule = z.infer<typeof contrastRuleSchema>;

export const FACE_REQUIREMENTS = ["required", "optional", "none"] as const;
export const faceRequirementSchema = z.enum(FACE_REQUIREMENTS);
export type FaceRequirement = z.infer<typeof faceRequirementSchema>;

export const PALETTE_TEMPERATURES = ["warm", "cool", "neutral"] as const;
export const paletteTemperatureSchema = z.enum(PALETTE_TEMPERATURES);
export type PaletteTemperature = z.infer<typeof paletteTemperatureSchema>;

export const IDEA_STATUSES = ["new", "saved", "dismissed", "promoted"] as const;
export const ideaStatusSchema = z.enum(IDEA_STATUSES);
export type IdeaStatus = z.infer<typeof ideaStatusSchema>;

export const PROJECT_STATUSES = [
  "idea",
  "researching",
  "framing",
  "scripting",
  "revising",
  "packaging",
  "scheduled",
  "published",
] as const;
export const projectStatusSchema = z.enum(PROJECT_STATUSES);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

export const RESEARCH_KINDS = ["web", "transcript", "upload"] as const;
export const researchKindSchema = z.enum(RESEARCH_KINDS);
export type ResearchKind = z.infer<typeof researchKindSchema>;

export const FRAME_FORMATS = [
  "listicle",
  "essay",
  "tutorial",
  "challenge",
  "doc",
  "reaction",
  "other",
] as const;
export const frameFormatSchema = z.enum(FRAME_FORMATS);
export type FrameFormat = z.infer<typeof frameFormatSchema>;

export const FRAME_OUTCOMES = ["subs", "watch_time", "conversion"] as const;
export const frameOutcomeSchema = z.enum(FRAME_OUTCOMES);
export type FrameOutcome = z.infer<typeof frameOutcomeSchema>;

export const SCRIPT_STATUSES = ["outlining", "drafting", "revising", "final"] as const;
export const scriptStatusSchema = z.enum(SCRIPT_STATUSES);
export type ScriptStatus = z.infer<typeof scriptStatusSchema>;

export const SECTION_KINDS = ["hook", "intro", "chapter", "cta", "outro"] as const;
export const sectionKindSchema = z.enum(SECTION_KINDS);
export type SectionKind = z.infer<typeof sectionKindSchema>;

export const REVISION_STATUSES = ["pending", "accepted", "rejected"] as const;
export const revisionStatusSchema = z.enum(REVISION_STATUSES);
export type RevisionStatus = z.infer<typeof revisionStatusSchema>;

export const THUMBNAIL_STATUSES = ["candidate", "chosen"] as const;
export const thumbnailStatusSchema = z.enum(THUMBNAIL_STATUSES);
export type ThumbnailStatus = z.infer<typeof thumbnailStatusSchema>;

export const DESCRIPTION_MODES = ["informative", "narrative", "seo"] as const;
export const descriptionModeSchema = z.enum(DESCRIPTION_MODES);
export type DescriptionMode = z.infer<typeof descriptionModeSchema>;

export const PIPELINE_KINDS = [
  "script",
  "ideas",
  "avatar",
  "revision",
  "thumbnail",
  "sync",
] as const;
export const pipelineKindSchema = z.enum(PIPELINE_KINDS);
export type PipelineKind = z.infer<typeof pipelineKindSchema>;

export const PIPELINE_RUN_STATUSES = ["queued", "running", "failed", "done"] as const;
export const pipelineRunStatusSchema = z.enum(PIPELINE_RUN_STATUSES);
export type PipelineRunStatus = z.infer<typeof pipelineRunStatusSchema>;

export const CREDIT_REASONS = [
  "script_generation",
  "revision_pass",
  "idea_batch",
  "titles",
  "thumbnail",
  "research_run",
  "avatar_regen",
  "purchase",
  "overage",
  "plan_grant",
  "refund",
  "adjustment",
  "monthly_reset",
] as const;
export const creditReasonSchema = z.enum(CREDIT_REASONS);
export type CreditReason = z.infer<typeof creditReasonSchema>;

export const HOOK_STYLES = ["open_loop", "bold_claim", "stakes", "in_medias_res"] as const;
export const hookStyleSchema = z.enum(HOOK_STYLES);
export type HookStyle = z.infer<typeof hookStyleSchema>;

export const EXPORT_FORMATS = ["txt", "md", "docx", "teleprompter"] as const;
export const exportFormatSchema = z.enum(EXPORT_FORMATS);
export type ExportFormat = z.infer<typeof exportFormatSchema>;
