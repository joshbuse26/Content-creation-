import { z } from "zod";
import {
  apiKeyIdSchema,
  channelIdSchema,
  chatMessageIdSchema,
  chatThreadIdSchema,
  contentTemplateIdSchema,
  descriptionTemplateIdSchema,
  frameIdSchema,
  ideaIdSchema,
  projectIdSchema,
  researchDocIdSchema,
  revisionIdSchema,
  scriptIdSchema,
  scriptSectionIdSchema,
  sectionCommentIdSchema,
  voiceProfileIdSchema,
  workspaceIdSchema,
} from "./ids";
import {
  channelModeSchema,
  colorMoodSchema,
  contentPackKindSchema,
  descriptionModeSchema,
  exportFormatSchema,
  ideaStatusSchema,
  projectStatusSchema,
  researchKindSchema,
  roleSchema,
  sophisticationSchema,
  subjectModeSchema,
} from "./enums";
import {
  apiKeySchema,
  archetypeSchema,
  audienceAvatarSchema,
  avatarMotivationSchema,
  avatarPainSchema,
  chatMessageSchema,
  chatThreadSchema,
  chatToolCallSchema,
  generationTargetSchema,
  channelSchema,
  channelStatsSnapshotSchema,
  chapterSetSchema,
  competitorCompareResultSchema,
  creditLedgerEntrySchema,
  demandSignalSchema,
  descriptionSchema,
  descriptionTemplateSchema,
  frameSchema,
  ideaSchema,
  membershipSchema,
  nicheVideoSchema,
  pipelineRunSchema,
  projectSchema,
  researchDocSchema,
  revisionSchema,
  scriptSchema,
  scriptSectionSchema,
  sectionCommentSchema,
  tagSetSchema,
  thumbnailConceptSchema,
  titleSetSchema,
  trainStyleCardInputSchema,
  trainStyleCardResultSchema,
  userSchema,
  voiceProfileSchema,
  whyItWorkedSchema,
  workspaceSchema,
} from "./entities";
import {
  contentPackPayloadSchema,
  contentTemplateSchema,
  hookCandidateSchema,
  outlineSchema,
  qualityGateReportSchema,
  topicCandidateSchema,
} from "./pipeline";

/**
 * Router input/output contracts — FROZEN LAYER.
 *
 * One namespace per tRPC router in server/routers/_contracts.ts. Every
 * procedure's input and output schema lives here so wave-2 agents implement
 * against — never redefine — these shapes.
 */

/** Every workspace-scoped call carries workspaceId; authz middleware reads it. */
export const workspaceScopedSchema = z.object({ workspaceId: workspaceIdSchema });

const jobAcceptedSchema = z.object({
  pipelineRunIds: z.array(z.string()),
  status: z.literal("queued"),
});
export type JobAccepted = z.infer<typeof jobAcceptedSchema>;

// --------------------------------------------------------------------------
// workspace
// --------------------------------------------------------------------------

export const workspaceContracts = {
  list: {
    input: z.void(),
    output: z.array(workspaceSchema.extend({ role: roleSchema })),
  },
  get: {
    input: workspaceScopedSchema,
    output: workspaceSchema,
  },
  create: {
    input: z.object({ name: z.string().min(1).max(120) }),
    output: workspaceSchema,
  },
  /**
   * Idempotent first-run bootstrap: returns the caller's existing workspace if
   * they already belong to one, otherwise creates a single default workspace
   * owned by them. Safe to call on every empty-list load — it never creates a
   * second workspace for a user who already has one.
   */
  ensureDefault: {
    input: z.void(),
    output: workspaceSchema.extend({ role: roleSchema }),
  },
  update: {
    input: workspaceScopedSchema.extend({ name: z.string().min(1).max(120) }),
    output: workspaceSchema,
  },
  members: {
    input: workspaceScopedSchema,
    output: z.array(membershipSchema.extend({ user: userSchema })),
  },
  invite: {
    input: workspaceScopedSchema.extend({ email: z.email(), role: roleSchema }),
    output: membershipSchema,
  },
  setRole: {
    input: workspaceScopedSchema.extend({ userId: userSchema.shape.id, role: roleSchema }),
    output: membershipSchema,
  },
  removeMember: {
    input: workspaceScopedSchema.extend({ userId: userSchema.shape.id }),
    output: z.object({ removed: z.boolean() }),
  },
} as const;

// --------------------------------------------------------------------------
// channel
// --------------------------------------------------------------------------

export const channelContracts = {
  list: {
    input: workspaceScopedSchema,
    output: z.array(channelSchema),
  },
  get: {
    input: workspaceScopedSchema.extend({ channelId: channelIdSchema }),
    output: channelSchema.extend({ latestSnapshot: channelStatsSnapshotSchema.nullable() }),
  },
  /** OAuth connect begins at /api/auth (Google); public mode connects by URL/handle. */
  connectPublic: {
    input: workspaceScopedSchema.extend({
      urlOrHandle: z.string().min(2).max(200),
      nicheKeywords: z.array(z.string().min(1)).max(6).default([]),
    }),
    output: channelSchema,
  },
  /**
   * One-click "use a demo channel": seeds a rich, synthetic channel (channel +
   * avatar + niche outliers + own-video transcripts) into the current
   * workspace so a playtester with no real channel — and no Google/OAuth keys —
   * can exercise the whole product. Seeded static data, NOT a provider call, so
   * it needs zero keys and works in fixture AND live mode. Idempotent: a second
   * connect reuses the same channel. Charges no credits.
   */
  connectDemo: {
    input: workspaceScopedSchema,
    output: channelSchema,
  },
  sync: {
    input: workspaceScopedSchema.extend({ channelId: channelIdSchema }),
    output: jobAcceptedSchema,
  },
  updateNiche: {
    input: workspaceScopedSchema.extend({
      channelId: channelIdSchema,
      nicheKeywords: z.array(z.string().min(1)).max(6),
    }),
    output: channelSchema,
  },
  disconnect: {
    input: workspaceScopedSchema.extend({ channelId: channelIdSchema }),
    output: z.object({ removed: z.boolean() }),
  },
} as const;

/** Re-export for wave-2 convenience. */
export const channelModeInputSchema = channelModeSchema;

// --------------------------------------------------------------------------
// avatar
// --------------------------------------------------------------------------

export const avatarUpdateFieldsSchema = z.object({
  ageRange: z.string().max(60).nullable().optional(),
  genderSplit: z.string().max(60).nullable().optional(),
  geo: z.array(z.string()).max(20).optional(),
  sophistication: sophisticationSchema.nullable().optional(),
  pains: z.array(avatarPainSchema).max(10).optional(),
  motivations: z.array(avatarMotivationSchema).max(10).optional(),
  vocabularyNotes: z.string().max(4000).nullable().optional(),
});

export const avatarContracts = {
  get: {
    input: workspaceScopedSchema.extend({ channelId: channelIdSchema }),
    output: audienceAvatarSchema.nullable(),
  },
  update: {
    input: workspaceScopedSchema.extend({
      channelId: channelIdSchema,
      fields: avatarUpdateFieldsSchema,
    }),
    output: audienceAvatarSchema,
  },
  regenerate: {
    input: workspaceScopedSchema.extend({
      channelId: channelIdSchema,
      regenerateAll: z.boolean().default(false),
    }),
    output: jobAcceptedSchema,
  },
} as const;

// --------------------------------------------------------------------------
// ideas
// --------------------------------------------------------------------------

export const ideasContracts = {
  feed: {
    input: workspaceScopedSchema.extend({
      channelId: channelIdSchema,
      status: ideaStatusSchema.optional(),
      limit: z.number().int().min(1).max(100).default(20),
    }),
    output: z.array(ideaSchema),
  },
  save: {
    input: workspaceScopedSchema.extend({ ideaId: ideaIdSchema }),
    output: ideaSchema,
  },
  dismiss: {
    input: workspaceScopedSchema.extend({ ideaId: ideaIdSchema }),
    output: ideaSchema,
  },
  promote: {
    input: workspaceScopedSchema.extend({ ideaId: ideaIdSchema }),
    output: z.object({ idea: ideaSchema, project: projectSchema }),
  },
  requestBatch: {
    input: workspaceScopedSchema.extend({ channelId: channelIdSchema }),
    output: jobAcceptedSchema,
  },
  /**
   * D3 discovery surface: the raw outlier index (niche_videos) for the
   * channel's niche — high-performing concepts with the outlier ratio,
   * performance, evidence URL and format tags. `nicheKeyword` narrows to one
   * of the channel's keywords; omit for the whole niche. Additive/read-only.
   */
  outliers: {
    input: workspaceScopedSchema.extend({
      channelId: channelIdSchema,
      nicheKeyword: z.string().min(1).max(60).nullable().default(null),
      limit: z.number().int().min(1).max(100).default(40),
      /**
       * E3 filters (additive, defaulted so the existing shape still parses and
       * behaves identically). `minOutlierRatio` keeps only concepts at/above a
       * view-multiple floor; `recency` narrows to videos published within the
       * band (computed from publishedAt). Duration/language bands are omitted
       * gracefully — niche_videos carries neither column.
       */
      minOutlierRatio: z.number().min(0).max(1000).nullable().default(null),
      recency: z.enum(["all", "month", "week"]).default("all"),
    }),
    output: z.array(nicheVideoSchema),
  },
  /**
   * E3 "why it worked": a short, cached, Coach-tier blurb per outlier video
   * explaining the likely driver of its over-performance (title pattern,
   * format, timing). Deterministic + keyless in fixture mode, scrubbed of any
   * real-person name. Scoped to the channel's niche exactly like `outliers`.
   * Additive, read-only, zero-cost.
   */
  whyItWorked: {
    input: workspaceScopedSchema.extend({
      channelId: channelIdSchema,
      nicheKeyword: z.string().min(1).max(60).nullable().default(null),
      limit: z.number().int().min(1).max(40).default(12),
    }),
    output: z.array(whyItWorkedSchema),
  },
  /**
   * E3 competitor compare: 1-3 competitor channel handles/URLs → their top
   * outliers (via the YouTube Data API seam) → SHARED outlier THEMES (format/
   * topic patterns) surfaced as ORIGINAL idea concepts. Workspace-scoped
   * (the `channelId` anchors tenancy + niche; a foreign channel is NOT_FOUND).
   * Metered once (idempotent on the compare inputs) — reuses the requestBatch
   * 1-credit pattern. Never clones a named creator's voice/script; every
   * derived theme/concept is run through seed-lint so no real name lands.
   */
  competitorCompare: {
    input: workspaceScopedSchema.extend({
      channelId: channelIdSchema,
      channelHandles: z.array(z.string().min(2).max(200)).min(1).max(3),
    }),
    output: competitorCompareResultSchema,
  },
  /**
   * D3 search-demand signal: a lightweight demand proxy per topic, read
   * through the EXISTING web SearchProvider (no new paid API, no scraping;
   * deterministic + keyless in fixture mode). `topics` empty ⇒ the channel's
   * niche keywords. Additive/read-only.
   */
  searchDemand: {
    input: workspaceScopedSchema.extend({
      channelId: channelIdSchema,
      topics: z.array(z.string().min(1).max(200)).max(20).default([]),
    }),
    output: z.array(demandSignalSchema),
  },
  /**
   * D3 one-click "use this idea": promote the idea into a project (or reload
   * the one it was already promoted into) and seed a CHOSEN frame carrying
   * the idea's angle as the steerable unique angle, so it flows into the
   * framing/outline path and buildCoachContext. `angle` sharpens the seed
   * before writing; `targetMinutes` sets the seed duration. Additive.
   */
  useIdea: {
    input: workspaceScopedSchema.extend({
      ideaId: ideaIdSchema,
      angle: z.string().min(1).max(2000).nullable().default(null),
      targetMinutes: z.number().int().positive().max(120).nullable().default(null),
    }),
    output: z.object({ idea: ideaSchema, project: projectSchema, frame: frameSchema }),
  },
} as const;

// --------------------------------------------------------------------------
// project
// --------------------------------------------------------------------------

export const projectContracts = {
  list: {
    input: workspaceScopedSchema.extend({
      channelId: channelIdSchema.optional(),
      status: projectStatusSchema.optional(),
      limit: z.number().int().min(1).max(100).default(50),
    }),
    output: z.array(projectSchema),
  },
  get: {
    input: workspaceScopedSchema.extend({ projectId: projectIdSchema }),
    output: projectSchema,
  },
  create: {
    input: workspaceScopedSchema.extend({
      channelId: channelIdSchema,
      title: z.string().min(1).max(200),
      ideaId: ideaIdSchema.nullable().default(null),
    }),
    output: projectSchema,
  },
  update: {
    input: workspaceScopedSchema.extend({
      projectId: projectIdSchema,
      title: z.string().min(1).max(200).optional(),
      status: projectStatusSchema.optional(),
      targetPublishDate: z.iso.date().nullable().optional(),
      publishedVideoId: z.string().nullable().optional(),
    }),
    output: projectSchema,
  },
  archive: {
    input: workspaceScopedSchema.extend({ projectId: projectIdSchema }),
    output: z.object({ archived: z.boolean() }),
  },
  /**
   * Wave-C additive (REQUESTS-C2 #1): persist the project's generation
   * target (mode/archetype/crossover) BEFORE any draft exists, so the
   * picker's choice follows the user across devices and teammates see it.
   * `null` clears the target (legacy voice-profile flow). Mode availability
   * is enforced server-side (server/modes.ts) exactly as on the staged
   * script procedures.
   */
  setGenerationTarget: {
    input: workspaceScopedSchema.extend({
      projectId: projectIdSchema,
      generation: generationTargetSchema.nullable(),
    }),
    output: projectSchema,
  },
} as const;

// --------------------------------------------------------------------------
// research
// --------------------------------------------------------------------------

export const researchContracts = {
  list: {
    input: workspaceScopedSchema.extend({ projectId: projectIdSchema }),
    output: z.array(researchDocSchema.omit({ content: true })),
  },
  get: {
    input: workspaceScopedSchema.extend({ researchDocId: researchDocIdSchema }),
    output: researchDocSchema,
  },
  /** Kicks off the §5.5 research agent. Charges 1 credit. */
  search: {
    input: workspaceScopedSchema.extend({
      projectId: projectIdSchema,
      query: z.string().min(3).max(500),
    }),
    output: jobAcceptedSchema,
  },
  importTranscript: {
    input: workspaceScopedSchema.extend({
      projectId: projectIdSchema,
      youtubeVideoUrl: z.url(),
    }),
    output: researchDocSchema,
  },
  /** Upload is parsed server-side (PDF/MD/TXT). Word caps enforced by plan. */
  upload: {
    input: workspaceScopedSchema.extend({
      projectId: projectIdSchema,
      filename: z.string().min(1).max(255),
      kind: researchKindSchema,
      content: z.string().max(200_000),
    }),
    output: researchDocSchema,
  },
  remove: {
    input: workspaceScopedSchema.extend({ researchDocId: researchDocIdSchema }),
    output: z.object({ removed: z.boolean() }),
  },
} as const;

// --------------------------------------------------------------------------
// frame
// --------------------------------------------------------------------------

export const frameContracts = {
  list: {
    input: workspaceScopedSchema.extend({ projectId: projectIdSchema }),
    output: z.array(frameSchema),
  },
  propose: {
    input: workspaceScopedSchema.extend({ projectId: projectIdSchema }),
    output: jobAcceptedSchema,
  },
  choose: {
    input: workspaceScopedSchema.extend({ frameId: frameIdSchema }),
    output: frameSchema,
  },
  update: {
    input: workspaceScopedSchema.extend({
      frameId: frameIdSchema,
      fields: frameSchema
        .pick({
          angle: true,
          format: true,
          outcome: true,
          audienceSegment: true,
          tone: true,
          targetMinutes: true,
          keywords: true,
        })
        .partial(),
    }),
    output: frameSchema,
  },
} as const;

// --------------------------------------------------------------------------
// script
// --------------------------------------------------------------------------

/** Optional generation target carried by script procedures (wave C).
 *  null = legacy flow (voiceProfileId alone drives the style card). */
const generationParam = generationTargetSchema.nullable().default(null);

export const scriptContracts = {
  /**
   * COMPOSITE generation — kept for MCP/one-click use. Wave-C contract note
   * (PRODUCT-CONTRACTS §4): this becomes an ORCHESTRATOR over the staged
   * procedures below — outline (1) + hooks (1) + draft (4) in order, summed
   * cost 6 with itemized ledger entries; it may NOT bypass stage metering.
   * C1 implements the orchestration; the signature is unchanged apart from
   * the additive `generation` param.
   */
  generate: {
    input: workspaceScopedSchema.extend({
      projectId: projectIdSchema,
      frameId: frameIdSchema,
      voiceProfileId: voiceProfileIdSchema.nullable().default(null),
      generation: generationParam,
    }),
    output: jobAcceptedSchema.extend({ scriptId: scriptIdSchema }),
  },
  // -- staged, individually metered procedures (PRODUCT-CONTRACTS §4) ------
  /** Topic candidates for a channel/archetype. 1 credit. */
  topics: {
    input: workspaceScopedSchema.extend({
      channelId: channelIdSchema,
      generation: generationParam,
      count: z.number().int().min(3).max(10).default(5),
    }),
    output: z.object({ topics: z.array(topicCandidateSchema).min(3).max(10) }),
  },
  /** Outline from the chosen topic + style card. 1 credit. topic null ⇒
   *  derive from the project's chosen frame. */
  outline: {
    input: workspaceScopedSchema.extend({
      projectId: projectIdSchema,
      /** null = use the project's chosen frame. */
      frameId: frameIdSchema.nullable().default(null),
      topic: topicCandidateSchema.pick({ title: true, angle: true }).nullable().default(null),
      generation: generationParam,
    }),
    output: z.object({ outline: outlineSchema }),
  },
  /** 3 tagged hook candidates for an approved outline. 1 credit. */
  hooks: {
    input: workspaceScopedSchema.extend({
      projectId: projectIdSchema,
      /** The approved outline; null = synthesize from the chosen frame. */
      outline: outlineSchema.nullable().default(null),
      generation: generationParam,
    }),
    output: z.object({ hooks: z.array(hookCandidateSchema).length(3) }),
  },
  /**
   * Full script from approved outline + chosen hook, section-streamed over
   * the existing SSE route. 4 credits. Retention/voice/fact-check/quality
   * passes stay INSIDE draft (not user-facing stages).
   */
  draft: {
    input: workspaceScopedSchema.extend({
      projectId: projectIdSchema,
      frameId: frameIdSchema,
      outline: outlineSchema.nullable().default(null),
      /** The chosen hook; null = auto-pick. */
      hook: hookCandidateSchema.nullable().default(null),
      voiceProfileId: voiceProfileIdSchema.nullable().default(null),
      generation: generationParam,
    }),
    output: jobAcceptedSchema.extend({ scriptId: scriptIdSchema }),
  },
  get: {
    input: workspaceScopedSchema.extend({ scriptId: scriptIdSchema }),
    output: z.object({
      script: scriptSchema,
      sections: z.array(scriptSectionSchema),
      qualityReport: qualityGateReportSchema.nullable(),
      /**
       * Stage-3 hook candidates, when known. Process-local cache (no table
       * in the frozen schema) — null after a restart; the editor falls back
       * to its local copy. Approved contract addition (REQUESTS-A3 #4).
       */
      hookCandidates: z.array(hookCandidateSchema).nullable(),
    }),
  },
  listVersions: {
    input: workspaceScopedSchema.extend({ projectId: projectIdSchema }),
    output: z.array(scriptSchema),
  },
  updateSection: {
    input: workspaceScopedSchema.extend({
      sectionId: scriptSectionIdSchema,
      heading: z.string().max(200).optional(),
      body: z.string().max(50_000).optional(),
    }),
    output: scriptSectionSchema,
  },
  regenerateSection: {
    input: workspaceScopedSchema.extend({
      sectionId: scriptSectionIdSchema,
      guidance: z.string().max(2000).optional(),
      /**
       * Surgical edit (E4): the highlighted sentence/sub-section the creator
       * wants the rewrite to focus on. Additive + optional — omitted, the
       * behavior is exactly the whole-section regenerate it was before. When
       * present, the selection + steer note scope the regeneration prompt to
       * that part while the section is still rewritten as a coherent whole.
       */
      selectionText: z.string().max(5000).optional(),
    }),
    output: jobAcceptedSchema,
  },
  setSectionLock: {
    input: workspaceScopedSchema.extend({
      sectionId: scriptSectionIdSchema,
      locked: z.boolean(),
    }),
    output: scriptSectionSchema,
  },
  /**
   * Persist a full section ordering (approved contract addition,
   * REQUESTS-A3 #3). sectionIds must be a permutation of the script's
   * sections; returns them in the new order.
   */
  reorderSections: {
    input: workspaceScopedSchema.extend({
      scriptId: scriptIdSchema,
      sectionIds: z.array(scriptSectionIdSchema).min(1),
    }),
    output: z.array(scriptSectionSchema),
  },
  /**
   * Multi-voice (PRODUCT-CONTRACTS §7 / spec §5.7): assign a per-section
   * voice profile that overrides the script-level voice for that one section.
   * voiceProfileId null clears the override (section falls back to the script
   * voice). Config, not generation — no credit charge. The new voice takes
   * effect the next time the section is (re)generated.
   */
  setSectionVoice: {
    input: workspaceScopedSchema.extend({
      sectionId: scriptSectionIdSchema,
      voiceProfileId: voiceProfileIdSchema.nullable(),
    }),
    output: scriptSectionSchema,
  },
  export: {
    input: workspaceScopedSchema.extend({
      scriptId: scriptIdSchema,
      format: exportFormatSchema,
    }),
    output: z.object({
      filename: z.string(),
      mimeType: z.string(),
      /** base64 for binary (docx); utf-8 text otherwise. */
      content: z.string(),
      encoding: z.enum(["utf8", "base64"]),
    }),
  },
} as const;

// --------------------------------------------------------------------------
// voiceProfile (read-only list — powers the editor's section-voice picker)
// --------------------------------------------------------------------------

export const voiceProfileContracts = {
  /** All voice profiles in the workspace. No credits; every member may read. */
  list: {
    input: workspaceScopedSchema,
    output: z.array(voiceProfileSchema),
  },
  /**
   * Rename a voice profile the workspace owns (WAVE-D-PLAN §2c — trained
   * cards are managed alongside archetypes). No credits; tenancy-scoped.
   */
  rename: {
    input: workspaceScopedSchema.extend({
      voiceProfileId: voiceProfileIdSchema,
      name: z.string().min(1).max(120),
    }),
    output: voiceProfileSchema,
  },
  /** Delete a voice profile the workspace owns. No credits; tenancy-scoped. */
  remove: {
    input: workspaceScopedSchema.extend({ voiceProfileId: voiceProfileIdSchema }),
    output: z.object({ deleted: z.boolean() }),
  },
} as const;

// --------------------------------------------------------------------------
// revision
// --------------------------------------------------------------------------

export const revisionContracts = {
  /** Runs the §5.8 revision pass. 2 credits. */
  run: {
    input: workspaceScopedSchema.extend({
      scriptId: scriptIdSchema,
      guidance: z.string().max(2000).optional(),
    }),
    output: jobAcceptedSchema,
  },
  list: {
    input: workspaceScopedSchema.extend({ scriptId: scriptIdSchema }),
    output: z.array(revisionSchema),
  },
  accept: {
    input: workspaceScopedSchema.extend({ revisionId: revisionIdSchema }),
    output: z.object({ revision: revisionSchema, section: scriptSectionSchema }),
  },
  reject: {
    input: workspaceScopedSchema.extend({ revisionId: revisionIdSchema }),
    output: revisionSchema,
  },
} as const;

// --------------------------------------------------------------------------
// titles / thumbnails / description / tags / chapters / templates
// --------------------------------------------------------------------------

export const titlesContracts = {
  generate: {
    input: workspaceScopedSchema.extend({ projectId: projectIdSchema }),
    output: jobAcceptedSchema,
  },
  latest: {
    input: workspaceScopedSchema.extend({ projectId: projectIdSchema }),
    output: titleSetSchema.nullable(),
  },
} as const;

export const thumbnailsContracts = {
  /** v1: text brief only. v1.1: image generation, 1 credit per image. */
  generate: {
    input: workspaceScopedSchema.extend({
      projectId: projectIdSchema,
      compositionPattern: z.string().min(1).max(60),
      subjectDescription: z.string().min(1).max(1000),
      /**
       * Wave-C additive (REQUESTS-C3 #1): user-supplied overlay text. The
       * pipeline enforces the archetype preset's maxOverlayWords cap
       * (reject-with-clear-error, never silent truncation).
       */
      overlayText: z.string().max(200).nullable().default(null),
    }),
    output: jobAcceptedSchema,
  },
  list: {
    input: workspaceScopedSchema.extend({ projectId: projectIdSchema }),
    output: z.array(thumbnailConceptSchema),
  },
  choose: {
    input: workspaceScopedSchema.extend({ thumbnailConceptId: thumbnailConceptSchema.shape.id }),
    output: thumbnailConceptSchema,
  },
  // -- Thumbnail Whiteboard Studio (WAVE-D / E2) — ADDITIVE. The one-shot
  //    generate/list/choose above stay intact; these drive the board UI.
  /**
   * Generate a board of N (3-6) concepts sharing a new board_id. METERED per
   * image at the existing per-image rate (N credits), idempotent per concept
   * so a retry/re-run with the same base params never double-charges.
   */
  generateBoard: {
    input: workspaceScopedSchema.extend({
      projectId: projectIdSchema,
      count: z.number().int().min(3).max(6),
      overlayText: z.string().max(200).nullable().default(null),
      preset: z.string().min(1).max(60).nullable().default(null),
      subject: subjectModeSchema.nullable().default(null),
      mood: colorMoodSchema.nullable().default(null),
    }),
    output: z.object({
      boardId: z.uuid(),
      concepts: z.array(thumbnailConceptSchema),
    }),
  },
  /**
   * Regenerate ONE concept's image with tweaked params and update its row.
   * 1 credit, idempotent on the tweaked-input hash.
   */
  tweakConcept: {
    input: workspaceScopedSchema.extend({
      conceptId: thumbnailConceptSchema.shape.id,
      compositionPattern: z.string().min(1).max(60).optional(),
      overlayText: z.string().max(200).nullable().optional(),
      preset: z.string().min(1).max(60).nullable().optional(),
      subject: subjectModeSchema.nullable().optional(),
      mood: colorMoodSchema.nullable().optional(),
    }),
    output: thumbnailConceptSchema,
  },
  /** Star a concept (no charge). */
  favorite: {
    input: workspaceScopedSchema.extend({ conceptId: thumbnailConceptSchema.shape.id }),
    output: thumbnailConceptSchema,
  },
  /** Un-star a concept (no charge). */
  unfavorite: {
    input: workspaceScopedSchema.extend({ conceptId: thumbnailConceptSchema.shape.id }),
    output: thumbnailConceptSchema,
  },
  /**
   * Pick the winning concept: set status=chosen, demote the project's other
   * concepts, attach it to the packaging surface. No charge. Reconciles with
   * the existing `choose` (both set status=chosen via the same store call).
   */
  chooseWinner: {
    input: workspaceScopedSchema.extend({ conceptId: thumbnailConceptSchema.shape.id }),
    output: thumbnailConceptSchema,
  },
  /** A project's concepts grouped by board_id, newest board first. No charge. */
  listBoard: {
    input: workspaceScopedSchema.extend({ projectId: projectIdSchema }),
    output: z.array(
      z.object({
        boardId: z.uuid().nullable(),
        createdAt: z.date(),
        concepts: z.array(thumbnailConceptSchema),
      }),
    ),
  },
} as const;

export const descriptionContracts = {
  generate: {
    input: workspaceScopedSchema.extend({
      projectId: projectIdSchema,
      mode: descriptionModeSchema,
      templateId: descriptionTemplateIdSchema.nullable().default(null),
    }),
    output: descriptionSchema,
  },
  list: {
    input: workspaceScopedSchema.extend({ projectId: projectIdSchema }),
    output: z.array(descriptionSchema),
  },
  update: {
    input: workspaceScopedSchema.extend({
      descriptionId: descriptionSchema.shape.id,
      body: z.string().max(10_000),
    }),
    output: descriptionSchema,
  },
} as const;

export const tagsContracts = {
  generate: {
    input: workspaceScopedSchema.extend({ projectId: projectIdSchema }),
    output: tagSetSchema,
  },
  latest: {
    input: workspaceScopedSchema.extend({ projectId: projectIdSchema }),
    output: tagSetSchema.nullable(),
  },
  update: {
    input: workspaceScopedSchema.extend({
      tagSetId: tagSetSchema.shape.id,
      tags: z.array(z.string().min(1).max(60)).max(30),
    }),
    output: tagSetSchema,
  },
} as const;

export const chaptersContracts = {
  /** Derived from sections' estSeconds; editable afterwards. */
  derive: {
    input: workspaceScopedSchema.extend({ projectId: projectIdSchema }),
    output: chapterSetSchema,
  },
  latest: {
    input: workspaceScopedSchema.extend({ projectId: projectIdSchema }),
    output: chapterSetSchema.nullable(),
  },
  update: {
    input: workspaceScopedSchema.extend({
      chapterSetId: chapterSetSchema.shape.id,
      entries: chapterSetSchema.shape.entries,
    }),
    output: chapterSetSchema,
  },
} as const;

export const templatesContracts = {
  list: {
    input: workspaceScopedSchema,
    output: z.array(descriptionTemplateSchema),
  },
  create: {
    input: workspaceScopedSchema.extend({
      name: z.string().min(1).max(120),
      body: z.string().max(10_000),
    }),
    output: descriptionTemplateSchema,
  },
  update: {
    input: workspaceScopedSchema.extend({
      templateId: descriptionTemplateIdSchema,
      name: z.string().min(1).max(120).optional(),
      body: z.string().max(10_000).optional(),
    }),
    output: descriptionTemplateSchema,
  },
  remove: {
    input: workspaceScopedSchema.extend({ templateId: descriptionTemplateIdSchema }),
    output: z.object({ removed: z.boolean() }),
  },
  // -- Reusable content packs (E4) — outline / hook_pack, scoped per workspace,
  //    taggable per channel. Mirrors the description-template role model:
  //    admin+ manage (save/remove), any member lists, writer applies. Kept on
  //    the templates router alongside the existing description-template CRUD,
  //    which is left untouched.
  /**
   * Save a proven outline or hook set as a reusable pack. channelId null =
   * workspace-wide. Admin+ only (template resource). No LLM, no charge.
   */
  saveContentPack: {
    input: workspaceScopedSchema.extend({
      channelId: channelIdSchema.nullable().default(null),
      name: z.string().min(1).max(120),
      payload: contentPackPayloadSchema,
    }),
    output: contentTemplateSchema,
  },
  /**
   * List content packs, filtered by channel + kind. channelId null ⇒ only
   * workspace-wide packs; a channel id ⇒ that channel's packs plus the
   * workspace-wide ones (a pack tagged to a DIFFERENT channel is never
   * returned — channel isolation). kind null ⇒ both kinds. Any member.
   */
  listContentPacks: {
    input: workspaceScopedSchema.extend({
      channelId: channelIdSchema.nullable().default(null),
      kind: contentPackKindSchema.nullable().default(null),
    }),
    output: z.array(contentTemplateSchema),
  },
  /**
   * Apply a pack to seed a project — returns the pack payload so the caller
   * seeds the outline/hooks stage with it. No LLM, no charge (pure reuse).
   * Writer+ (gated on project.update). A pack tagged to a channel other than
   * the project's channel is refused (channel isolation).
   */
  applyContentPack: {
    input: workspaceScopedSchema.extend({
      contentTemplateId: contentTemplateIdSchema,
      projectId: projectIdSchema,
    }),
    output: z.object({
      contentTemplate: contentTemplateSchema,
      payload: contentPackPayloadSchema,
    }),
  },
  /** Remove a content pack. Admin+ only. */
  removeContentPack: {
    input: workspaceScopedSchema.extend({ contentTemplateId: contentTemplateIdSchema }),
    output: z.object({ removed: z.boolean() }),
  },
} as const;

// --------------------------------------------------------------------------
// comments (E4) — per-section comment threads for team collaboration. Zero
// credits (no LLM); role-gated per the authz matrix (viewer read-only, writer+
// add/resolve, author-or-admin remove); tenancy-scoped (cross-workspace →
// NOT_FOUND). Light: clients poll/invalidate on mutation, not realtime.
// --------------------------------------------------------------------------

export const commentsContracts = {
  /** All comments on a script (optionally one section), oldest first. */
  list: {
    input: workspaceScopedSchema.extend({
      scriptId: scriptIdSchema,
      sectionId: scriptSectionIdSchema.nullable().default(null),
    }),
    output: z.array(sectionCommentSchema),
  },
  /** Add a comment to a section. Writer+. */
  add: {
    input: workspaceScopedSchema.extend({
      sectionId: scriptSectionIdSchema,
      body: z.string().min(1).max(4000),
    }),
    output: sectionCommentSchema,
  },
  /** Mark a comment resolved. Writer+. */
  resolve: {
    input: workspaceScopedSchema.extend({ commentId: sectionCommentIdSchema }),
    output: sectionCommentSchema,
  },
  /** Reopen a resolved comment. Writer+. */
  unresolve: {
    input: workspaceScopedSchema.extend({ commentId: sectionCommentIdSchema }),
    output: sectionCommentSchema,
  },
  /** Remove a comment. The author may remove their own; admin+ may remove any. */
  remove: {
    input: workspaceScopedSchema.extend({ commentId: sectionCommentIdSchema }),
    output: z.object({ removed: z.boolean() }),
  },
} as const;

// --------------------------------------------------------------------------
// dashboard
// --------------------------------------------------------------------------

export const dashboardContracts = {
  overview: {
    input: workspaceScopedSchema,
    output: z.object({
      creditBalance: z.number().int(),
      projectCounts: z.partialRecord(projectStatusSchema, z.number().int().nonnegative()),
      recentProjects: z.array(projectSchema),
      recentRuns: z.array(pipelineRunSchema),
    }),
  },
  /** Post-publish: projected (idea score) vs actual views. */
  tracking: {
    input: workspaceScopedSchema.extend({ channelId: channelIdSchema.optional() }),
    output: z.array(
      z.object({
        project: projectSchema,
        projectedScore: z.number().nullable(),
        actualViews: z.number().int().nonnegative().nullable(),
        capturedAt: z.date().nullable(),
      }),
    ),
  },
} as const;

// --------------------------------------------------------------------------
// billing
// --------------------------------------------------------------------------

export const billingContracts = {
  summary: {
    input: workspaceScopedSchema,
    output: z.object({
      plan: workspaceSchema.shape.plan,
      creditBalance: z.number().int(),
      billingCycleAnchor: z.date().nullable(),
      ledger: z.array(creditLedgerEntrySchema),
    }),
  },
  /** Stripe Checkout session for a plan. */
  checkout: {
    input: workspaceScopedSchema.extend({ plan: z.enum(["starter", "team", "agency"]) }),
    output: z.object({ checkoutUrl: z.url() }),
  },
  /** Stripe customer-portal session (v1.1). */
  portal: {
    input: workspaceScopedSchema,
    output: z.object({ portalUrl: z.url() }),
  },
} as const;

// --------------------------------------------------------------------------
// archetypes (wave C — seeded catalog, PRODUCT-CONTRACTS §2)
// --------------------------------------------------------------------------

export const archetypesContracts = {
  /** Public within a workspace (any member), no charge. Always 12 rows —
   *  served from seed data (DB) or lib/archetypes.ts (fixture mode). */
  list: {
    input: workspaceScopedSchema,
    output: z.array(archetypeSchema),
  },
} as const;

// --------------------------------------------------------------------------
// apiKeys (MCP access — v1.1 feature, contract frozen now)
// --------------------------------------------------------------------------

export const apiKeysContracts = {
  list: {
    input: workspaceScopedSchema,
    output: z.array(apiKeySchema),
  },
  create: {
    input: workspaceScopedSchema.extend({
      scopes: z.array(z.string().min(1)).min(1),
      channelIds: z.array(channelIdSchema).default([]),
    }),
    output: z.object({
      apiKey: apiKeySchema,
      /** Shown exactly once. */
      secret: z.string(),
    }),
  },
  revoke: {
    input: workspaceScopedSchema.extend({ apiKeyId: apiKeyIdSchema }),
    output: apiKeySchema,
  },
} as const;

// --------------------------------------------------------------------------
// voice (Wave D — train_on_my_channel derivation, WAVE-D-PLAN §2c)
// --------------------------------------------------------------------------

export const voiceContracts = {
  /**
   * Derive a `source="trained"` StyleCard from the workspace's own channel
   * (or a competitor remix). D0 STUB: returns a plausible trained voice
   * profile (fixture) so the picker + chat context can be built keylessly.
   * D2 replaces the body with the real consent-gated transcript→LLM
   * derivation. Generation-class (metering + consent enforced in D2).
   */
  trainFromChannel: {
    input: workspaceScopedSchema.extend(trainStyleCardInputSchema.shape),
    output: trainStyleCardResultSchema,
  },
} as const;

// --------------------------------------------------------------------------
// chat (Wave D — chat-first surface, WAVE-D-PLAN §2a). Zero-cost by
// contract: the credit-costing happens INSIDE tool execution (D1), never on
// the chat procedures themselves.
// --------------------------------------------------------------------------

/**
 * Ack returned by chat.sendMessage. The assistant reply is SSE-streamed
 * (D1) over the chat event union (lib/types/chat.ts) at `streamPath`; this
 * ack carries the persisted user message id and the pending assistant
 * message id the stream will fill. D0 stub returns a deterministic ack.
 */
export const chatSendAckSchema = z.object({
  userMessageId: chatMessageIdSchema,
  assistantMessageId: chatMessageIdSchema,
  /** SSE endpoint the client subscribes to for the streamed reply (D1). */
  streamPath: z.string(),
  status: z.literal("streaming"),
});

/** Ack returned by chat.confirmTool once a proposed tool call is accepted. */
export const chatConfirmToolAckSchema = z.object({
  toolCallId: z.string(),
  accepted: z.boolean(),
  /** Pre-execution credit quote (estimateToolCredits); charged in D1. */
  estimatedCredits: z.number().int().nonnegative(),
  status: z.literal("accepted"),
});

export const chatContracts = {
  listThreads: {
    input: workspaceScopedSchema.extend({
      /** Filter to one project's threads; omit for all (incl. workspace coach). */
      projectId: projectIdSchema.nullable().default(null),
      limit: z.number().int().min(1).max(100).default(50),
    }),
    output: z.array(chatThreadSchema),
  },
  getThread: {
    input: workspaceScopedSchema.extend({
      threadId: chatThreadIdSchema,
      /** Page of messages ordered by seq; cursor = last seq seen. */
      limit: z.number().int().min(1).max(200).default(50),
      cursor: z.number().int().nonnegative().nullable().default(null),
    }),
    output: z.object({
      thread: chatThreadSchema,
      messages: z.array(chatMessageSchema),
      /** Next `cursor` when more messages remain; null when fully paged. */
      nextCursor: z.number().int().nonnegative().nullable(),
    }),
  },
  createThread: {
    input: workspaceScopedSchema.extend({
      /** null = workspace-level coach thread. */
      projectId: projectIdSchema.nullable().default(null),
      title: z.string().min(1).max(200),
    }),
    output: chatThreadSchema,
  },
  /** Post a user message; the assistant reply is SSE-streamed (D1). */
  sendMessage: {
    input: workspaceScopedSchema.extend({
      threadId: chatThreadIdSchema,
      content: z.string().min(1).max(10_000),
    }),
    output: chatSendAckSchema,
  },
  /** Execute a proposed credit-costing tool call after user confirm (D1). */
  confirmTool: {
    input: workspaceScopedSchema.extend({
      threadId: chatThreadIdSchema,
      toolCallId: z.string().min(1),
      /** The (possibly user-edited) args to execute with. */
      args: z.record(z.string(), z.unknown()),
    }),
    output: chatConfirmToolAckSchema,
  },
  renameThread: {
    input: workspaceScopedSchema.extend({
      threadId: chatThreadIdSchema,
      title: z.string().min(1).max(200),
    }),
    output: chatThreadSchema,
  },
  deleteThread: {
    input: workspaceScopedSchema.extend({ threadId: chatThreadIdSchema }),
    output: z.object({ deleted: z.boolean() }),
  },
} as const;

/** Re-export for the chat tool-call proposal shape (used by D1 + tests). */
export const chatToolCallInputSchema = chatToolCallSchema;
