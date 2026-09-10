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

export const VOICE_SOURCES = ["own_channel", "samples", "licensed"] as const;
export const voiceSourceSchema = z.enum(VOICE_SOURCES);
export type VoiceSource = z.infer<typeof voiceSourceSchema>;

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

export const PIPELINE_KINDS = ["script", "ideas", "avatar", "revision", "thumbnail"] as const;
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
