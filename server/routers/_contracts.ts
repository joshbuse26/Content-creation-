import {
  apiKeysContracts,
  avatarContracts,
  billingContracts,
  channelContracts,
  chaptersContracts,
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
  workspaceContracts,
} from "@/lib/types/api";
import {
  FIXTURE_IDS,
  fixtureApiKey,
  fixtureAvatar,
  fixtureChannel,
  fixtureChapterSet,
  fixtureDescription,
  fixtureDescriptionTemplate,
  fixtureFrame,
  fixtureIdea,
  fixtureLedgerEntry,
  fixtureMembership,
  fixturePipelineRun,
  fixtureProject,
  fixtureQualityReport,
  fixtureResearchDoc,
  fixtureRevision,
  fixtureScript,
  fixtureSections,
  fixtureSnapshot,
  fixtureTagSet,
  fixtureThumbnailConcept,
  fixtureTitleSet,
  fixtureUser,
  fixtureWorkspace,
} from "@/lib/fixtures";
import { protectedProcedure, router, workspaceProcedure } from "@/server/trpc";

/**
 * ROUTER CONTRACTS — FROZEN LAYER (sprint plan §2).
 *
 * Every router signature from build spec §6, with stub implementations
 * returning fixtures. Wave-2 agents REPLACE the bodies behind unchanged
 * signatures — inputs/outputs live in lib/types/api.ts and do not move.
 *
 * Every workspace-scoped procedure runs through workspaceProcedure(), which
 * enforces assertAccess (role matrix) before the handler executes. Outputs
 * are schema-validated, so a stub that drifts from its contract throws.
 */

const queued = { pipelineRunIds: [FIXTURE_IDS.pipelineRun], status: "queued" as const };

// ---------------------------------------------------------------------------

export const workspaceRouter = router({
  list: protectedProcedure
    .input(workspaceContracts.list.input)
    .output(workspaceContracts.list.output)
    .query(() => [{ ...fixtureWorkspace, role: "owner" as const }]),
  get: workspaceProcedure("workspace", "read")
    .output(workspaceContracts.get.output)
    .query(() => fixtureWorkspace),
  create: protectedProcedure
    .input(workspaceContracts.create.input)
    .output(workspaceContracts.create.output)
    .mutation(({ input }) => ({ ...fixtureWorkspace, name: input.name })),
  update: workspaceProcedure("workspace", "update")
    .input(workspaceContracts.update.input)
    .output(workspaceContracts.update.output)
    .mutation(({ input }) => ({ ...fixtureWorkspace, name: input.name })),
  members: workspaceProcedure("member", "read")
    .output(workspaceContracts.members.output)
    .query(() => [{ ...fixtureMembership, user: fixtureUser }]),
  invite: workspaceProcedure("member", "create")
    .input(workspaceContracts.invite.input)
    .output(workspaceContracts.invite.output)
    .mutation(({ input }) => ({ ...fixtureMembership, role: input.role })),
  setRole: workspaceProcedure("member", "update")
    .input(workspaceContracts.setRole.input)
    .output(workspaceContracts.setRole.output)
    .mutation(({ input }) => ({ ...fixtureMembership, role: input.role })),
  removeMember: workspaceProcedure("member", "delete")
    .input(workspaceContracts.removeMember.input)
    .output(workspaceContracts.removeMember.output)
    .mutation(() => ({ removed: true })),
});

export const channelRouter = router({
  list: workspaceProcedure("channel", "read")
    .output(channelContracts.list.output)
    .query(() => [fixtureChannel]),
  get: workspaceProcedure("channel", "read")
    .input(channelContracts.get.input)
    .output(channelContracts.get.output)
    .query(() => ({ ...fixtureChannel, latestSnapshot: fixtureSnapshot })),
  connectPublic: workspaceProcedure("channel", "create")
    .input(channelContracts.connectPublic.input)
    .output(channelContracts.connectPublic.output)
    .mutation(({ input }) => ({ ...fixtureChannel, nicheKeywords: input.nicheKeywords })),
  sync: workspaceProcedure("channel", "update")
    .input(channelContracts.sync.input)
    .output(channelContracts.sync.output)
    .mutation(() => queued),
  updateNiche: workspaceProcedure("channel", "update")
    .input(channelContracts.updateNiche.input)
    .output(channelContracts.updateNiche.output)
    .mutation(({ input }) => ({ ...fixtureChannel, nicheKeywords: input.nicheKeywords })),
  disconnect: workspaceProcedure("channel", "delete")
    .input(channelContracts.disconnect.input)
    .output(channelContracts.disconnect.output)
    .mutation(() => ({ removed: true })),
});

export const avatarRouter = router({
  get: workspaceProcedure("avatar", "read")
    .input(avatarContracts.get.input)
    .output(avatarContracts.get.output)
    .query(() => fixtureAvatar),
  update: workspaceProcedure("avatar", "update")
    .input(avatarContracts.update.input)
    .output(avatarContracts.update.output)
    .mutation(({ ctx, input }) => ({
      ...fixtureAvatar,
      ...(input.fields.vocabularyNotes !== undefined
        ? { vocabularyNotes: input.fields.vocabularyNotes }
        : {}),
      lastEditedBy: ctx.userId,
    })),
  regenerate: workspaceProcedure("avatar", "update")
    .input(avatarContracts.regenerate.input)
    .output(avatarContracts.regenerate.output)
    .mutation(() => queued),
});

export const ideasRouter = router({
  feed: workspaceProcedure("idea", "read")
    .input(ideasContracts.feed.input)
    .output(ideasContracts.feed.output)
    .query(() => [fixtureIdea]),
  save: workspaceProcedure("idea", "update")
    .input(ideasContracts.save.input)
    .output(ideasContracts.save.output)
    .mutation(() => ({ ...fixtureIdea, status: "saved" as const })),
  dismiss: workspaceProcedure("idea", "update")
    .input(ideasContracts.dismiss.input)
    .output(ideasContracts.dismiss.output)
    .mutation(() => ({ ...fixtureIdea, status: "dismissed" as const })),
  promote: workspaceProcedure("idea", "update")
    .input(ideasContracts.promote.input)
    .output(ideasContracts.promote.output)
    .mutation(() => ({
      idea: { ...fixtureIdea, status: "promoted" as const },
      project: fixtureProject,
    })),
  requestBatch: workspaceProcedure("idea", "create")
    .input(ideasContracts.requestBatch.input)
    .output(ideasContracts.requestBatch.output)
    .mutation(() => queued),
});

export const projectRouter = router({
  list: workspaceProcedure("project", "read")
    .input(projectContracts.list.input)
    .output(projectContracts.list.output)
    .query(() => [fixtureProject]),
  get: workspaceProcedure("project", "read")
    .input(projectContracts.get.input)
    .output(projectContracts.get.output)
    .query(() => fixtureProject),
  create: workspaceProcedure("project", "create")
    .input(projectContracts.create.input)
    .output(projectContracts.create.output)
    .mutation(({ input }) => ({ ...fixtureProject, title: input.title, ideaId: input.ideaId })),
  update: workspaceProcedure("project", "update")
    .input(projectContracts.update.input)
    .output(projectContracts.update.output)
    .mutation(({ input }) => ({
      ...fixtureProject,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    })),
  archive: workspaceProcedure("project", "delete")
    .input(projectContracts.archive.input)
    .output(projectContracts.archive.output)
    .mutation(() => ({ archived: true })),
});

export const researchRouter = router({
  list: workspaceProcedure("research", "read")
    .input(researchContracts.list.input)
    .output(researchContracts.list.output)
    .query(() => {
      const { content: _content, ...meta } = fixtureResearchDoc;
      return [meta];
    }),
  get: workspaceProcedure("research", "read")
    .input(researchContracts.get.input)
    .output(researchContracts.get.output)
    .query(() => fixtureResearchDoc),
  search: workspaceProcedure("research", "create")
    .input(researchContracts.search.input)
    .output(researchContracts.search.output)
    .mutation(() => queued),
  importTranscript: workspaceProcedure("research", "create")
    .input(researchContracts.importTranscript.input)
    .output(researchContracts.importTranscript.output)
    .mutation(({ input }) => ({
      ...fixtureResearchDoc,
      kind: "transcript" as const,
      sourceUrl: input.youtubeVideoUrl,
    })),
  upload: workspaceProcedure("research", "create")
    .input(researchContracts.upload.input)
    .output(researchContracts.upload.output)
    .mutation(({ input }) => ({
      ...fixtureResearchDoc,
      kind: input.kind,
      title: input.filename,
      sourceUrl: null,
    })),
  remove: workspaceProcedure("research", "delete")
    .input(researchContracts.remove.input)
    .output(researchContracts.remove.output)
    .mutation(() => ({ removed: true })),
});

export const frameRouter = router({
  list: workspaceProcedure("frame", "read")
    .input(frameContracts.list.input)
    .output(frameContracts.list.output)
    .query(() => [fixtureFrame]),
  propose: workspaceProcedure("frame", "create")
    .input(frameContracts.propose.input)
    .output(frameContracts.propose.output)
    .mutation(() => queued),
  choose: workspaceProcedure("frame", "update")
    .input(frameContracts.choose.input)
    .output(frameContracts.choose.output)
    .mutation(() => ({ ...fixtureFrame, chosen: true })),
  update: workspaceProcedure("frame", "update")
    .input(frameContracts.update.input)
    .output(frameContracts.update.output)
    .mutation(({ input }) => ({ ...fixtureFrame, ...input.fields })),
});

export const scriptRouter = router({
  generate: workspaceProcedure("script", "create")
    .input(scriptContracts.generate.input)
    .output(scriptContracts.generate.output)
    .mutation(() => ({ ...queued, scriptId: fixtureScript.id })),
  get: workspaceProcedure("script", "read")
    .input(scriptContracts.get.input)
    .output(scriptContracts.get.output)
    .query(() => ({
      script: fixtureScript,
      sections: fixtureSections,
      qualityReport: fixtureQualityReport,
    })),
  listVersions: workspaceProcedure("script", "read")
    .input(scriptContracts.listVersions.input)
    .output(scriptContracts.listVersions.output)
    .query(() => [fixtureScript]),
  updateSection: workspaceProcedure("script", "update")
    .input(scriptContracts.updateSection.input)
    .output(scriptContracts.updateSection.output)
    .mutation(({ input }) => {
      const section = fixtureSections[0];
      if (section === undefined) throw new Error("fixture sections empty");
      return {
        ...section,
        ...(input.heading !== undefined ? { heading: input.heading } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
      };
    }),
  regenerateSection: workspaceProcedure("script", "update")
    .input(scriptContracts.regenerateSection.input)
    .output(scriptContracts.regenerateSection.output)
    .mutation(() => queued),
  setSectionLock: workspaceProcedure("script", "update")
    .input(scriptContracts.setSectionLock.input)
    .output(scriptContracts.setSectionLock.output)
    .mutation(({ input }) => {
      const section = fixtureSections[0];
      if (section === undefined) throw new Error("fixture sections empty");
      return { ...section, locked: input.locked };
    }),
  export: workspaceProcedure("script", "read")
    .input(scriptContracts.export.input)
    .output(scriptContracts.export.output)
    .query(({ input }) => ({
      filename: `script-v${fixtureScript.version}.${input.format === "teleprompter" ? "txt" : input.format}`,
      mimeType:
        input.format === "docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "text/plain",
      content: fixtureSections.map((s) => `${s.heading}\n\n${s.body}`).join("\n\n---\n\n"),
      encoding: "utf8" as const,
    })),
});

export const revisionRouter = router({
  run: workspaceProcedure("revision", "create")
    .input(revisionContracts.run.input)
    .output(revisionContracts.run.output)
    .mutation(() => queued),
  list: workspaceProcedure("revision", "read")
    .input(revisionContracts.list.input)
    .output(revisionContracts.list.output)
    .query(() => [fixtureRevision]),
  accept: workspaceProcedure("revision", "update")
    .input(revisionContracts.accept.input)
    .output(revisionContracts.accept.output)
    .mutation(() => {
      const section = fixtureSections[1];
      if (section === undefined) throw new Error("fixture sections empty");
      return { revision: { ...fixtureRevision, status: "accepted" as const }, section };
    }),
  reject: workspaceProcedure("revision", "update")
    .input(revisionContracts.reject.input)
    .output(revisionContracts.reject.output)
    .mutation(() => ({ ...fixtureRevision, status: "rejected" as const })),
});

export const titlesRouter = router({
  generate: workspaceProcedure("titles", "create")
    .input(titlesContracts.generate.input)
    .output(titlesContracts.generate.output)
    .mutation(() => queued),
  latest: workspaceProcedure("titles", "read")
    .input(titlesContracts.latest.input)
    .output(titlesContracts.latest.output)
    .query(() => fixtureTitleSet),
});

export const thumbnailsRouter = router({
  generate: workspaceProcedure("thumbnail", "create")
    .input(thumbnailsContracts.generate.input)
    .output(thumbnailsContracts.generate.output)
    .mutation(() => queued),
  list: workspaceProcedure("thumbnail", "read")
    .input(thumbnailsContracts.list.input)
    .output(thumbnailsContracts.list.output)
    .query(() => [fixtureThumbnailConcept]),
  choose: workspaceProcedure("thumbnail", "update")
    .input(thumbnailsContracts.choose.input)
    .output(thumbnailsContracts.choose.output)
    .mutation(() => ({ ...fixtureThumbnailConcept, status: "chosen" as const })),
});

export const descriptionRouter = router({
  generate: workspaceProcedure("description", "create")
    .input(descriptionContracts.generate.input)
    .output(descriptionContracts.generate.output)
    .mutation(({ input }) => ({ ...fixtureDescription, mode: input.mode })),
  list: workspaceProcedure("description", "read")
    .input(descriptionContracts.list.input)
    .output(descriptionContracts.list.output)
    .query(() => [fixtureDescription]),
  update: workspaceProcedure("description", "update")
    .input(descriptionContracts.update.input)
    .output(descriptionContracts.update.output)
    .mutation(({ input }) => ({ ...fixtureDescription, body: input.body })),
});

export const tagsRouter = router({
  generate: workspaceProcedure("tags", "create")
    .input(tagsContracts.generate.input)
    .output(tagsContracts.generate.output)
    .mutation(() => fixtureTagSet),
  latest: workspaceProcedure("tags", "read")
    .input(tagsContracts.latest.input)
    .output(tagsContracts.latest.output)
    .query(() => fixtureTagSet),
  update: workspaceProcedure("tags", "update")
    .input(tagsContracts.update.input)
    .output(tagsContracts.update.output)
    .mutation(({ input }) => ({ ...fixtureTagSet, tags: input.tags })),
});

export const chaptersRouter = router({
  derive: workspaceProcedure("chapters", "create")
    .input(chaptersContracts.derive.input)
    .output(chaptersContracts.derive.output)
    .mutation(() => fixtureChapterSet),
  latest: workspaceProcedure("chapters", "read")
    .input(chaptersContracts.latest.input)
    .output(chaptersContracts.latest.output)
    .query(() => fixtureChapterSet),
  update: workspaceProcedure("chapters", "update")
    .input(chaptersContracts.update.input)
    .output(chaptersContracts.update.output)
    .mutation(({ input }) => ({ ...fixtureChapterSet, entries: input.entries })),
});

export const templatesRouter = router({
  list: workspaceProcedure("template", "read")
    .input(templatesContracts.list.input)
    .output(templatesContracts.list.output)
    .query(() => [fixtureDescriptionTemplate]),
  create: workspaceProcedure("template", "create")
    .input(templatesContracts.create.input)
    .output(templatesContracts.create.output)
    .mutation(({ input }) => ({
      ...fixtureDescriptionTemplate,
      name: input.name,
      body: input.body,
    })),
  update: workspaceProcedure("template", "update")
    .input(templatesContracts.update.input)
    .output(templatesContracts.update.output)
    .mutation(({ input }) => ({
      ...fixtureDescriptionTemplate,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
    })),
  remove: workspaceProcedure("template", "delete")
    .input(templatesContracts.remove.input)
    .output(templatesContracts.remove.output)
    .mutation(() => ({ removed: true })),
});

export const dashboardRouter = router({
  overview: workspaceProcedure("dashboard", "read")
    .output(dashboardContracts.overview.output)
    .query(() => ({
      creditBalance: fixtureWorkspace.creditBalance,
      projectCounts: { scripting: 1 },
      recentProjects: [fixtureProject],
      recentRuns: [fixturePipelineRun],
    })),
  tracking: workspaceProcedure("dashboard", "read")
    .input(dashboardContracts.tracking.input)
    .output(dashboardContracts.tracking.output)
    .query(() => [
      {
        project: fixtureProject,
        projectedScore: 87.5,
        actualViews: null,
        capturedAt: null,
      },
    ]),
});

export const billingRouter = router({
  summary: workspaceProcedure("billing", "read")
    .output(billingContracts.summary.output)
    .query(() => ({
      plan: fixtureWorkspace.plan,
      creditBalance: fixtureWorkspace.creditBalance,
      billingCycleAnchor: fixtureWorkspace.billingCycleAnchor,
      ledger: [fixtureLedgerEntry],
    })),
  checkout: workspaceProcedure("billing", "update")
    .input(billingContracts.checkout.input)
    .output(billingContracts.checkout.output)
    .mutation(({ input }) => ({
      checkoutUrl: `https://checkout.stripe.com/c/pay/fixture_${input.plan}`,
    })),
  portal: workspaceProcedure("billing", "update")
    .input(billingContracts.portal.input)
    .output(billingContracts.portal.output)
    .mutation(() => ({ portalUrl: "https://billing.stripe.com/p/session/fixture" })),
});

export const apiKeysRouter = router({
  list: workspaceProcedure("apiKey", "read")
    .input(apiKeysContracts.list.input)
    .output(apiKeysContracts.list.output)
    .query(() => [fixtureApiKey]),
  create: workspaceProcedure("apiKey", "create")
    .input(apiKeysContracts.create.input)
    .output(apiKeysContracts.create.output)
    .mutation(({ input }) => ({
      apiKey: { ...fixtureApiKey, scopes: input.scopes, channelIds: input.channelIds },
      secret: "gr_live_fixture_secret_shown_once",
    })),
  revoke: workspaceProcedure("apiKey", "delete")
    .input(apiKeysContracts.revoke.input)
    .output(apiKeysContracts.revoke.output)
    .mutation(() => ({ ...fixtureApiKey, revokedAt: new Date("2026-09-09T00:00:00.000Z") })),
});
