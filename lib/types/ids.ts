import { z } from "zod";

/**
 * Branded ID types — FROZEN LAYER.
 *
 * Every entity ID is a UUID string carrying a compile-time brand so that a
 * ProjectId cannot be passed where a ChannelId is expected. Parse untrusted
 * strings with the matching schema; construct in code with the `as*Id`
 * helpers (which validate at runtime).
 */

const uuid = () => z.uuid();

export const workspaceIdSchema = uuid().brand<"WorkspaceId">();
export const userIdSchema = uuid().brand<"UserId">();
export const membershipIdSchema = uuid().brand<"MembershipId">();
export const channelIdSchema = uuid().brand<"ChannelId">();
export const channelStatsSnapshotIdSchema = uuid().brand<"ChannelStatsSnapshotId">();
export const audienceAvatarIdSchema = uuid().brand<"AudienceAvatarId">();
export const voiceProfileIdSchema = uuid().brand<"VoiceProfileId">();
export const nicheVideoIdSchema = uuid().brand<"NicheVideoId">();
export const ideaIdSchema = uuid().brand<"IdeaId">();
export const projectIdSchema = uuid().brand<"ProjectId">();
export const researchDocIdSchema = uuid().brand<"ResearchDocId">();
export const frameIdSchema = uuid().brand<"FrameId">();
export const scriptIdSchema = uuid().brand<"ScriptId">();
export const scriptSectionIdSchema = uuid().brand<"ScriptSectionId">();
export const revisionIdSchema = uuid().brand<"RevisionId">();
export const titleSetIdSchema = uuid().brand<"TitleSetId">();
export const thumbnailConceptIdSchema = uuid().brand<"ThumbnailConceptId">();
export const descriptionIdSchema = uuid().brand<"DescriptionId">();
export const descriptionTemplateIdSchema = uuid().brand<"DescriptionTemplateId">();
export const tagSetIdSchema = uuid().brand<"TagSetId">();
export const chapterSetIdSchema = uuid().brand<"ChapterSetId">();
export const partnerIdSchema = uuid().brand<"PartnerId">();
export const pipelineRunIdSchema = uuid().brand<"PipelineRunId">();
export const creditLedgerEntryIdSchema = uuid().brand<"CreditLedgerEntryId">();
export const apiKeyIdSchema = uuid().brand<"ApiKeyId">();
// Wave D (D0, WAVE-D-PLAN §2a) — chat-first surface.
export const chatThreadIdSchema = uuid().brand<"ChatThreadId">();
export const chatMessageIdSchema = uuid().brand<"ChatMessageId">();
// Wave E (E4) — section comments + reusable content packs.
export const sectionCommentIdSchema = uuid().brand<"SectionCommentId">();
export const contentTemplateIdSchema = uuid().brand<"ContentTemplateId">();

export type WorkspaceId = z.infer<typeof workspaceIdSchema>;
export type UserId = z.infer<typeof userIdSchema>;
export type MembershipId = z.infer<typeof membershipIdSchema>;
export type ChannelId = z.infer<typeof channelIdSchema>;
export type ChannelStatsSnapshotId = z.infer<typeof channelStatsSnapshotIdSchema>;
export type AudienceAvatarId = z.infer<typeof audienceAvatarIdSchema>;
export type VoiceProfileId = z.infer<typeof voiceProfileIdSchema>;
export type NicheVideoId = z.infer<typeof nicheVideoIdSchema>;
export type IdeaId = z.infer<typeof ideaIdSchema>;
export type ProjectId = z.infer<typeof projectIdSchema>;
export type ResearchDocId = z.infer<typeof researchDocIdSchema>;
export type FrameId = z.infer<typeof frameIdSchema>;
export type ScriptId = z.infer<typeof scriptIdSchema>;
export type ScriptSectionId = z.infer<typeof scriptSectionIdSchema>;
export type RevisionId = z.infer<typeof revisionIdSchema>;
export type TitleSetId = z.infer<typeof titleSetIdSchema>;
export type ThumbnailConceptId = z.infer<typeof thumbnailConceptIdSchema>;
export type DescriptionId = z.infer<typeof descriptionIdSchema>;
export type DescriptionTemplateId = z.infer<typeof descriptionTemplateIdSchema>;
export type TagSetId = z.infer<typeof tagSetIdSchema>;
export type ChapterSetId = z.infer<typeof chapterSetIdSchema>;
export type PartnerId = z.infer<typeof partnerIdSchema>;
export type PipelineRunId = z.infer<typeof pipelineRunIdSchema>;
export type CreditLedgerEntryId = z.infer<typeof creditLedgerEntryIdSchema>;
export type ApiKeyId = z.infer<typeof apiKeyIdSchema>;
export type ChatThreadId = z.infer<typeof chatThreadIdSchema>;
export type ChatMessageId = z.infer<typeof chatMessageIdSchema>;
export type SectionCommentId = z.infer<typeof sectionCommentIdSchema>;
export type ContentTemplateId = z.infer<typeof contentTemplateIdSchema>;

export const asWorkspaceId = (v: string): WorkspaceId => workspaceIdSchema.parse(v);
export const asUserId = (v: string): UserId => userIdSchema.parse(v);
export const asChannelId = (v: string): ChannelId => channelIdSchema.parse(v);
export const asProjectId = (v: string): ProjectId => projectIdSchema.parse(v);
export const asScriptId = (v: string): ScriptId => scriptIdSchema.parse(v);
export const asPipelineRunId = (v: string): PipelineRunId => pipelineRunIdSchema.parse(v);
export const asChatThreadId = (v: string): ChatThreadId => chatThreadIdSchema.parse(v);
export const asChatMessageId = (v: string): ChatMessageId => chatMessageIdSchema.parse(v);
export const asSectionCommentId = (v: string): SectionCommentId => sectionCommentIdSchema.parse(v);
export const asContentTemplateId = (v: string): ContentTemplateId =>
  contentTemplateIdSchema.parse(v);
