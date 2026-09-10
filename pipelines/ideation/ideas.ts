import { LLM_MODELS } from "@/lib/config";
import { logger } from "@/lib/logger";
import type { AudienceAvatar, Idea, NicheVideo } from "@/lib/types/entities";
import {
  IDEAS_STAGES,
  generatedIdeasSchema,
  ideasJobInputSchema,
  type GeneratedIdea,
} from "@/lib/types/pipeline";
import { generateJson } from "@/pipelines/script/llm-json";
import { PipelineRunner } from "@/queue/pipeline-runner";
import type { IdeationDeps } from "./deps";
import { synthIdeas } from "./fixture-content";
import { dailyIdeasPrompt, ideationStageHash } from "./prompts";
import { TITLE_SIMILARITY_THRESHOLD, isDuplicateTitle } from "./similarity";

/**
 * §5.4 Daily ideas (queue: sync, job: daily-ideas) — per channel.
 *
 * top 20 fresh outliers + audience avatar + the channel's own recent
 * topics → main-tier LLM → 5 ideas {title, angle, rationale,
 * evidenceVideoIds, score} → dedup vs the last 30 days (normalized-title
 * trigram Jaccard ≥ 0.6 = dup; embedding dedup deferred — similarity.ts)
 * → ideas rows, status "new".
 *
 * Credits (spec §7): the scheduled daily feed is FREE (chargeCredits
 * unset); a user-requested extra batch charges 1 credit on completion,
 * idempotently per run hash, never on failure.
 */

export const DAILY_IDEAS_COUNT = 5;
export const OUTLIER_CONTEXT_LIMIT = 20;
/** "Fresh" outliers = published inside this window. */
export const FRESH_OUTLIER_DAYS = 90;
export const DEDUP_WINDOW_DAYS = 30;
export const IDEA_BATCH_CREDIT_COST = 1;

export interface DailyIdeasParams {
  input: unknown;
  /** True for a user-requested extra batch (1 credit); daily runs are free. */
  chargeCredits?: boolean;
  actorUserId?: string | null;
  /**
   * Distinguishes multiple user-requested batches on the same day (each is
   * its own run + its own idempotent charge). Scheduled daily runs omit it,
   * so a duplicate enqueue of the same day's feed resumes instead of
   * regenerating.
   */
  batchNonce?: string;
}

export interface DailyIdeasResult {
  status: "done" | "skipped_no_niche";
  ideas: Idea[];
  generated: number;
  duplicates: number;
}

function avatarSummary(avatar: AudienceAvatar | null): string | null {
  if (avatar === null) return null;
  const lines: string[] = [];
  if (avatar.ageRange !== null) lines.push(`Age: ${avatar.ageRange}`);
  if (avatar.genderSplit !== null) lines.push(`Gender: ${avatar.genderSplit}`);
  if (avatar.geo.length > 0) lines.push(`Geo: ${avatar.geo.join(", ")}`);
  if (avatar.sophistication !== null) lines.push(`Sophistication: ${avatar.sophistication}`);
  for (const pain of avatar.pains) lines.push(`Pain: ${pain.pain}`);
  for (const motivation of avatar.motivations) lines.push(`Motivation: ${motivation.motivation}`);
  if (avatar.vocabularyNotes !== null) lines.push(`Vocabulary: ${avatar.vocabularyNotes}`);
  return lines.length === 0 ? null : lines.join("\n");
}

interface IdeasRunState {
  outliers?: NicheVideo[];
  avatarText?: string | null;
  recentTopics?: string[];
  recentTitles?: string[];
  generated?: GeneratedIdea[];
  inserted?: Idea[];
  duplicates?: number;
}

export async function runDailyIdeas(
  deps: IdeationDeps,
  params: DailyIdeasParams,
): Promise<DailyIdeasResult> {
  const input = ideasJobInputSchema.parse(params.input);
  const channel = await deps.channelRepo.get(input.workspaceId, input.channelId);
  if (channel === null) {
    throw new Error(`channel ${input.channelId} not found in workspace ${input.workspaceId}`);
  }
  if (channel.nicheKeywords.length === 0) {
    // No niche → nothing to mine. The feed UI points these channels to
    // niche settings; the pipeline is a clean no-op, never a failure.
    logger.info({ channelId: input.channelId }, "daily ideas skipped: channel has no niche");
    return { status: "skipped_no_niche", ideas: [], generated: 0, duplicates: 0 };
  }

  const day = deps.now().toISOString().slice(0, 10);
  const state: IdeasRunState = {};

  const stageBodies: Record<(typeof IDEAS_STAGES)[number], () => Promise<void>> = {
    assemble_ideas_context: async () => {
      state.outliers = await deps.store.listOutliers({
        nicheKeywords: channel.nicheKeywords,
        limit: OUTLIER_CONTEXT_LIMIT,
        publishedAfter: new Date(deps.now().getTime() - FRESH_OUTLIER_DAYS * 86_400_000),
      });
      const avatar = await deps.engineStore.getAvatarForChannel(input.channelId);
      state.avatarText = avatarSummary(avatar);
      const projects = await deps.engineStore.listProjects(input.workspaceId, {
        channelId: input.channelId,
        limit: 10,
      });
      state.recentTopics = projects.map((p) => p.title);
      state.recentTitles = await deps.store.recentIdeaTitles(
        input.workspaceId,
        input.channelId,
        new Date(deps.now().getTime() - DEDUP_WINDOW_DAYS * 86_400_000),
      );
    },

    generate_ideas: async () => {
      const outliers = state.outliers ?? [];
      state.generated = await generateJson({
        mode: deps.mode,
        llm: deps.llm,
        model: LLM_MODELS.sonnet,
        template: dailyIdeasPrompt({
          channelTitle: channel.title,
          nicheKeywords: channel.nicheKeywords,
          outliers: outliers.map((o) => ({
            youtubeVideoId: o.youtubeVideoId,
            title: o.title,
            outlierRatio: o.outlierRatio,
            viewCount: o.viewCount,
            formatTags: o.formatTags,
          })),
          avatarSummary: state.avatarText ?? null,
          recentTopics: state.recentTopics ?? [],
        }),
        maxTokens: 2500,
        temperature: 0.8,
        schema: generatedIdeasSchema,
        fixture: () =>
          synthIdeas({
            channelTitle: channel.title,
            nicheKeywords: channel.nicheKeywords,
            outliers: outliers.map((o) => ({ youtubeVideoId: o.youtubeVideoId, title: o.title })),
          }),
      });
    },

    dedup_ideas: async () => {
      const generated = state.generated;
      if (generated === undefined) throw new Error("generate_ideas did not run");
      const recentTitles = state.recentTitles ?? [];
      const knownEvidenceIds = new Set((state.outliers ?? []).map((o) => o.youtubeVideoId));

      const fresh: GeneratedIdea[] = [];
      const acceptedTitles: string[] = [];
      for (const idea of generated) {
        const against = [...recentTitles, ...acceptedTitles];
        if (isDuplicateTitle(idea.title, against, TITLE_SIMILARITY_THRESHOLD)) continue;
        fresh.push(idea);
        acceptedTitles.push(idea.title);
      }
      state.duplicates = generated.length - fresh.length;

      state.inserted = await deps.store.insertIdeas(
        fresh.map((idea) => ({
          workspaceId: input.workspaceId,
          channelId: input.channelId,
          title: idea.title,
          angle: idea.angle,
          rationale: idea.rationale,
          // Evidence must point at real outlier index entries, never at
          // ids the model made up.
          evidenceVideoIds: idea.evidenceVideoIds.filter((id) => knownEvidenceIds.has(id)),
          score: idea.score,
          generatedOn: day,
        })),
      );
    },
  };

  const inputHash = ideationStageHash({
    input,
    day,
    batchNonce: params.batchNonce ?? null,
  });
  const runner = new PipelineRunner(deps.runs);
  const result = await runner.execute(
    {
      kind: "ideas",
      stages: IDEAS_STAGES.map((name) => ({ name, run: () => stageBodies[name]() })),
    },
    { workspaceId: input.workspaceId, projectId: null, input, inputHash },
  );
  if (result.status === "failed") {
    throw new Error(`daily ideas failed at ${result.stage}: ${result.error}`);
  }

  const fullySkipped = result.skippedStages.length === IDEAS_STAGES.length;
  if ((params.chargeCredits ?? false) && !fullySkipped) {
    // 1 credit for a user-requested batch — on completion, never on
    // failure, never twice for the same run (idempotent per run hash).
    await deps.engineStore.recordCredits({
      workspaceId: input.workspaceId,
      delta: -IDEA_BATCH_CREDIT_COST,
      reason: "idea_batch",
      actorUserId: params.actorUserId ?? null,
      projectId: null,
      idempotencyKey: `idea_batch:${inputHash}`,
    });
  }

  const inserted = state.inserted ?? [];
  logger.info(
    {
      channelId: input.channelId,
      generated: state.generated?.length ?? 0,
      duplicates: state.duplicates ?? 0,
      inserted: inserted.length,
    },
    "daily ideas complete",
  );
  return {
    status: "done",
    ideas: inserted,
    generated: state.generated?.length ?? 0,
    duplicates: state.duplicates ?? 0,
  };
}
