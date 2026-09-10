import { getDb, hasDb, schema } from "@/db";
import { ARCHETYPE_SEEDS } from "@/lib/archetypes";
import {
  FIXTURE_IDS,
  fixtureAvatar,
  fixtureChannel,
  fixtureChapterSet,
  fixtureDescription,
  fixtureDescriptionTemplate,
  fixtureFrame,
  fixtureIdea,
  fixturePipelineRun,
  fixtureProject,
  fixtureResearchDoc,
  fixtureScript,
  fixtureSections,
  fixtureSnapshot,
  fixtureTagSet,
  fixtureThumbnailConcept,
  fixtureTitleSet,
  fixtureUser,
  fixtureVoiceProfile,
  fixtureWorkspace,
} from "@/lib/fixtures";
import { buildThumbnailBrief, fixturePackagingContext } from "@/pipelines/packaging";

/**
 * Idempotent demo seed — `pnpm seed` (integrator: add
 * `"seed": "node --import tsx scripts/seed.ts"` to package.json scripts;
 * A4 cannot edit package.json). Direct run:
 *
 *   node --import tsx scripts/seed.ts
 *
 * Seeds the deterministic fixture dataset as real rows: workspace → user →
 * membership → channel (fixture/public mode) → avatar + voice profile → one
 * project taken all the way through the loop (idea, research, frame, script
 * with 6 sections, packaging outputs, pipeline run, credit ledger). All ids
 * are the stable FIXTURE_IDS, and every insert is ON CONFLICT DO NOTHING, so
 * re-running is a no-op.
 */

async function seed(): Promise<void> {
  if (!hasDb()) {
    console.error("seed: DATABASE_URL is not set. Set it (see .env.example) and re-run.");
    process.exitCode = 1;
    return;
  }
  const db = getDb();

  // Archetype catalog (wave C, PRODUCT-CONTRACTS §2) — global rows, all 12,
  // upserted so card/preset refinements reach existing databases. The same
  // objects back fixture mode (lib/archetypes.ts), so keyless and seeded
  // deployments show an identical catalog.
  for (const archetype of ARCHETYPE_SEEDS) {
    await db
      .insert(schema.archetypes)
      .values({
        id: archetype.id,
        displayName: archetype.displayName,
        pitch: archetype.pitch,
        styleCard: archetype.styleCard,
        thumbnailPreset: archetype.thumbnailPreset,
        sort: archetype.sort,
      })
      .onConflictDoUpdate({
        target: schema.archetypes.id,
        set: {
          displayName: archetype.displayName,
          pitch: archetype.pitch,
          styleCard: archetype.styleCard,
          thumbnailPreset: archetype.thumbnailPreset,
          sort: archetype.sort,
        },
      });
  }

  await db
    .insert(schema.workspaces)
    .values({
      id: fixtureWorkspace.id,
      name: fixtureWorkspace.name,
      plan: fixtureWorkspace.plan,
      creditBalance: fixtureWorkspace.creditBalance,
      billingCycleAnchor: fixtureWorkspace.billingCycleAnchor,
    })
    .onConflictDoNothing();

  await db
    .insert(schema.users)
    .values({
      id: fixtureUser.id,
      email: fixtureUser.email,
      name: fixtureUser.name,
      emailVerified: new Date("2026-09-01T12:00:00.000Z"),
    })
    .onConflictDoNothing();

  await db
    .insert(schema.memberships)
    .values({
      id: FIXTURE_IDS.membership,
      workspaceId: fixtureWorkspace.id,
      userId: fixtureUser.id,
      role: "owner",
    })
    .onConflictDoNothing();

  await db
    .insert(schema.channels)
    .values({
      id: fixtureChannel.id,
      workspaceId: fixtureChannel.workspaceId,
      mode: fixtureChannel.mode,
      youtubeChannelId: fixtureChannel.youtubeChannelId,
      title: fixtureChannel.title,
      handle: fixtureChannel.handle,
      nicheKeywords: fixtureChannel.nicheKeywords,
      syncStatus: fixtureChannel.syncStatus,
      lastSyncedAt: fixtureChannel.lastSyncedAt,
    })
    .onConflictDoNothing();

  await db
    .insert(schema.channelStatsSnapshots)
    .values({
      id: fixtureSnapshot.id,
      workspaceId: fixtureSnapshot.workspaceId,
      channelId: fixtureSnapshot.channelId,
      capturedAt: fixtureSnapshot.capturedAt,
      subs: fixtureSnapshot.subs,
      totalViews: fixtureSnapshot.totalViews,
      medianViews90d: fixtureSnapshot.medianViews90d,
    })
    .onConflictDoNothing();

  await db
    .insert(schema.audienceAvatars)
    .values({
      id: fixtureAvatar.id,
      workspaceId: fixtureAvatar.workspaceId,
      channelId: fixtureAvatar.channelId,
      ageRange: fixtureAvatar.ageRange,
      genderSplit: fixtureAvatar.genderSplit,
      geo: fixtureAvatar.geo,
      sophistication: fixtureAvatar.sophistication,
      pains: fixtureAvatar.pains,
      motivations: fixtureAvatar.motivations,
      vocabularyNotes: fixtureAvatar.vocabularyNotes,
      editableByUser: fixtureAvatar.editableByUser,
      aiGeneratedAt: fixtureAvatar.aiGeneratedAt,
    })
    .onConflictDoNothing();

  await db
    .insert(schema.voiceProfiles)
    .values({
      id: fixtureVoiceProfile.id,
      workspaceId: fixtureVoiceProfile.workspaceId,
      channelId: fixtureVoiceProfile.channelId,
      name: fixtureVoiceProfile.name,
      source: fixtureVoiceProfile.source,
      styleCard: fixtureVoiceProfile.styleCard,
    })
    .onConflictDoNothing();

  await db
    .insert(schema.ideas)
    .values({
      id: fixtureIdea.id,
      workspaceId: fixtureIdea.workspaceId,
      channelId: fixtureIdea.channelId,
      title: fixtureIdea.title,
      angle: fixtureIdea.angle,
      rationale: fixtureIdea.rationale,
      evidenceVideoIds: fixtureIdea.evidenceVideoIds,
      score: fixtureIdea.score.toFixed(2),
      status: "promoted",
      generatedOn: fixtureIdea.generatedOn,
    })
    .onConflictDoNothing();

  await db
    .insert(schema.projects)
    .values({
      id: fixtureProject.id,
      workspaceId: fixtureProject.workspaceId,
      channelId: fixtureProject.channelId,
      title: fixtureProject.title,
      status: "packaging",
      ideaId: fixtureProject.ideaId,
      targetPublishDate: fixtureProject.targetPublishDate,
    })
    .onConflictDoNothing();

  await db
    .insert(schema.researchDocs)
    .values({
      id: fixtureResearchDoc.id,
      workspaceId: fixtureResearchDoc.workspaceId,
      projectId: fixtureResearchDoc.projectId,
      kind: fixtureResearchDoc.kind,
      sourceUrl: fixtureResearchDoc.sourceUrl,
      title: fixtureResearchDoc.title,
      content: fixtureResearchDoc.content,
      wordCount: fixtureResearchDoc.wordCount,
      fetchedAt: fixtureResearchDoc.fetchedAt,
    })
    .onConflictDoNothing();

  await db
    .insert(schema.frames)
    .values({
      id: fixtureFrame.id,
      workspaceId: fixtureFrame.workspaceId,
      projectId: fixtureFrame.projectId,
      chosen: fixtureFrame.chosen,
      angle: fixtureFrame.angle,
      format: fixtureFrame.format,
      outcome: fixtureFrame.outcome,
      audienceSegment: fixtureFrame.audienceSegment,
      tone: fixtureFrame.tone,
      targetMinutes: fixtureFrame.targetMinutes,
      keywords: fixtureFrame.keywords,
    })
    .onConflictDoNothing();

  await db
    .insert(schema.scripts)
    .values({
      id: fixtureScript.id,
      workspaceId: fixtureScript.workspaceId,
      projectId: fixtureScript.projectId,
      version: fixtureScript.version,
      voiceProfileId: fixtureScript.voiceProfileId,
      status: "final",
      stats: fixtureScript.stats,
    })
    .onConflictDoNothing();

  for (const section of fixtureSections) {
    await db
      .insert(schema.scriptSections)
      .values({
        id: section.id,
        workspaceId: section.workspaceId,
        scriptId: section.scriptId,
        position: section.position,
        kind: section.kind,
        heading: section.heading,
        body: section.body,
        voiceProfileId: section.voiceProfileId,
        locked: section.locked,
        estSeconds: section.estSeconds,
        retentionNote: section.retentionNote,
        factRefs: section.factRefs,
      })
      .onConflictDoNothing();
  }

  // Packaging outputs — title set, description (+ template), tags, chapters,
  // and a thumbnail TEXT brief (image generation is cut to v1.1).
  await db
    .insert(schema.titleSets)
    .values({
      id: fixtureTitleSet.id,
      workspaceId: fixtureTitleSet.workspaceId,
      projectId: fixtureTitleSet.projectId,
      options: fixtureTitleSet.options,
    })
    .onConflictDoNothing();

  await db
    .insert(schema.descriptionTemplates)
    .values({
      id: fixtureDescriptionTemplate.id,
      workspaceId: fixtureDescriptionTemplate.workspaceId,
      name: fixtureDescriptionTemplate.name,
      body: fixtureDescriptionTemplate.body,
    })
    .onConflictDoNothing();

  await db
    .insert(schema.descriptions)
    .values({
      id: fixtureDescription.id,
      workspaceId: fixtureDescription.workspaceId,
      projectId: fixtureDescription.projectId,
      mode: fixtureDescription.mode,
      body: fixtureDescription.body,
      templateId: null,
    })
    .onConflictDoNothing();

  await db
    .insert(schema.tagSets)
    .values({
      id: fixtureTagSet.id,
      workspaceId: fixtureTagSet.workspaceId,
      projectId: fixtureTagSet.projectId,
      tags: fixtureTagSet.tags,
    })
    .onConflictDoNothing();

  await db
    .insert(schema.chapters)
    .values({
      id: fixtureChapterSet.id,
      workspaceId: fixtureChapterSet.workspaceId,
      projectId: fixtureChapterSet.projectId,
      entries: fixtureChapterSet.entries,
    })
    .onConflictDoNothing();

  await db
    .insert(schema.thumbnailConcepts)
    .values({
      id: fixtureThumbnailConcept.id,
      workspaceId: fixtureThumbnailConcept.workspaceId,
      projectId: fixtureThumbnailConcept.projectId,
      promptUsed: buildThumbnailBrief(fixturePackagingContext(), {
        compositionPattern: fixtureThumbnailConcept.compositionPattern,
        subjectDescription:
          "Creator holding a tiny espresso machine beside a gleaming prosumer rig",
      }),
      compositionPattern: fixtureThumbnailConcept.compositionPattern,
      imageKey: null,
      status: fixtureThumbnailConcept.status,
    })
    .onConflictDoNothing();

  // Pipeline run + credit ledger: +60 plan grant, -6 script generation.
  // Stored balance (54) matches SUM(delta) so the nightly reconciliation
  // reports zero drift on seeded data.
  await db
    .insert(schema.pipelineRuns)
    .values({
      id: fixturePipelineRun.id,
      workspaceId: fixturePipelineRun.workspaceId,
      projectId: fixturePipelineRun.projectId,
      kind: fixturePipelineRun.kind,
      stage: fixturePipelineRun.stage,
      status: fixturePipelineRun.status,
      attempt: fixturePipelineRun.attempt,
      inputHash: fixturePipelineRun.inputHash,
      creditsCharged: fixturePipelineRun.creditsCharged,
      startedAt: fixturePipelineRun.startedAt,
      finishedAt: fixturePipelineRun.finishedAt,
    })
    .onConflictDoNothing();

  const GRANT_LEDGER_ID = "00000000-0000-4000-8000-000000000072";
  await db
    .insert(schema.creditLedger)
    .values([
      {
        id: GRANT_LEDGER_ID,
        workspaceId: fixtureWorkspace.id,
        delta: 60,
        reason: "plan_grant",
        actorUserId: null,
        projectId: null,
        pipelineRunId: null,
      },
      {
        id: FIXTURE_IDS.ledgerEntry,
        workspaceId: fixtureWorkspace.id,
        delta: -6,
        reason: "script_generation",
        actorUserId: fixtureUser.id,
        projectId: fixtureProject.id,
        pipelineRunId: fixturePipelineRun.id,
      },
    ])
    .onConflictDoNothing();

  console.log("Seed complete (idempotent).");
  console.log(`  archetypes: ${ARCHETYPE_SEEDS.length} seeded/updated`);
  console.log(`  workspace: ${fixtureWorkspace.name} (${fixtureWorkspace.id})`);
  console.log(`  user:      ${fixtureUser.email}`);
  console.log(`  channel:   ${fixtureChannel.title} [${fixtureChannel.mode}]`);
  console.log(`  project:   ${fixtureProject.title} → packaging`);
  console.log(
    `  script:    v${fixtureScript.version}, ${fixtureSections.length} sections, packaging outputs + ledger seeded`,
  );
}

seed()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err: unknown) => {
    console.error("seed failed:", err);
    process.exit(1);
  });
