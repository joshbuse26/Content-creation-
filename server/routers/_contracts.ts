import {
  apiKeysContracts,
  archetypesContracts,
  avatarContracts,
  billingContracts,
  channelContracts,
  chaptersContracts,
  chatContracts,
  dashboardContracts,
  descriptionContracts,
  frameContracts,
  ideasContracts,
  projectContracts,
  researchContracts,
  revisionContracts,
  scriptContracts,
  tagsContracts,
  templatesContracts,
  thumbnailsContracts,
  titlesContracts,
  voiceContracts,
  voiceProfileContracts,
  workspaceContracts,
} from "@/lib/types/api";
import { rateLimitMiddleware } from "@/server/ratelimit";
import { apiKeysImpl } from "@/server/routers/impl/apiKeys";
import { archetypesImpl } from "@/server/routers/impl/archetypes";
import { avatarHandlers } from "@/server/routers/impl/avatar";
import { billingHandlers } from "@/server/routers/impl/billing";
import { channelHandlers } from "@/server/routers/impl/channel";
import { chaptersHandlers } from "@/server/routers/impl/chapters";
import { chatImpl } from "@/server/routers/impl/chat";
import { dashboardHandlers } from "@/server/routers/impl/dashboard";
import { descriptionHandlers } from "@/server/routers/impl/description";
import { frameImpl } from "@/server/routers/impl/frame";
import { ideasHandlers } from "@/server/routers/impl/ideas";
import { projectHandlers } from "@/server/routers/impl/project";
import { researchImpl } from "@/server/routers/impl/research";
import { revisionImpl } from "@/server/routers/impl/revision";
import { scriptImpl } from "@/server/routers/impl/script";
import { scriptStagesImpl } from "@/server/routers/impl/script-stages";
import { tagsHandlers } from "@/server/routers/impl/tags";
import { templatesImpl } from "@/server/routers/impl/templates";
import { thumbnailsImpl } from "@/server/routers/impl/thumbnails";
import { titlesImpl } from "@/server/routers/impl/titles";
import { voiceImpl } from "@/server/routers/impl/voice";
import { voiceProfileImpl } from "@/server/routers/impl/voiceProfile";
import { workspaceHandlers } from "@/server/routers/impl/workspace";
import { protectedProcedure, router, workspaceProcedure } from "@/server/trpc";

/**
 * ROUTER CONTRACTS — FROZEN LAYER (sprint plan §2).
 *
 * Signatures (inputs/outputs in lib/types/api.ts) are frozen; the bodies
 * below delegate to the wave-2 implementations:
 *
 *   channel/avatar        → A1 (server/routers/impl/{channel,avatar}.ts)
 *   research/frame/script/revision/titles → A2 (impl/*.ts)
 *   description/tags/chapters/dashboard   → A4 (impl/*.ts)
 *   workspace/project/billing.summary     → A0 integration (impl/*.ts)
 *
 *   ideas                                 → B1 (impl/ideas.ts)
 *   apiKeys                               → B2 (impl/apiKeys.ts)
 *   billing.checkout/portal               → B3 (impl/billing.ts, live Stripe)
 *   thumbnails/templates                  → B4 (impl/{thumbnails,templates}.ts)
 *
 * Rate limits (spec §6): every procedure carries the "general" policy;
 * generation endpoints additionally carry the stricter "generation" policy.
 */

const general = rateLimitMiddleware("general");
const generation = rateLimitMiddleware("generation");

// ---------------------------------------------------------------------------

export const workspaceRouter = router({
  list: protectedProcedure
    .use(general)
    .input(workspaceContracts.list.input)
    .output(workspaceContracts.list.output)
    .query(({ ctx }) => workspaceHandlers.list({ ctx })),
  get: workspaceProcedure("workspace", "read")
    .use(general)
    .output(workspaceContracts.get.output)
    .query(({ ctx }) => workspaceHandlers.get({ ctx })),
  create: protectedProcedure
    .use(general)
    .input(workspaceContracts.create.input)
    .output(workspaceContracts.create.output)
    .mutation(({ ctx, input }) => workspaceHandlers.create({ ctx, input })),
  update: workspaceProcedure("workspace", "update")
    .use(general)
    .input(workspaceContracts.update.input)
    .output(workspaceContracts.update.output)
    .mutation(({ ctx, input }) => workspaceHandlers.update({ ctx, input })),
  members: workspaceProcedure("member", "read")
    .use(general)
    .output(workspaceContracts.members.output)
    .query(({ ctx }) => workspaceHandlers.members({ ctx })),
  invite: workspaceProcedure("member", "create")
    .use(general)
    .input(workspaceContracts.invite.input)
    .output(workspaceContracts.invite.output)
    .mutation(({ ctx, input }) => workspaceHandlers.invite({ ctx, input })),
  setRole: workspaceProcedure("member", "update")
    .use(general)
    .input(workspaceContracts.setRole.input)
    .output(workspaceContracts.setRole.output)
    .mutation(({ ctx, input }) => workspaceHandlers.setRole({ ctx, input })),
  removeMember: workspaceProcedure("member", "delete")
    .use(general)
    .input(workspaceContracts.removeMember.input)
    .output(workspaceContracts.removeMember.output)
    .mutation(({ ctx, input }) => workspaceHandlers.removeMember({ ctx, input })),
});

export const channelRouter = router({
  list: workspaceProcedure("channel", "read")
    .use(general)
    .output(channelContracts.list.output)
    .query(({ ctx, input }) => channelHandlers.list({ ctx, input })),
  get: workspaceProcedure("channel", "read")
    .use(general)
    .input(channelContracts.get.input)
    .output(channelContracts.get.output)
    .query(({ ctx, input }) => channelHandlers.get({ ctx, input })),
  connectPublic: workspaceProcedure("channel", "create")
    .use(general)
    .input(channelContracts.connectPublic.input)
    .output(channelContracts.connectPublic.output)
    .mutation(({ ctx, input }) => channelHandlers.connectPublic({ ctx, input })),
  sync: workspaceProcedure("channel", "update")
    .use(general)
    .input(channelContracts.sync.input)
    .output(channelContracts.sync.output)
    .mutation(({ ctx, input }) => channelHandlers.sync({ ctx, input })),
  updateNiche: workspaceProcedure("channel", "update")
    .use(general)
    .input(channelContracts.updateNiche.input)
    .output(channelContracts.updateNiche.output)
    .mutation(({ ctx, input }) => channelHandlers.updateNiche({ ctx, input })),
  disconnect: workspaceProcedure("channel", "delete")
    .use(general)
    .input(channelContracts.disconnect.input)
    .output(channelContracts.disconnect.output)
    .mutation(({ ctx, input }) => channelHandlers.disconnect({ ctx, input })),
});

export const avatarRouter = router({
  get: workspaceProcedure("avatar", "read")
    .use(general)
    .input(avatarContracts.get.input)
    .output(avatarContracts.get.output)
    .query(({ ctx, input }) => avatarHandlers.get({ ctx, input })),
  update: workspaceProcedure("avatar", "update")
    .use(general)
    .input(avatarContracts.update.input)
    .output(avatarContracts.update.output)
    .mutation(({ ctx, input }) => avatarHandlers.update({ ctx, input })),
  regenerate: workspaceProcedure("avatar", "update")
    .use(general)
    .use(generation)
    .input(avatarContracts.regenerate.input)
    .output(avatarContracts.regenerate.output)
    .mutation(({ ctx, input }) => avatarHandlers.regenerate({ ctx, input })),
});

// voiceProfile — read-only list for the editor's per-section voice picker
// (multi-voice, PRODUCT-CONTRACTS §7).
export const voiceProfileRouter = router({
  list: workspaceProcedure("voiceProfile", "read")
    .use(general)
    .input(voiceProfileContracts.list.input)
    .output(voiceProfileContracts.list.output)
    .query((opts) => voiceProfileImpl.list(opts)),
});

// voice — Wave D (WAVE-D-PLAN §2c): train_on_my_channel StyleCard derivation.
// D0 CONTRACT STUB: returns a plausible trained voice profile (fixture); D2
// wires the real consent-gated transcript→LLM derivation + persistence.
// Generation-class (the strict policy stands so D2's LLM cost is gated).
export const voiceRouter = router({
  trainFromChannel: workspaceProcedure("voiceProfile", "create")
    .use(general)
    .use(generation)
    .input(voiceContracts.trainFromChannel.input)
    .output(voiceContracts.trainFromChannel.output)
    .mutation((opts) => voiceImpl.trainFromChannel(opts)),
});

// chat — Wave D (WAVE-D-PLAN §2a): chat-first surface. D0 CONTRACT STUBS
// (fixture-returning); D1 wires real thread storage, streamed replies, and
// tool proposal→confirm→staged-pipeline execution. Zero-cost by contract —
// the credit-costing happens inside tool execution (D1), never here.
export const chatRouter = router({
  listThreads: workspaceProcedure("chat", "read")
    .use(general)
    .input(chatContracts.listThreads.input)
    .output(chatContracts.listThreads.output)
    .query((opts) => chatImpl.listThreads(opts)),
  getThread: workspaceProcedure("chat", "read")
    .use(general)
    .input(chatContracts.getThread.input)
    .output(chatContracts.getThread.output)
    .query((opts) => chatImpl.getThread(opts)),
  createThread: workspaceProcedure("chat", "create")
    .use(general)
    .input(chatContracts.createThread.input)
    .output(chatContracts.createThread.output)
    .mutation((opts) => chatImpl.createThread(opts)),
  sendMessage: workspaceProcedure("chat", "create")
    .use(general)
    .input(chatContracts.sendMessage.input)
    .output(chatContracts.sendMessage.output)
    .mutation((opts) => chatImpl.sendMessage(opts)),
  confirmTool: workspaceProcedure("chat", "create")
    .use(general)
    .input(chatContracts.confirmTool.input)
    .output(chatContracts.confirmTool.output)
    .mutation((opts) => chatImpl.confirmTool(opts)),
  renameThread: workspaceProcedure("chat", "update")
    .use(general)
    .input(chatContracts.renameThread.input)
    .output(chatContracts.renameThread.output)
    .mutation((opts) => chatImpl.renameThread(opts)),
  deleteThread: workspaceProcedure("chat", "delete")
    .use(general)
    .input(chatContracts.deleteThread.input)
    .output(chatContracts.deleteThread.output)
    .mutation((opts) => chatImpl.deleteThread(opts)),
});

// ideas — B1 (server/routers/impl/ideas.ts): outlier index §5.3 + daily feed §5.4
export const ideasRouter = router({
  feed: workspaceProcedure("idea", "read")
    .use(general)
    .input(ideasContracts.feed.input)
    .output(ideasContracts.feed.output)
    .query(({ ctx, input }) => ideasHandlers.feed({ ctx, input })),
  save: workspaceProcedure("idea", "update")
    .use(general)
    .input(ideasContracts.save.input)
    .output(ideasContracts.save.output)
    .mutation(({ ctx, input }) => ideasHandlers.save({ ctx, input })),
  dismiss: workspaceProcedure("idea", "update")
    .use(general)
    .input(ideasContracts.dismiss.input)
    .output(ideasContracts.dismiss.output)
    .mutation(({ ctx, input }) => ideasHandlers.dismiss({ ctx, input })),
  promote: workspaceProcedure("idea", "update")
    .use(general)
    .input(ideasContracts.promote.input)
    .output(ideasContracts.promote.output)
    .mutation(({ ctx, input }) => ideasHandlers.promote({ ctx, input })),
  requestBatch: workspaceProcedure("idea", "create")
    .use(general)
    .use(generation)
    .input(ideasContracts.requestBatch.input)
    .output(ideasContracts.requestBatch.output)
    .mutation(({ ctx, input }) => ideasHandlers.requestBatch({ ctx, input })),
});

export const projectRouter = router({
  list: workspaceProcedure("project", "read")
    .use(general)
    .input(projectContracts.list.input)
    .output(projectContracts.list.output)
    .query(({ ctx, input }) => projectHandlers.list({ ctx, input })),
  get: workspaceProcedure("project", "read")
    .use(general)
    .input(projectContracts.get.input)
    .output(projectContracts.get.output)
    .query(({ ctx, input }) => projectHandlers.get({ ctx, input })),
  create: workspaceProcedure("project", "create")
    .use(general)
    .input(projectContracts.create.input)
    .output(projectContracts.create.output)
    .mutation(({ ctx, input }) => projectHandlers.create({ ctx, input })),
  update: workspaceProcedure("project", "update")
    .use(general)
    .input(projectContracts.update.input)
    .output(projectContracts.update.output)
    .mutation(({ ctx, input }) => projectHandlers.update({ ctx, input })),
  archive: workspaceProcedure("project", "delete")
    .use(general)
    .input(projectContracts.archive.input)
    .output(projectContracts.archive.output)
    .mutation(({ ctx, input }) => projectHandlers.archive({ ctx, input })),
  setGenerationTarget: workspaceProcedure("project", "update")
    .use(general)
    .input(projectContracts.setGenerationTarget.input)
    .output(projectContracts.setGenerationTarget.output)
    .mutation(({ ctx, input }) => projectHandlers.setGenerationTarget({ ctx, input })),
});

export const researchRouter = router({
  list: workspaceProcedure("research", "read")
    .use(general)
    .input(researchContracts.list.input)
    .output(researchContracts.list.output)
    .query((opts) => researchImpl.list(opts)),
  get: workspaceProcedure("research", "read")
    .use(general)
    .input(researchContracts.get.input)
    .output(researchContracts.get.output)
    .query((opts) => researchImpl.get(opts)),
  search: workspaceProcedure("research", "create")
    .use(general)
    .use(generation)
    .input(researchContracts.search.input)
    .output(researchContracts.search.output)
    .mutation((opts) => researchImpl.search(opts)),
  importTranscript: workspaceProcedure("research", "create")
    .use(general)
    .input(researchContracts.importTranscript.input)
    .output(researchContracts.importTranscript.output)
    .mutation((opts) => researchImpl.importTranscript(opts)),
  upload: workspaceProcedure("research", "create")
    .use(general)
    .input(researchContracts.upload.input)
    .output(researchContracts.upload.output)
    .mutation((opts) => researchImpl.upload(opts)),
  remove: workspaceProcedure("research", "delete")
    .use(general)
    .input(researchContracts.remove.input)
    .output(researchContracts.remove.output)
    .mutation((opts) => researchImpl.remove(opts)),
});

export const frameRouter = router({
  list: workspaceProcedure("frame", "read")
    .use(general)
    .input(frameContracts.list.input)
    .output(frameContracts.list.output)
    .query((opts) => frameImpl.list(opts)),
  propose: workspaceProcedure("frame", "create")
    .use(general)
    .use(generation)
    .input(frameContracts.propose.input)
    .output(frameContracts.propose.output)
    .mutation((opts) => frameImpl.propose(opts)),
  choose: workspaceProcedure("frame", "update")
    .use(general)
    .input(frameContracts.choose.input)
    .output(frameContracts.choose.output)
    .mutation((opts) => frameImpl.choose(opts)),
  update: workspaceProcedure("frame", "update")
    .use(general)
    .input(frameContracts.update.input)
    .output(frameContracts.update.output)
    .mutation((opts) => frameImpl.update(opts)),
});

export const scriptRouter = router({
  /**
   * COMPOSITE generation (wave-C contract note, PRODUCT-CONTRACTS §4):
   * `generate` remains for MCP/one-click use and BECOMES AN ORCHESTRATOR
   * over the staged procedures below — outline (1cr) + hooks (1cr) +
   * draft (4cr) in order, summed cost 6, itemized ledger entries; it may
   * not bypass stage metering. C1 implements the orchestration; the frozen
   * signature is unchanged apart from the additive `generation` param.
   */
  generate: workspaceProcedure("script", "create")
    .use(general)
    .use(generation)
    .input(scriptContracts.generate.input)
    .output(scriptContracts.generate.output)
    .mutation((opts) => scriptImpl.generate(opts)),
  // -- staged, individually metered procedures (PRODUCT-CONTRACTS §4) ------
  topics: workspaceProcedure("script", "create")
    .use(general)
    .use(generation)
    .input(scriptContracts.topics.input)
    .output(scriptContracts.topics.output)
    .mutation((opts) => scriptStagesImpl.topics(opts)),
  outline: workspaceProcedure("script", "create")
    .use(general)
    .use(generation)
    .input(scriptContracts.outline.input)
    .output(scriptContracts.outline.output)
    .mutation((opts) => scriptStagesImpl.outline(opts)),
  hooks: workspaceProcedure("script", "create")
    .use(general)
    .use(generation)
    .input(scriptContracts.hooks.input)
    .output(scriptContracts.hooks.output)
    .mutation((opts) => scriptStagesImpl.hooks(opts)),
  draft: workspaceProcedure("script", "create")
    .use(general)
    .use(generation)
    .input(scriptContracts.draft.input)
    .output(scriptContracts.draft.output)
    .mutation((opts) => scriptStagesImpl.draft(opts)),
  get: workspaceProcedure("script", "read")
    .use(general)
    .input(scriptContracts.get.input)
    .output(scriptContracts.get.output)
    .query((opts) => scriptImpl.get(opts)),
  listVersions: workspaceProcedure("script", "read")
    .use(general)
    .input(scriptContracts.listVersions.input)
    .output(scriptContracts.listVersions.output)
    .query((opts) => scriptImpl.listVersions(opts)),
  updateSection: workspaceProcedure("script", "update")
    .use(general)
    .input(scriptContracts.updateSection.input)
    .output(scriptContracts.updateSection.output)
    .mutation((opts) => scriptImpl.updateSection(opts)),
  regenerateSection: workspaceProcedure("script", "update")
    .use(general)
    .use(generation)
    .input(scriptContracts.regenerateSection.input)
    .output(scriptContracts.regenerateSection.output)
    .mutation((opts) => scriptImpl.regenerateSection(opts)),
  setSectionLock: workspaceProcedure("script", "update")
    .use(general)
    .input(scriptContracts.setSectionLock.input)
    .output(scriptContracts.setSectionLock.output)
    .mutation((opts) => scriptImpl.setSectionLock(opts)),
  setSectionVoice: workspaceProcedure("script", "update")
    .use(general)
    .input(scriptContracts.setSectionVoice.input)
    .output(scriptContracts.setSectionVoice.output)
    .mutation((opts) => scriptImpl.setSectionVoice(opts)),
  reorderSections: workspaceProcedure("script", "update")
    .use(general)
    .input(scriptContracts.reorderSections.input)
    .output(scriptContracts.reorderSections.output)
    .mutation((opts) => scriptImpl.reorderSections(opts)),
  export: workspaceProcedure("script", "read")
    .use(general)
    .input(scriptContracts.export.input)
    .output(scriptContracts.export.output)
    .query((opts) => scriptImpl.export(opts)),
});

export const revisionRouter = router({
  run: workspaceProcedure("revision", "create")
    .use(general)
    .use(generation)
    .input(revisionContracts.run.input)
    .output(revisionContracts.run.output)
    .mutation((opts) => revisionImpl.run(opts)),
  list: workspaceProcedure("revision", "read")
    .use(general)
    .input(revisionContracts.list.input)
    .output(revisionContracts.list.output)
    .query((opts) => revisionImpl.list(opts)),
  accept: workspaceProcedure("revision", "update")
    .use(general)
    .input(revisionContracts.accept.input)
    .output(revisionContracts.accept.output)
    .mutation((opts) => revisionImpl.accept(opts)),
  reject: workspaceProcedure("revision", "update")
    .use(general)
    .input(revisionContracts.reject.input)
    .output(revisionContracts.reject.output)
    .mutation((opts) => revisionImpl.reject(opts)),
});

export const titlesRouter = router({
  generate: workspaceProcedure("titles", "create")
    .use(general)
    .use(generation)
    .input(titlesContracts.generate.input)
    .output(titlesContracts.generate.output)
    .mutation((opts) => titlesImpl.generate(opts)),
  latest: workspaceProcedure("titles", "read")
    .use(general)
    .input(titlesContracts.latest.input)
    .output(titlesContracts.latest.output)
    .query((opts) => titlesImpl.latest(opts)),
});

// thumbnails — B4 (server/routers/impl/thumbnails.ts): image generation §5.10
export const thumbnailsRouter = router({
  generate: workspaceProcedure("thumbnail", "create")
    .use(general)
    .use(generation)
    .input(thumbnailsContracts.generate.input)
    .output(thumbnailsContracts.generate.output)
    .mutation((opts) => thumbnailsImpl.generate(opts)),
  list: workspaceProcedure("thumbnail", "read")
    .use(general)
    .input(thumbnailsContracts.list.input)
    .output(thumbnailsContracts.list.output)
    .query((opts) => thumbnailsImpl.list(opts)),
  choose: workspaceProcedure("thumbnail", "update")
    .use(general)
    .input(thumbnailsContracts.choose.input)
    .output(thumbnailsContracts.choose.output)
    .mutation((opts) => thumbnailsImpl.choose(opts)),
});

export const descriptionRouter = router({
  generate: workspaceProcedure("description", "create")
    .use(general)
    .use(generation)
    .input(descriptionContracts.generate.input)
    .output(descriptionContracts.generate.output)
    .mutation(({ ctx, input }) => descriptionHandlers.generate({ ctx, input })),
  list: workspaceProcedure("description", "read")
    .use(general)
    .input(descriptionContracts.list.input)
    .output(descriptionContracts.list.output)
    .query(({ ctx, input }) => descriptionHandlers.list({ ctx, input })),
  update: workspaceProcedure("description", "update")
    .use(general)
    .input(descriptionContracts.update.input)
    .output(descriptionContracts.update.output)
    .mutation(({ ctx, input }) => descriptionHandlers.update({ ctx, input })),
});

export const tagsRouter = router({
  generate: workspaceProcedure("tags", "create")
    .use(general)
    .use(generation)
    .input(tagsContracts.generate.input)
    .output(tagsContracts.generate.output)
    .mutation(({ ctx, input }) => tagsHandlers.generate({ ctx, input })),
  latest: workspaceProcedure("tags", "read")
    .use(general)
    .input(tagsContracts.latest.input)
    .output(tagsContracts.latest.output)
    .query(({ ctx, input }) => tagsHandlers.latest({ ctx, input })),
  update: workspaceProcedure("tags", "update")
    .use(general)
    .input(tagsContracts.update.input)
    .output(tagsContracts.update.output)
    .mutation(({ ctx, input }) => tagsHandlers.update({ ctx, input })),
});

export const chaptersRouter = router({
  derive: workspaceProcedure("chapters", "create")
    .use(general)
    .input(chaptersContracts.derive.input)
    .output(chaptersContracts.derive.output)
    .mutation(({ ctx, input }) => chaptersHandlers.derive({ ctx, input })),
  latest: workspaceProcedure("chapters", "read")
    .use(general)
    .input(chaptersContracts.latest.input)
    .output(chaptersContracts.latest.output)
    .query(({ ctx, input }) => chaptersHandlers.latest({ ctx, input })),
  update: workspaceProcedure("chapters", "update")
    .use(general)
    .input(chaptersContracts.update.input)
    .output(chaptersContracts.update.output)
    .mutation(({ ctx, input }) => chaptersHandlers.update({ ctx, input })),
});

// templates — B4 (server/routers/impl/templates.ts): admin-managed, writer-used
export const templatesRouter = router({
  list: workspaceProcedure("template", "read")
    .use(general)
    .input(templatesContracts.list.input)
    .output(templatesContracts.list.output)
    .query((opts) => templatesImpl.list(opts)),
  create: workspaceProcedure("template", "create")
    .use(general)
    .input(templatesContracts.create.input)
    .output(templatesContracts.create.output)
    .mutation((opts) => templatesImpl.create(opts)),
  update: workspaceProcedure("template", "update")
    .use(general)
    .input(templatesContracts.update.input)
    .output(templatesContracts.update.output)
    .mutation((opts) => templatesImpl.update(opts)),
  remove: workspaceProcedure("template", "delete")
    .use(general)
    .input(templatesContracts.remove.input)
    .output(templatesContracts.remove.output)
    .mutation((opts) => templatesImpl.remove(opts)),
});

export const dashboardRouter = router({
  overview: workspaceProcedure("dashboard", "read")
    .use(general)
    .output(dashboardContracts.overview.output)
    .query(({ ctx, input }) => dashboardHandlers.overview({ ctx, input })),
  tracking: workspaceProcedure("dashboard", "read")
    .use(general)
    .input(dashboardContracts.tracking.input)
    .output(dashboardContracts.tracking.output)
    .query(({ ctx, input }) => dashboardHandlers.tracking({ ctx, input })),
});

export const billingRouter = router({
  summary: workspaceProcedure("billing", "read")
    .use(general)
    .output(billingContracts.summary.output)
    .query(({ ctx }) => billingHandlers.summary({ ctx })),
  // checkout/portal — B3 (impl/billing.ts): live Stripe when STRIPE_SECRET_KEY
  // is set; the handlers keep the exact fixture URLs when it is not.
  checkout: workspaceProcedure("billing", "update")
    .use(general)
    .input(billingContracts.checkout.input)
    .output(billingContracts.checkout.output)
    .mutation(({ ctx, input }) => billingHandlers.checkout({ ctx, input })),
  portal: workspaceProcedure("billing", "update")
    .use(general)
    .input(billingContracts.portal.input)
    .output(billingContracts.portal.output)
    .mutation(({ ctx }) => billingHandlers.portal({ ctx })),
});

// archetypes — wave C (server/routers/impl/archetypes.ts): seeded catalog,
// readable by any workspace member, never charged, never written by clients.
export const archetypesRouter = router({
  list: workspaceProcedure("archetype", "read")
    .use(general)
    .output(archetypesContracts.list.output)
    .query(() => archetypesImpl.list()),
});

// apiKeys — B2 (server/routers/impl/apiKeys.ts): hashed show-once MCP keys
export const apiKeysRouter = router({
  list: workspaceProcedure("apiKey", "read")
    .use(general)
    .input(apiKeysContracts.list.input)
    .output(apiKeysContracts.list.output)
    .query(({ ctx, input }) => apiKeysImpl.list({ ctx, input })),
  create: workspaceProcedure("apiKey", "create")
    .use(general)
    .input(apiKeysContracts.create.input)
    .output(apiKeysContracts.create.output)
    .mutation(({ ctx, input }) => apiKeysImpl.create({ ctx, input })),
  revoke: workspaceProcedure("apiKey", "delete")
    .use(general)
    .input(apiKeysContracts.revoke.input)
    .output(apiKeysContracts.revoke.output)
    .mutation(({ ctx, input }) => apiKeysImpl.revoke({ ctx, input })),
});
