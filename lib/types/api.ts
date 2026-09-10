import { z } from "zod";
import {
  apiKeyIdSchema,
  channelIdSchema,
  descriptionTemplateIdSchema,
  frameIdSchema,
  ideaIdSchema,
  projectIdSchema,
  researchDocIdSchema,
  revisionIdSchema,
  scriptIdSchema,
  scriptSectionIdSchema,
  voiceProfileIdSchema,
  workspaceIdSchema,
} from "./ids";
import {
  channelModeSchema,
  descriptionModeSchema,
  exportFormatSchema,
  ideaStatusSchema,
  projectStatusSchema,
  researchKindSchema,
  roleSchema,
  sophisticationSchema,
} from "./enums";
import {
  apiKeySchema,
  archetypeSchema,
  audienceAvatarSchema,
  avatarMotivationSchema,
  avatarPainSchema,
  generationTargetSchema,
  channelSchema,
  channelStatsSnapshotSchema,
  chapterSetSchema,
  creditLedgerEntrySchema,
  descriptionSchema,
  descriptionTemplateSchema,
  frameSchema,
  ideaSchema,
  membershipSchema,
  pipelineRunSchema,
  projectSchema,
  researchDocSchema,
  revisionSchema,
  scriptSchema,
  scriptSectionSchema,
  tagSetSchema,
  thumbnailConceptSchema,
  titleSetSchema,
  userSchema,
  workspaceSchema,
} from "./entities";
import {
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
