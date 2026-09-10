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
  channelModeSchema,
  creditReasonSchema,
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

export const styleCardSchema = z.object({
  rhythm: z.string(),
  register: z.string(),
  catchphrases: z.array(z.string()),
  humor: z.string(),
  pov: z.string(),
  taboos: z.array(z.string()),
});
export type StyleCard = z.infer<typeof styleCardSchema>;

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
  .refine((v) => v.source !== "licensed" || (v.licenseDocUrl !== null && v.licenseSignedAt !== null), {
    message: "licensed voices require licenseDocUrl and licenseSignedAt",
  });
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
