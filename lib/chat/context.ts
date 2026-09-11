import type { GenerationTarget, VoiceProfile } from "@/lib/types/entities";
import type { CoachContext, CoachStyleContext } from "@/lib/types/chat";
import { coachContextSchema } from "@/lib/types/chat";
import type { ProjectId, WorkspaceId } from "@/lib/types/ids";
import { getStageDeps, type StageDeps } from "@/pipelines/stages/deps";
import { resolveStyleCard } from "@/pipelines/stages/style-resolver";
import { logger } from "@/lib/logger";

/**
 * buildCoachContext — the pure grounding assembler for the chat Coach persona
 * (WAVE-D-PLAN §2b), FROZEN in D0. Read-only (no LLM): it assembles the
 * system-context bundle the D1 chat persona is injected with from EXISTING
 * data — the active StyleCard (via the same style-resolver path the pipeline
 * uses), the audience avatar, a research-pack summary, the unique angle, and
 * the duration target — into a typed CoachContext.
 *
 * Every field degrades to a graceful null: a bare or brand-new project (or a
 * workspace-level coach thread with projectId null) still yields a valid,
 * parseable CoachContext. Nothing here throws on missing data or an
 * unresolvable mode — a read used to prime a prompt must never fail the chat.
 */

const RESEARCH_TITLE_CAP = 10;
const AVATAR_LIST_CAP = 5;

/**
 * Reconstruct the GenerationTarget a project's mode columns encode. Returns
 * null for the legacy (mode-less) flow, where the channel's voice profile
 * drives the card instead.
 */
function projectGenerationTarget(project: {
  generationMode: GenerationTarget["mode"] | null;
  archetypeId: GenerationTarget["archetypeId"];
  crossover: GenerationTarget["crossover"];
  partnerId: GenerationTarget["partnerId"];
}): GenerationTarget | null {
  if (project.generationMode === null) return null;
  return {
    mode: project.generationMode,
    archetypeId: project.archetypeId,
    crossover: project.crossover,
    partnerId: project.partnerId,
    voiceProfileId: null,
  };
}

/**
 * Resolve the active style card for a project without ever throwing. Mirrors
 * the pipeline's resolveStyleCard path for mode-driven projects, and falls
 * back to the channel's voice profile for the legacy flow (and for a trained
 * card, which lives on a voice profile until D2 wires the mode end-to-end).
 */
async function resolveActiveStyle(
  deps: StageDeps,
  workspaceId: WorkspaceId,
  channelId: VoiceProfile["channelId"],
  target: GenerationTarget | null,
): Promise<CoachStyleContext> {
  const channelProfiles = (await deps.engine.store.listVoiceProfiles(workspaceId)).filter(
    (p) => p.channelId === channelId,
  );

  if (target === null) {
    // Legacy / voice-profile flow: prefer a trained card if the channel has
    // one (first-class alongside archetypes), else the first profile.
    const trained = channelProfiles.find((p) => p.source === "trained");
    const profile = trained ?? channelProfiles[0] ?? null;
    return {
      source: profile?.source ?? null,
      archetypeId: null,
      card: profile?.styleCard ?? null,
    };
  }

  try {
    const card = await resolveStyleCard(target, channelProfiles[0] ?? null, deps.partners);
    return {
      source: target.mode,
      archetypeId: target.mode === "archetype" ? target.archetypeId : null,
      card,
    };
  } catch (err) {
    // train_on_my_channel is rejected until D2, and partner cards can be
    // unavailable — grounding must not fail the chat, so surface a null card.
    logger.debug(
      { workspaceId, mode: target.mode, err: (err as Error).message },
      "buildCoachContext: active style card unresolved; continuing with null card",
    );
    return { source: target.mode, archetypeId: null, card: null };
  }
}

export async function buildCoachContext(
  projectId: ProjectId | null,
  workspaceId: WorkspaceId,
  deps?: StageDeps,
): Promise<CoachContext> {
  const resolved = deps ?? (await getStageDeps());
  const store = resolved.engine.store;

  // Workspace-level coach thread (no project) — a valid, mostly-null context.
  const project = projectId === null ? null : await store.getProject(workspaceId, projectId);
  if (project === null) {
    return coachContextSchema.parse({
      workspaceId,
      projectId: null,
      projectTitle: null,
      channelTitle: null,
      nicheKeywords: [],
      style: { source: null, archetypeId: null, card: null },
      audience: null,
      research: { docCount: 0, totalWords: 0, titles: [] },
      uniqueAngle: null,
      durationMinutes: null,
    });
  }

  const [channel, frames, researchDocs, avatar, style] = await Promise.all([
    resolved.channels.get(workspaceId, project.channelId),
    store.listFrames(workspaceId, project.id),
    store.listResearchDocs(workspaceId, project.id),
    store.getAvatarForChannel(project.channelId),
    resolveActiveStyle(resolved, workspaceId, project.channelId, projectGenerationTarget(project)),
  ]);

  const chosenFrame = frames.find((f) => f.chosen) ?? null;

  return coachContextSchema.parse({
    workspaceId,
    projectId: project.id,
    projectTitle: project.title,
    channelTitle: channel?.title ?? null,
    nicheKeywords: channel?.nicheKeywords ?? [],
    style,
    audience:
      avatar === null
        ? null
        : {
            sophistication: avatar.sophistication,
            topPains: avatar.pains.slice(0, AVATAR_LIST_CAP).map((p) => p.pain),
            topMotivations: avatar.motivations.slice(0, AVATAR_LIST_CAP).map((m) => m.motivation),
            vocabularyNotes: avatar.vocabularyNotes,
          },
    research: {
      docCount: researchDocs.length,
      totalWords: researchDocs.reduce((sum, d) => sum + d.wordCount, 0),
      titles: researchDocs.slice(0, RESEARCH_TITLE_CAP).map((d) => d.title),
    },
    uniqueAngle: chosenFrame?.angle ?? null,
    durationMinutes: chosenFrame?.targetMinutes ?? null,
  });
}
