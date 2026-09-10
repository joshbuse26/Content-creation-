import { z } from "zod";
import {
  channelIdSchema,
  frameIdSchema,
  projectIdSchema,
  researchDocIdSchema,
  scriptIdSchema,
  scriptSectionIdSchema,
  voiceProfileIdSchema,
  workspaceIdSchema,
} from "./ids";
import { frameFormatSchema, frameOutcomeSchema, hookStyleSchema, sectionKindSchema } from "./enums";
import {
  audienceAvatarSchema,
  avatarMotivationSchema,
  avatarPainSchema,
  diffOpSchema,
  factRefSchema,
  styleCardSchema,
  titleOptionSchema,
} from "./entities";

/**
 * Pipeline stage input/output contracts — FROZEN LAYER.
 *
 * Every BullMQ stage validates its input against these before running and
 * Zod-parses every LLM output against them before anything touches the DB or
 * the client (build spec §0, §5). Stage names are the canonical `stage`
 * values written to pipeline_runs.
 */

// ---------------------------------------------------------------------------
// §5.1 Channel sync
// ---------------------------------------------------------------------------

export const SYNC_STAGES = ["fetch_channel", "fetch_videos", "snapshot_stats"] as const;
export type SyncStage = (typeof SYNC_STAGES)[number];

export const syncJobInputSchema = z.object({
  workspaceId: workspaceIdSchema,
  channelId: channelIdSchema,
});
export type SyncJobInput = z.infer<typeof syncJobInputSchema>;

export const videoStatsSchema = z.object({
  youtubeVideoId: z.string(),
  title: z.string(),
  publishedAt: z.iso.datetime(),
  viewCount: z.number().int().nonnegative(),
  likeCount: z.number().int().nonnegative().nullable(),
  commentCount: z.number().int().nonnegative().nullable(),
  durationSeconds: z.number().int().nonnegative(),
});
export type VideoStats = z.infer<typeof videoStatsSchema>;

export const syncResultSchema = z.object({
  channelId: channelIdSchema,
  subs: z.number().int().nonnegative(),
  totalViews: z.number().int().nonnegative(),
  medianViews90d: z.number().int().nonnegative(),
  videos: z.array(videoStatsSchema),
});
export type SyncResult = z.infer<typeof syncResultSchema>;

// ---------------------------------------------------------------------------
// §5.2 Avatar generation
// ---------------------------------------------------------------------------

export const AVATAR_STAGES = ["assemble_avatar_context", "generate_avatar"] as const;
export type AvatarStage = (typeof AVATAR_STAGES)[number];

export const avatarJobInputSchema = z.object({
  workspaceId: workspaceIdSchema,
  channelId: channelIdSchema,
  /** true = overwrite user-edited fields too ("regenerate all"). */
  regenerateAll: z.boolean().default(false),
});
export type AvatarJobInput = z.infer<typeof avatarJobInputSchema>;

/** The LLM's structured avatar output — parsed before writing columns. */
export const generatedAvatarSchema = audienceAvatarSchema.pick({
  ageRange: true,
  genderSplit: true,
  geo: true,
  sophistication: true,
  vocabularyNotes: true,
}).extend({
  pains: z.array(avatarPainSchema).min(1).max(10),
  motivations: z.array(avatarMotivationSchema).min(1).max(10),
});
export type GeneratedAvatar = z.infer<typeof generatedAvatarSchema>;

// ---------------------------------------------------------------------------
// §5.3 Outlier index (v1.1)
// ---------------------------------------------------------------------------

export const OUTLIER_STAGES = ["search_niche", "fetch_stats", "tag_formats"] as const;
export type OutlierStage = (typeof OUTLIER_STAGES)[number];

export const outlierJobInputSchema = z.object({
  nicheKeywords: z.array(z.string().min(1)).min(1).max(6),
});
export type OutlierJobInput = z.infer<typeof outlierJobInputSchema>;

// ---------------------------------------------------------------------------
// §5.4 Daily ideas (v1.1)
// ---------------------------------------------------------------------------

export const IDEAS_STAGES = ["assemble_ideas_context", "generate_ideas", "dedup_ideas"] as const;
export type IdeasStage = (typeof IDEAS_STAGES)[number];

export const ideasJobInputSchema = z.object({
  workspaceId: workspaceIdSchema,
  channelId: channelIdSchema,
});
export type IdeasJobInput = z.infer<typeof ideasJobInputSchema>;

export const generatedIdeaSchema = z.object({
  title: z.string().min(1).max(120),
  angle: z.string(),
  rationale: z.string(),
  evidenceVideoIds: z.array(z.string()).max(10),
  score: z.number().min(0).max(100),
});
export const generatedIdeasSchema = z.array(generatedIdeaSchema).length(5);
export type GeneratedIdea = z.infer<typeof generatedIdeaSchema>;

// ---------------------------------------------------------------------------
// §5.5 Research agent
// ---------------------------------------------------------------------------

export const RESEARCH_STAGES = ["plan_queries", "fetch_sources", "compile_brief"] as const;
export type ResearchStage = (typeof RESEARCH_STAGES)[number];

export const researchJobInputSchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
  query: z.string().min(3).max(500),
});
export type ResearchJobInput = z.infer<typeof researchJobInputSchema>;

export const plannedQueriesSchema = z.object({
  queries: z.array(z.string().min(1)).min(1).max(8),
});
export type PlannedQueries = z.infer<typeof plannedQueriesSchema>;

export const fetchedSourceSchema = z.object({
  url: z.url(),
  title: z.string(),
  /** Stripped to text server-side; 500KB fetch cap upstream. */
  text: z.string(),
});
export type FetchedSource = z.infer<typeof fetchedSourceSchema>;

export const researchBriefSchema = z.object({
  title: z.string(),
  /** Markdown brief; every factual claim carries a source URL inline. */
  content: z.string().max(200_000),
  facts: z.array(
    z.object({
      claim: z.string(),
      sourceUrl: z.url(),
    }),
  ),
});
export type ResearchBrief = z.infer<typeof researchBriefSchema>;

// ---------------------------------------------------------------------------
// §5.6 Frame proposals
// ---------------------------------------------------------------------------

export const FRAME_STAGES = ["propose_frames"] as const;
export type FrameStage = (typeof FRAME_STAGES)[number];

export const frameJobInputSchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
});
export type FrameJobInput = z.infer<typeof frameJobInputSchema>;

export const proposedFrameSchema = z.object({
  angle: z.string(),
  format: frameFormatSchema,
  outcome: frameOutcomeSchema,
  audienceSegment: z.string(),
  tone: z.string(),
  targetMinutes: z.number().int().positive().max(120),
  keywords: z.array(z.string()).max(12),
});
export const proposedFramesSchema = z.array(proposedFrameSchema).length(4);
export type ProposedFrame = z.infer<typeof proposedFrameSchema>;

// ---------------------------------------------------------------------------
// §5.7 Script agent — the core seven stages
// ---------------------------------------------------------------------------

export const SCRIPT_STAGES = [
  "assemble_context",
  "outline",
  "draft_sections",
  "retention_pass",
  "voice_pass",
  "fact_check",
  "quality_gate",
] as const;
export type ScriptStage = (typeof SCRIPT_STAGES)[number];

export const scriptJobInputSchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
  frameId: frameIdSchema,
  voiceProfileId: voiceProfileIdSchema.nullable(),
});
export type ScriptJobInput = z.infer<typeof scriptJobInputSchema>;

/** Stage 1 output: everything downstream stages need, trimmed to budget. */
export const scriptContextSchema = z.object({
  frame: z.object({
    angle: z.string(),
    format: frameFormatSchema,
    outcome: frameOutcomeSchema,
    audienceSegment: z.string(),
    tone: z.string(),
    targetMinutes: z.number().int().positive(),
    keywords: z.array(z.string()),
  }),
  research: z.array(
    z.object({
      researchDocId: researchDocIdSchema,
      title: z.string(),
      excerpt: z.string(),
    }),
  ),
  avatarSummary: z.string(),
  styleCard: styleCardSchema.nullable(),
});
export type ScriptContext = z.infer<typeof scriptContextSchema>;

/** Stage 2 output: the outline. target_seconds must sum to target_minutes*60 (±10%). */
export const outlineSectionSchema = z.object({
  kind: sectionKindSchema,
  heading: z.string().min(1),
  purpose: z.string(),
  retentionNote: z.string(),
  targetSeconds: z.number().int().positive(),
});
export const outlineSchema = z.object({
  sections: z.array(outlineSectionSchema).min(3).max(30),
});
export type Outline = z.infer<typeof outlineSchema>;

/** Stage 3: hook candidates (3, auto-pick top, keep others visible) + drafted sections. */
export const hookCandidateSchema = z.object({
  style: hookStyleSchema,
  body: z.string().min(1),
  autoPicked: z.boolean(),
});
export type HookCandidate = z.infer<typeof hookCandidateSchema>;

export const draftedSectionSchema = z.object({
  kind: sectionKindSchema,
  heading: z.string(),
  body: z.string().min(1),
  estSeconds: z.number().int().positive(),
  retentionNote: z.string().nullable(),
});
export const draftOutputSchema = z.object({
  hookCandidates: z.array(hookCandidateSchema).length(3),
  sections: z.array(draftedSectionSchema).min(3),
});
export type DraftOutput = z.infer<typeof draftOutputSchema>;

/** Stages 4 & 5 rewrite sections in place; same shape out as in. */
export const sectionRewriteOutputSchema = z.object({
  sections: z.array(draftedSectionSchema).min(3),
});
export type SectionRewriteOutput = z.infer<typeof sectionRewriteOutputSchema>;

/** Stage 6 output: per-section fact refs; unsupported claims flagged. */
export const factCheckOutputSchema = z.object({
  sections: z.array(
    z.object({
      position: z.number().int().nonnegative(),
      factRefs: z.array(factRefSchema),
    }),
  ),
});
export type FactCheckOutput = z.infer<typeof factCheckOutputSchema>;

/** Stage 7 (code, not LLM): the quality gate report. */
export const qualityGateReportSchema = z.object({
  passed: z.boolean(),
  wordCount: z.number().int().nonnegative(),
  targetWordCount: z.number().int().nonnegative(),
  wordCountWithinTolerance: z.boolean(),
  fleschReadingEase: z.number(),
  readabilityOk: z.boolean(),
  estRuntimeSeconds: z.number().int().nonnegative(),
  hookSeconds: z.number().int().nonnegative(),
  hookOk: z.boolean(),
  warnings: z.array(z.string()),
  autoFixAttempted: z.boolean(),
});
export type QualityGateReport = z.infer<typeof qualityGateReportSchema>;

/** SSE events streamed to the editor while the script pipeline runs. */
export const scriptStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("stage_started"), stage: z.enum(SCRIPT_STAGES) }),
  z.object({ type: z.literal("stage_done"), stage: z.enum(SCRIPT_STAGES) }),
  z.object({ type: z.literal("outline"), outline: outlineSchema }),
  z.object({ type: z.literal("section"), section: draftedSectionSchema, position: z.number().int() }),
  z.object({ type: z.literal("hooks"), candidates: z.array(hookCandidateSchema) }),
  z.object({ type: z.literal("quality_report"), report: qualityGateReportSchema }),
  z.object({ type: z.literal("failed"), stage: z.enum(SCRIPT_STAGES), message: z.string() }),
  z.object({ type: z.literal("complete"), scriptId: scriptIdSchema }),
]);
export type ScriptStreamEvent = z.infer<typeof scriptStreamEventSchema>;

// ---------------------------------------------------------------------------
// §5.8 Revision pass
// ---------------------------------------------------------------------------

export const REVISION_STAGES = ["suggest_revisions"] as const;
export type RevisionStage = (typeof REVISION_STAGES)[number];

export const revisionJobInputSchema = z.object({
  workspaceId: workspaceIdSchema,
  scriptId: scriptIdSchema,
  guidance: z.string().max(2000).optional(),
});
export type RevisionJobInput = z.infer<typeof revisionJobInputSchema>;

export const revisionSuggestionSchema = z.object({
  sectionId: scriptSectionIdSchema,
  suggestion: z.string(),
  diff: z.array(diffOpSchema).min(1),
  rationale: z.string(),
});
export const revisionSuggestionsSchema = z.array(revisionSuggestionSchema);
export type RevisionSuggestion = z.infer<typeof revisionSuggestionSchema>;

// ---------------------------------------------------------------------------
// §5.9 Titles
// ---------------------------------------------------------------------------

export const TITLES_STAGES = ["generate_titles", "score_titles"] as const;
export type TitlesStage = (typeof TITLES_STAGES)[number];

export const titlesJobInputSchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
});
export type TitlesJobInput = z.infer<typeof titlesJobInputSchema>;

export const generatedTitlesSchema = z.object({
  /** 25 options across >= 5 pattern families. */
  options: z.array(titleOptionSchema).min(20).max(30),
});
export type GeneratedTitles = z.infer<typeof generatedTitlesSchema>;

// ---------------------------------------------------------------------------
// §5.10 Thumbnails (v1.1 image gen; text briefs in v1)
// ---------------------------------------------------------------------------

export const THUMBNAIL_STAGES = ["build_prompt", "generate_images"] as const;
export type ThumbnailStage = (typeof THUMBNAIL_STAGES)[number];

export const thumbnailJobInputSchema = z.object({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
  compositionPattern: z.string().min(1),
  subjectDescription: z.string().min(1).max(1000),
  faceImageKey: z.string().nullable(),
});
export type ThumbnailJobInput = z.infer<typeof thumbnailJobInputSchema>;

export const thumbnailResultSchema = z.object({
  promptUsed: z.string(),
  imageKeys: z.array(z.string()).max(3),
});
export type ThumbnailResult = z.infer<typeof thumbnailResultSchema>;

// ---------------------------------------------------------------------------
// §5.11 Packaging
// ---------------------------------------------------------------------------

export const PACKAGING_STAGES = ["description", "tags", "chapters"] as const;
export type PackagingStage = (typeof PACKAGING_STAGES)[number];

export const generatedTagsSchema = z.object({
  tags: z.array(z.string().min(1).max(60)).min(15).max(25),
});
export type GeneratedTags = z.infer<typeof generatedTagsSchema>;

// ---------------------------------------------------------------------------
// Stage registry — canonical stage lists per pipeline kind
// ---------------------------------------------------------------------------

export const PIPELINE_STAGE_REGISTRY = {
  script: SCRIPT_STAGES,
  ideas: IDEAS_STAGES,
  avatar: AVATAR_STAGES,
  revision: REVISION_STAGES,
  thumbnail: THUMBNAIL_STAGES,
} as const;
