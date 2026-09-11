import type { z } from "zod";
import { getConfig } from "@/lib/config";
import { licensedGuardProfile, licensedSourceCorpus } from "@/lib/multi-voice";
import { analyzeSimilarity, exceedsSimilarity } from "@/lib/similarity-guard";
import type { revisionContracts } from "@/lib/types/api";
import type { Revision, ScriptSection } from "@/lib/types/entities";
import { applyDiffOps, DiffApplyError, rebaseDiffOps } from "@/pipelines/revision/apply";
import { getEngineDeps } from "@/pipelines/script/deps";
import { dispatchPipelineJob } from "@/pipelines/script/execute";
import { handleRevisionPassJob } from "@/pipelines/script/jobs";
import {
  countWords,
  estimateSeconds,
  estimateSecondsForText,
  fleschReadingEase,
} from "@/pipelines/script/readability";
import { JOB_NAMES, QUEUE_NAMES } from "@/queue/queues";
import { requireCreditsWithOverage } from "@/server/billing";
import { CREDIT_COSTS } from "@/server/credits";
import { badRequest, jobAccepted, notFound, preconditionFailed, type HandlerOpts } from "./_shared";

type RunInput = z.output<typeof revisionContracts.run.input>;
type ListInput = z.output<typeof revisionContracts.list.input>;
type AcceptInput = z.output<typeof revisionContracts.accept.input>;
type RejectInput = z.output<typeof revisionContracts.reject.input>;

/** revision router — build spec §5.8 / §6. */
export const revisionImpl = {
  /** Runs the revision pass; 2 credits charged on completion. */
  async run({ ctx, input }: HandlerOpts<RunInput>) {
    await requireCreditsWithOverage(ctx.workspaceId, CREDIT_COSTS.revisionPass);
    const deps = await getEngineDeps();
    const script = await deps.store.getScript(ctx.workspaceId, input.scriptId);
    if (script === null) notFound("script");
    const payload = {
      workspaceId: input.workspaceId,
      scriptId: input.scriptId,
      ...(input.guidance !== undefined ? { guidance: input.guidance } : {}),
      actorUserId: ctx.userId as string,
    };
    await dispatchPipelineJob(QUEUE_NAMES.script, JOB_NAMES.revisionPass, payload, () =>
      handleRevisionPassJob(payload),
    );
    return jobAccepted();
  },

  async list({ ctx, input }: HandlerOpts<ListInput>): Promise<Revision[]> {
    const deps = await getEngineDeps();
    const script = await deps.store.getScript(ctx.workspaceId, input.scriptId);
    if (script === null) notFound("script");
    return deps.store.listRevisions(ctx.workspaceId, input.scriptId);
  },

  /**
   * Accept one suggestion: diff ops REBASED over previously accepted
   * suggestions on the same section (line-offset tracking — accepts applied
   * in order shift subsequent ops; ops that no longer match are rejected),
   * then applied to the CURRENT section body; revision marked accepted,
   * script version++ and stats refreshed — atomically.
   */
  async accept({
    ctx,
    input,
  }: HandlerOpts<AcceptInput>): Promise<{ revision: Revision; section: ScriptSection }> {
    const deps = await getEngineDeps();
    const revision = await deps.store.getRevision(ctx.workspaceId, input.revisionId);
    if (revision === null) notFound("revision");
    if (revision.status !== "pending") {
      badRequest(`revision is already ${revision.status}`);
    }
    const section = await deps.store.getSection(ctx.workspaceId, revision.sectionId);
    if (section === null) notFound("section");
    if (section.locked) {
      preconditionFailed("section is locked — unlock it before applying revisions");
    }
    const allRevisions = await deps.store.listRevisions(ctx.workspaceId, revision.scriptId);
    const acceptedDiffs = allRevisions
      .filter((r) => r.sectionId === revision.sectionId && r.status === "accepted")
      .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
      .map((r) => r.diff);
    let newBody: string;
    try {
      newBody = applyDiffOps(section.body, rebaseDiffOps(revision.diff, acceptedDiffs));
    } catch (err) {
      if (err instanceof DiffApplyError) {
        badRequest(`suggestion no longer applies: ${err.message}`);
      }
      throw err;
    }

    // Licensed-voice similarity guard (PRODUCT-CONTRACTS §7, P1-2): before the
    // diff touches the live body, verify the RESULT is not over-similar to the
    // licensed source. A suggestion that would make the section reproduce the
    // source too closely is rejected (typed PRECONDITION_FAILED) with the body
    // left unchanged and nothing persisted. The effective voice is the section's
    // own override (multi-voice) when set, else the script-level voice; a
    // non-licensed effective voice skips the check entirely.
    const script = await deps.store.getScript(ctx.workspaceId, revision.scriptId);
    const scriptProfile =
      script === null || script.voiceProfileId === null
        ? null
        : await deps.store.getVoiceProfile(ctx.workspaceId, script.voiceProfileId);
    const overrideProfile =
      section.voiceProfileId === null
        ? null
        : await deps.store.getVoiceProfile(ctx.workspaceId, section.voiceProfileId);
    const licensedProfile = licensedGuardProfile(overrideProfile, scriptProfile);
    if (licensedProfile !== null) {
      const sources = licensedSourceCorpus(licensedProfile);
      if (sources.length === 0) {
        // Fail closed: a licensed voice with no material can't be verified.
        preconditionFailed(
          "This licensed voice has no source material to check the result against, so the " +
            "suggestion was not applied. Add example source passages, or choose a different voice.",
        );
      }
      const report = analyzeSimilarity(newBody, sources);
      if (exceedsSimilarity(report, getConfig().LICENSED_SIMILARITY_MAX_OVERLAP)) {
        preconditionFailed(
          "Applying this suggestion would reproduce the licensed source too closely, so it " +
            "was not applied. Edit the suggestion to put the idea in your own words.",
        );
      }
    }

    // Recompute script stats with the new body in place.
    const sections = await deps.store.listSections(ctx.workspaceId, revision.scriptId);
    const text = sections.map((s) => (s.id === section.id ? newBody : s.body)).join("\n\n");
    const words = countWords(text);
    return deps.store.applyRevision({
      workspaceId: ctx.workspaceId,
      revisionId: revision.id,
      sectionId: section.id,
      scriptId: revision.scriptId,
      newBody,
      newEstSeconds: estimateSecondsForText(newBody),
      newStats: {
        words,
        estRuntimeS: estimateSeconds(words),
        readability: fleschReadingEase(text),
      },
    });
  },

  async reject({ ctx, input }: HandlerOpts<RejectInput>): Promise<Revision> {
    const deps = await getEngineDeps();
    const existing = await deps.store.getRevision(ctx.workspaceId, input.revisionId);
    if (existing === null) notFound("revision");
    if (existing.status !== "pending") {
      badRequest(`revision is already ${existing.status}`);
    }
    const revision = await deps.store.rejectRevision(ctx.workspaceId, input.revisionId);
    if (revision === null) notFound("revision");
    return revision;
  },
} as const;
