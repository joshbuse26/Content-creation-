import { randomUUID } from "node:crypto";
import { and, arrayOverlaps, desc, eq, gte } from "drizzle-orm";
import { getDb, hasDb, schema } from "@/db";
import { fixtureIdea, fixtureNicheVideo } from "@/lib/fixtures";
import { ideaSchema, nicheVideoSchema, type Idea, type NicheVideo } from "@/lib/types/entities";
import type { IdeaStatus } from "@/lib/types/enums";
import type { ChannelId, IdeaId, WorkspaceId } from "@/lib/types/ids";
import { normalizeKeywordSet } from "./similarity";

/**
 * IdeationStore — persistence for the outlier index (niche_videos) and the
 * idea feed (ideas). Drizzle-backed when a database is configured, seeded
 * in-memory otherwise (fixture mode / tests), mirroring the EngineStore
 * pattern.
 *
 * niche_videos is deliberately GLOBAL (no workspace_id): the outlier index
 * is shared across every workspace in a niche — that sharing is the §8
 * quota design point. ideas rows are tenant rows: every read/write here
 * filters on the denormalized workspace_id.
 */

export interface UpsertNicheVideo {
  youtubeVideoId: string;
  channelYtid: string;
  title: string;
  thumbnailUrl: string | null;
  publishedAt: Date;
  viewCount: number;
  channelMedianViews: number;
  outlierRatio: number;
  formatTags: string[];
  nicheKeywords: string[];
  lastRefreshedAt: Date;
}

export interface OutlierQuery {
  /** Normalized niche keywords — any overlap matches. */
  nicheKeywords: string[];
  limit: number;
  /** Only videos published after this instant ("fresh" outliers). */
  publishedAfter?: Date;
  /** E3 filter: keep only videos at/above this outlier ratio (view multiple). */
  minOutlierRatio?: number;
}

export interface NewIdea {
  workspaceId: WorkspaceId;
  channelId: ChannelId;
  title: string;
  angle: string;
  rationale: string;
  evidenceVideoIds: string[];
  score: number;
  /** ISO date (YYYY-MM-DD). */
  generatedOn: string;
}

export interface IdeaListFilter {
  channelId: ChannelId;
  status?: IdeaStatus;
  limit: number;
}

export interface IdeationStore {
  upsertNicheVideos(videos: UpsertNicheVideo[]): Promise<void>;
  /** Top outliers overlapping the keywords, highest outlier_ratio first. */
  listOutliers(query: OutlierQuery): Promise<NicheVideo[]>;
  insertIdeas(ideas: NewIdea[]): Promise<Idea[]>;
  listIdeas(workspaceId: WorkspaceId, filter: IdeaListFilter): Promise<Idea[]>;
  getIdea(workspaceId: WorkspaceId, ideaId: IdeaId): Promise<Idea | null>;
  updateIdeaStatus(
    workspaceId: WorkspaceId,
    ideaId: IdeaId,
    status: IdeaStatus,
  ): Promise<Idea | null>;
  /** Titles of this channel's ideas generated on/after `since` (dedup window). */
  recentIdeaTitles(workspaceId: WorkspaceId, channelId: ChannelId, since: Date): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// In-memory implementation — fixture mode and tests
// ---------------------------------------------------------------------------

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryIdeationStore implements IdeationStore {
  private readonly nicheVideos: NicheVideo[] = [];
  private readonly ideas: Idea[] = [];

  constructor(options: { seedFixtures?: boolean } = {}) {
    if (options.seedFixtures ?? true) {
      this.nicheVideos.push(clone(fixtureNicheVideo));
      this.ideas.push(clone(fixtureIdea));
    }
  }

  upsertNicheVideos(videos: UpsertNicheVideo[]): Promise<void> {
    for (const video of videos) {
      const existing = this.nicheVideos.find((v) => v.youtubeVideoId === video.youtubeVideoId);
      if (existing !== undefined) {
        existing.title = video.title;
        existing.thumbnailUrl = video.thumbnailUrl;
        existing.viewCount = video.viewCount;
        existing.channelMedianViews = video.channelMedianViews;
        existing.outlierRatio = video.outlierRatio;
        existing.formatTags = [...video.formatTags];
        existing.nicheKeywords = normalizeKeywordSet([
          ...existing.nicheKeywords,
          ...video.nicheKeywords,
        ]);
        existing.lastRefreshedAt = video.lastRefreshedAt;
        continue;
      }
      this.nicheVideos.push(
        nicheVideoSchema.parse({
          id: randomUUID(),
          youtubeVideoId: video.youtubeVideoId,
          channelYtid: video.channelYtid,
          title: video.title,
          thumbnailUrl: video.thumbnailUrl,
          publishedAt: video.publishedAt,
          viewCount: video.viewCount,
          channelMedianViews: video.channelMedianViews,
          outlierRatio: video.outlierRatio,
          formatTags: video.formatTags,
          nicheKeywords: normalizeKeywordSet(video.nicheKeywords),
          lastRefreshedAt: video.lastRefreshedAt,
        }),
      );
    }
    return Promise.resolve();
  }

  listOutliers(query: OutlierQuery): Promise<NicheVideo[]> {
    const keywords = new Set(normalizeKeywordSet(query.nicheKeywords));
    const after = query.publishedAfter;
    const minRatio = query.minOutlierRatio;
    const matches = this.nicheVideos
      .filter((v) => v.nicheKeywords.some((k) => keywords.has(k)))
      .filter((v) => after === undefined || v.publishedAt.getTime() >= after.getTime())
      .filter((v) => minRatio === undefined || v.outlierRatio >= minRatio)
      .sort((a, b) => b.outlierRatio - a.outlierRatio)
      .slice(0, query.limit);
    return Promise.resolve(matches.map(clone));
  }

  insertIdeas(ideas: NewIdea[]): Promise<Idea[]> {
    const now = new Date();
    const inserted = ideas.map((idea) =>
      ideaSchema.parse({
        id: randomUUID(),
        workspaceId: idea.workspaceId,
        channelId: idea.channelId,
        title: idea.title,
        angle: idea.angle,
        rationale: idea.rationale,
        evidenceVideoIds: idea.evidenceVideoIds,
        score: idea.score,
        status: "new",
        generatedOn: idea.generatedOn,
        createdAt: now,
        updatedAt: now,
      }),
    );
    this.ideas.push(...inserted.map(clone));
    return Promise.resolve(inserted);
  }

  listIdeas(workspaceId: WorkspaceId, filter: IdeaListFilter): Promise<Idea[]> {
    const matches = this.ideas
      .filter((i) => i.workspaceId === workspaceId && i.channelId === filter.channelId)
      .filter((i) => filter.status === undefined || i.status === filter.status)
      .sort((a, b) =>
        a.generatedOn === b.generatedOn
          ? b.score - a.score
          : a.generatedOn < b.generatedOn
            ? 1
            : -1,
      )
      .slice(0, filter.limit);
    return Promise.resolve(matches.map(clone));
  }

  getIdea(workspaceId: WorkspaceId, ideaId: IdeaId): Promise<Idea | null> {
    const idea = this.ideas.find((i) => i.workspaceId === workspaceId && i.id === ideaId);
    return Promise.resolve(idea === undefined ? null : clone(idea));
  }

  updateIdeaStatus(
    workspaceId: WorkspaceId,
    ideaId: IdeaId,
    status: IdeaStatus,
  ): Promise<Idea | null> {
    const idea = this.ideas.find((i) => i.workspaceId === workspaceId && i.id === ideaId);
    if (idea === undefined) return Promise.resolve(null);
    idea.status = status;
    idea.updatedAt = new Date();
    return Promise.resolve(clone(idea));
  }

  recentIdeaTitles(workspaceId: WorkspaceId, channelId: ChannelId, since: Date): Promise<string[]> {
    const sinceDate = since.toISOString().slice(0, 10);
    return Promise.resolve(
      this.ideas
        .filter(
          (i) =>
            i.workspaceId === workspaceId &&
            i.channelId === channelId &&
            i.generatedOn >= sinceDate,
        )
        .map((i) => i.title),
    );
  }
}

// ---------------------------------------------------------------------------
// Drizzle implementation — production
// ---------------------------------------------------------------------------

export class DrizzleIdeationStore implements IdeationStore {
  async upsertNicheVideos(videos: UpsertNicheVideo[]): Promise<void> {
    if (videos.length === 0) return;
    const db = getDb();
    for (const video of videos) {
      const values = {
        youtubeVideoId: video.youtubeVideoId,
        channelYtid: video.channelYtid,
        title: video.title,
        thumbnailUrl: video.thumbnailUrl,
        publishedAt: video.publishedAt,
        viewCount: video.viewCount,
        channelMedianViews: video.channelMedianViews,
        outlierRatio: video.outlierRatio.toFixed(2),
        formatTags: video.formatTags,
        nicheKeywords: normalizeKeywordSet(video.nicheKeywords),
        lastRefreshedAt: video.lastRefreshedAt,
      };
      await db
        .insert(schema.nicheVideos)
        .values(values)
        .onConflictDoUpdate({
          target: schema.nicheVideos.youtubeVideoId,
          set: {
            title: values.title,
            thumbnailUrl: values.thumbnailUrl,
            viewCount: values.viewCount,
            channelMedianViews: values.channelMedianViews,
            outlierRatio: values.outlierRatio,
            formatTags: values.formatTags,
            nicheKeywords: values.nicheKeywords,
            lastRefreshedAt: values.lastRefreshedAt,
          },
        });
    }
  }

  async listOutliers(query: OutlierQuery): Promise<NicheVideo[]> {
    const keywords = normalizeKeywordSet(query.nicheKeywords);
    if (keywords.length === 0) return [];
    const conditions = [arrayOverlaps(schema.nicheVideos.nicheKeywords, keywords)];
    if (query.publishedAfter !== undefined) {
      conditions.push(gte(schema.nicheVideos.publishedAt, query.publishedAfter));
    }
    if (query.minOutlierRatio !== undefined) {
      // outlier_ratio is a numeric column (stored as a fixed-2 string).
      conditions.push(gte(schema.nicheVideos.outlierRatio, query.minOutlierRatio.toFixed(2)));
    }
    const rows = await getDb()
      .select()
      .from(schema.nicheVideos)
      .where(and(...conditions))
      .orderBy(desc(schema.nicheVideos.outlierRatio))
      .limit(query.limit);
    return rows.map((row) =>
      nicheVideoSchema.parse({ ...row, outlierRatio: Number(row.outlierRatio) }),
    );
  }

  async insertIdeas(ideas: NewIdea[]): Promise<Idea[]> {
    if (ideas.length === 0) return [];
    const rows = await getDb()
      .insert(schema.ideas)
      .values(
        ideas.map((idea) => ({
          workspaceId: idea.workspaceId,
          channelId: idea.channelId,
          title: idea.title,
          angle: idea.angle,
          rationale: idea.rationale,
          evidenceVideoIds: idea.evidenceVideoIds,
          score: idea.score.toFixed(2),
          status: "new" as const,
          generatedOn: idea.generatedOn,
        })),
      )
      .returning();
    return rows.map((row) => ideaSchema.parse({ ...row, score: Number(row.score) }));
  }

  async listIdeas(workspaceId: WorkspaceId, filter: IdeaListFilter): Promise<Idea[]> {
    const conditions = [
      eq(schema.ideas.workspaceId, workspaceId),
      eq(schema.ideas.channelId, filter.channelId),
    ];
    if (filter.status !== undefined) {
      conditions.push(eq(schema.ideas.status, filter.status));
    }
    const rows = await getDb()
      .select()
      .from(schema.ideas)
      .where(and(...conditions))
      .orderBy(desc(schema.ideas.generatedOn), desc(schema.ideas.score))
      .limit(filter.limit);
    return rows.map((row) => ideaSchema.parse({ ...row, score: Number(row.score) }));
  }

  async getIdea(workspaceId: WorkspaceId, ideaId: IdeaId): Promise<Idea | null> {
    const rows = await getDb()
      .select()
      .from(schema.ideas)
      .where(and(eq(schema.ideas.workspaceId, workspaceId), eq(schema.ideas.id, ideaId)))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : ideaSchema.parse({ ...row, score: Number(row.score) });
  }

  async updateIdeaStatus(
    workspaceId: WorkspaceId,
    ideaId: IdeaId,
    status: IdeaStatus,
  ): Promise<Idea | null> {
    const rows = await getDb()
      .update(schema.ideas)
      .set({ status })
      .where(and(eq(schema.ideas.workspaceId, workspaceId), eq(schema.ideas.id, ideaId)))
      .returning();
    const row = rows[0];
    return row === undefined ? null : ideaSchema.parse({ ...row, score: Number(row.score) });
  }

  async recentIdeaTitles(
    workspaceId: WorkspaceId,
    channelId: ChannelId,
    since: Date,
  ): Promise<string[]> {
    const rows = await getDb()
      .select({ title: schema.ideas.title })
      .from(schema.ideas)
      .where(
        and(
          eq(schema.ideas.workspaceId, workspaceId),
          eq(schema.ideas.channelId, channelId),
          gte(schema.ideas.generatedOn, since.toISOString().slice(0, 10)),
        ),
      );
    return rows.map((row) => row.title);
  }
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

let cached: IdeationStore | undefined;

/** Drizzle when a database is configured, shared seeded in-memory otherwise. */
export function getIdeationStore(): IdeationStore {
  cached ??= hasDb() ? new DrizzleIdeationStore() : new InMemoryIdeationStore();
  return cached;
}

/** Test hook: swap in a fresh store (or a specific instance). */
export function setIdeationStoreForTests(store: IdeationStore | undefined): void {
  cached = store;
}
