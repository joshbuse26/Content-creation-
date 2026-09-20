import { randomUUID } from "node:crypto";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import {
  audienceAvatarSchema,
  channelSchema,
  channelStatsSnapshotSchema,
  channelVideoSchema,
  type AudienceAvatar,
  type Channel,
  type ChannelStatsSnapshot,
  type ChannelVideo,
} from "@/lib/types/entities";
import type { ChannelMode, Sophistication, SyncStatus } from "@/lib/types/enums";
import {
  asChannelId,
  asProjectId,
  asWorkspaceId,
  type ChannelId,
  type ProjectId,
  type UserId,
  type WorkspaceId,
} from "@/lib/types/ids";
import { fixtureAvatar, fixtureChannel, fixtureSnapshot } from "@/lib/fixtures";

/**
 * A1 data-access layer for the channel domain (channels, stats snapshots,
 * audience avatars) plus the post-publish tracking reads/writes (spec §5.12).
 *
 * EVERY tenant-scoped method takes workspaceId and filters on the
 * denormalized workspace_id column — IDs from callers are never trusted to
 * imply tenancy (build spec §4). Implementations: Drizzle (production) and
 * in-memory (tests + keyless fixture mode).
 */

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface NewChannelData {
  workspaceId: WorkspaceId;
  mode: ChannelMode;
  youtubeChannelId: string;
  title: string;
  handle: string | null;
  nicheKeywords: string[];
  /** Ciphertext from server/channel/crypto.ts — NEVER a plaintext token. */
  oauthRefreshTokenEnc: string | null;
}

export interface ChannelPatch {
  title?: string;
  handle?: string | null;
  nicheKeywords?: string[];
  syncStatus?: SyncStatus;
  lastSyncedAt?: Date | null;
  /** Ciphertext only. */
  oauthRefreshTokenEnc?: string | null;
  mode?: ChannelMode;
}

export interface NewSnapshotData {
  workspaceId: WorkspaceId;
  channelId: ChannelId;
  capturedAt: Date;
  subs: number;
  totalViews: number;
  medianViews90d: number;
}

/** A creator-owned upload as the sync pipeline sees it (Data API fields). */
export type ChannelVideoUpsert = Omit<ChannelVideo, "workspaceId" | "channelId" | "capturedAt">;

export interface ChannelRepo {
  list(workspaceId: WorkspaceId): Promise<Channel[]>;
  get(workspaceId: WorkspaceId, channelId: ChannelId): Promise<Channel | null>;
  findByYoutubeId(workspaceId: WorkspaceId, youtubeChannelId: string): Promise<Channel | null>;
  create(data: NewChannelData): Promise<Channel>;
  /** Returns the updated channel, or null when no row matched ws+id. */
  update(
    workspaceId: WorkspaceId,
    channelId: ChannelId,
    patch: ChannelPatch,
  ): Promise<Channel | null>;
  remove(workspaceId: WorkspaceId, channelId: ChannelId): Promise<boolean>;
  latestSnapshot(
    workspaceId: WorkspaceId,
    channelId: ChannelId,
  ): Promise<ChannelStatsSnapshot | null>;
  insertSnapshot(data: NewSnapshotData): Promise<ChannelStatsSnapshot>;
  /** Snapshots for a channel, newest first (bounded) — Intel's period deltas. */
  listSnapshots(
    workspaceId: WorkspaceId,
    channelId: ChannelId,
    limit: number,
  ): Promise<ChannelStatsSnapshot[]>;
  /** Replace-or-insert the channel's own uploads (keyed on channel + video). */
  upsertChannelVideos(
    workspaceId: WorkspaceId,
    channelId: ChannelId,
    videos: readonly ChannelVideoUpsert[],
    capturedAt: Date,
  ): Promise<void>;
  /** The channel's own uploads, newest first. */
  listChannelVideos(workspaceId: WorkspaceId, channelId: ChannelId): Promise<ChannelVideo[]>;
  /** All channels across workspaces — worker-only (nightly sweep fan-out). */
  listAllForSweep(): Promise<Channel[]>;
  /**
   * Stored (encrypted) OAuth refresh token for a channel, or null. Only the
   * oauth-mode sync path reads this — the ciphertext never leaves the
   * server and is decrypted just-in-time (server/channel/crypto.ts).
   */
  getRefreshTokenEnc(workspaceId: WorkspaceId, channelId: ChannelId): Promise<string | null>;
}

export interface AvatarFieldsPatch {
  ageRange?: string | null;
  genderSplit?: string | null;
  geo?: string[];
  sophistication?: Sophistication | null;
  pains?: { pain: string; evidence: string }[];
  motivations?: { motivation: string; evidence: string }[];
  vocabularyNotes?: string | null;
}

export interface AvatarMetaPatch {
  aiGeneratedAt?: Date | null;
  lastEditedBy?: UserId | null;
}

export interface AvatarRepo {
  get(workspaceId: WorkspaceId, channelId: ChannelId): Promise<AudienceAvatar | null>;
  /** Insert-or-update the single avatar row for a channel (channel_id unique). */
  upsert(
    workspaceId: WorkspaceId,
    channelId: ChannelId,
    fields: AvatarFieldsPatch,
    meta: AvatarMetaPatch,
  ): Promise<AudienceAvatar>;
}

/** Projects with a published video — the §5.12 nightly tracking scan. */
export interface PublishedProjectRef {
  projectId: ProjectId;
  workspaceId: WorkspaceId;
  channelId: ChannelId;
  publishedVideoId: string;
}

export interface TrackedVideoStats {
  youtubeVideoId: string;
  channelYtid: string;
  title: string;
  thumbnailUrl: string | null;
  publishedAt: Date;
  viewCount: number;
  channelMedianViews: number;
  outlierRatio: number;
}

export interface TrackingRepo {
  listPublishedProjects(): Promise<PublishedProjectRef[]>;
  /** Upsert by youtube_video_id into niche_videos (the shared stats store). */
  upsertVideoStats(rows: TrackedVideoStats[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Drizzle implementations
// ---------------------------------------------------------------------------

type ChannelRow = typeof schema.channels.$inferSelect;
type SnapshotRow = typeof schema.channelStatsSnapshots.$inferSelect;
type AvatarRow = typeof schema.audienceAvatars.$inferSelect;

function rowToChannel(row: ChannelRow): Channel {
  return channelSchema.parse({
    id: row.id,
    workspaceId: row.workspaceId,
    mode: row.mode,
    youtubeChannelId: row.youtubeChannelId,
    title: row.title,
    handle: row.handle,
    nicheKeywords: row.nicheKeywords,
    syncStatus: row.syncStatus,
    lastSyncedAt: row.lastSyncedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function rowToSnapshot(row: SnapshotRow): ChannelStatsSnapshot {
  return channelStatsSnapshotSchema.parse({
    id: row.id,
    workspaceId: row.workspaceId,
    channelId: row.channelId,
    capturedAt: row.capturedAt,
    subs: row.subs,
    totalViews: row.totalViews,
    medianViews90d: row.medianViews90d,
  });
}

function rowToAvatar(row: AvatarRow): AudienceAvatar {
  return audienceAvatarSchema.parse({
    id: row.id,
    workspaceId: row.workspaceId,
    channelId: row.channelId,
    ageRange: row.ageRange,
    genderSplit: row.genderSplit,
    geo: row.geo,
    sophistication: row.sophistication,
    pains: row.pains,
    motivations: row.motivations,
    vocabularyNotes: row.vocabularyNotes,
    editableByUser: row.editableByUser,
    aiGeneratedAt: row.aiGeneratedAt,
    lastEditedBy: row.lastEditedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function channelPatchToRow(patch: ChannelPatch): Partial<typeof schema.channels.$inferInsert> {
  return {
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.handle !== undefined ? { handle: patch.handle } : {}),
    ...(patch.nicheKeywords !== undefined ? { nicheKeywords: patch.nicheKeywords } : {}),
    ...(patch.syncStatus !== undefined ? { syncStatus: patch.syncStatus } : {}),
    ...(patch.lastSyncedAt !== undefined ? { lastSyncedAt: patch.lastSyncedAt } : {}),
    ...(patch.oauthRefreshTokenEnc !== undefined
      ? { oauthRefreshToken: patch.oauthRefreshTokenEnc }
      : {}),
    ...(patch.mode !== undefined ? { mode: patch.mode } : {}),
  };
}

export class DrizzleChannelRepo implements ChannelRepo {
  async list(workspaceId: WorkspaceId): Promise<Channel[]> {
    const rows = await getDb()
      .select()
      .from(schema.channels)
      .where(eq(schema.channels.workspaceId, workspaceId))
      .orderBy(schema.channels.createdAt);
    return rows.map(rowToChannel);
  }

  async get(workspaceId: WorkspaceId, channelId: ChannelId): Promise<Channel | null> {
    const rows = await getDb()
      .select()
      .from(schema.channels)
      .where(and(eq(schema.channels.workspaceId, workspaceId), eq(schema.channels.id, channelId)))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : rowToChannel(row);
  }

  async findByYoutubeId(
    workspaceId: WorkspaceId,
    youtubeChannelId: string,
  ): Promise<Channel | null> {
    const rows = await getDb()
      .select()
      .from(schema.channels)
      .where(
        and(
          eq(schema.channels.workspaceId, workspaceId),
          eq(schema.channels.youtubeChannelId, youtubeChannelId),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : rowToChannel(row);
  }

  async create(data: NewChannelData): Promise<Channel> {
    const rows = await getDb()
      .insert(schema.channels)
      .values({
        workspaceId: data.workspaceId,
        mode: data.mode,
        youtubeChannelId: data.youtubeChannelId,
        title: data.title,
        handle: data.handle,
        nicheKeywords: data.nicheKeywords,
        oauthRefreshToken: data.oauthRefreshTokenEnc,
        syncStatus: "never",
      })
      .returning();
    const row = rows[0];
    if (row === undefined) throw new Error("insert into channels returned no row");
    return rowToChannel(row);
  }

  async update(
    workspaceId: WorkspaceId,
    channelId: ChannelId,
    patch: ChannelPatch,
  ): Promise<Channel | null> {
    const values = channelPatchToRow(patch);
    if (Object.keys(values).length === 0) return this.get(workspaceId, channelId);
    const rows = await getDb()
      .update(schema.channels)
      .set(values)
      .where(and(eq(schema.channels.workspaceId, workspaceId), eq(schema.channels.id, channelId)))
      .returning();
    const row = rows[0];
    return row === undefined ? null : rowToChannel(row);
  }

  async remove(workspaceId: WorkspaceId, channelId: ChannelId): Promise<boolean> {
    const rows = await getDb()
      .delete(schema.channels)
      .where(and(eq(schema.channels.workspaceId, workspaceId), eq(schema.channels.id, channelId)))
      .returning({ id: schema.channels.id });
    return rows.length > 0;
  }

  async latestSnapshot(
    workspaceId: WorkspaceId,
    channelId: ChannelId,
  ): Promise<ChannelStatsSnapshot | null> {
    const rows = await getDb()
      .select()
      .from(schema.channelStatsSnapshots)
      .where(
        and(
          eq(schema.channelStatsSnapshots.workspaceId, workspaceId),
          eq(schema.channelStatsSnapshots.channelId, channelId),
        ),
      )
      .orderBy(desc(schema.channelStatsSnapshots.capturedAt))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : rowToSnapshot(row);
  }

  async insertSnapshot(data: NewSnapshotData): Promise<ChannelStatsSnapshot> {
    const rows = await getDb()
      .insert(schema.channelStatsSnapshots)
      .values({
        workspaceId: data.workspaceId,
        channelId: data.channelId,
        capturedAt: data.capturedAt,
        subs: data.subs,
        totalViews: data.totalViews,
        medianViews90d: data.medianViews90d,
      })
      .returning();
    const row = rows[0];
    if (row === undefined) throw new Error("insert into channel_stats_snapshots returned no row");
    return rowToSnapshot(row);
  }

  async listSnapshots(
    workspaceId: WorkspaceId,
    channelId: ChannelId,
    limit: number,
  ): Promise<ChannelStatsSnapshot[]> {
    const rows = await getDb()
      .select()
      .from(schema.channelStatsSnapshots)
      .where(
        and(
          eq(schema.channelStatsSnapshots.workspaceId, workspaceId),
          eq(schema.channelStatsSnapshots.channelId, channelId),
        ),
      )
      .orderBy(desc(schema.channelStatsSnapshots.capturedAt))
      .limit(limit);
    return rows.map(rowToSnapshot);
  }

  async upsertChannelVideos(
    workspaceId: WorkspaceId,
    channelId: ChannelId,
    videos: readonly ChannelVideoUpsert[],
    capturedAt: Date,
  ): Promise<void> {
    if (videos.length === 0) return;
    const db = getDb();
    for (const v of videos) {
      await db
        .insert(schema.channelVideos)
        .values({
          workspaceId,
          channelId,
          youtubeVideoId: v.youtubeVideoId,
          title: v.title,
          thumbnailUrl: v.thumbnailUrl,
          publishedAt: v.publishedAt,
          durationSeconds: v.durationSeconds,
          viewCount: v.viewCount,
          likeCount: v.likeCount,
          commentCount: v.commentCount,
          capturedAt,
        })
        .onConflictDoUpdate({
          target: [schema.channelVideos.channelId, schema.channelVideos.youtubeVideoId],
          set: {
            title: v.title,
            thumbnailUrl: v.thumbnailUrl,
            publishedAt: v.publishedAt,
            durationSeconds: v.durationSeconds,
            viewCount: v.viewCount,
            likeCount: v.likeCount,
            commentCount: v.commentCount,
            capturedAt,
            updatedAt: new Date(),
          },
        });
    }
  }

  async listChannelVideos(workspaceId: WorkspaceId, channelId: ChannelId): Promise<ChannelVideo[]> {
    const rows = await getDb()
      .select()
      .from(schema.channelVideos)
      .where(
        and(
          eq(schema.channelVideos.workspaceId, workspaceId),
          eq(schema.channelVideos.channelId, channelId),
        ),
      )
      .orderBy(desc(schema.channelVideos.publishedAt));
    return rows.map((row) =>
      channelVideoSchema.parse({
        workspaceId: row.workspaceId,
        channelId: row.channelId,
        youtubeVideoId: row.youtubeVideoId,
        title: row.title,
        thumbnailUrl: row.thumbnailUrl,
        publishedAt: row.publishedAt,
        durationSeconds: row.durationSeconds,
        viewCount: row.viewCount,
        likeCount: row.likeCount,
        commentCount: row.commentCount,
        capturedAt: row.capturedAt,
      }),
    );
  }

  async listAllForSweep(): Promise<Channel[]> {
    const rows = await getDb().select().from(schema.channels).orderBy(schema.channels.createdAt);
    return rows.map(rowToChannel);
  }

  async getRefreshTokenEnc(workspaceId: WorkspaceId, channelId: ChannelId): Promise<string | null> {
    const rows = await getDb()
      .select({ oauthRefreshToken: schema.channels.oauthRefreshToken })
      .from(schema.channels)
      .where(and(eq(schema.channels.workspaceId, workspaceId), eq(schema.channels.id, channelId)))
      .limit(1);
    return rows[0]?.oauthRefreshToken ?? null;
  }
}

export class DrizzleAvatarRepo implements AvatarRepo {
  async get(workspaceId: WorkspaceId, channelId: ChannelId): Promise<AudienceAvatar | null> {
    const rows = await getDb()
      .select()
      .from(schema.audienceAvatars)
      .where(
        and(
          eq(schema.audienceAvatars.workspaceId, workspaceId),
          eq(schema.audienceAvatars.channelId, channelId),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : rowToAvatar(row);
  }

  async upsert(
    workspaceId: WorkspaceId,
    channelId: ChannelId,
    fields: AvatarFieldsPatch,
    meta: AvatarMetaPatch,
  ): Promise<AudienceAvatar> {
    const db = getDb();
    const patch = { ...fields, ...meta };
    const existing = await this.get(workspaceId, channelId);
    if (existing !== null) {
      const rows = await db
        .update(schema.audienceAvatars)
        .set(patch)
        .where(
          and(
            eq(schema.audienceAvatars.workspaceId, workspaceId),
            eq(schema.audienceAvatars.channelId, channelId),
          ),
        )
        .returning();
      const row = rows[0];
      if (row === undefined) throw new Error("audience_avatars update returned no row");
      return rowToAvatar(row);
    }
    const rows = await db
      .insert(schema.audienceAvatars)
      .values({
        workspaceId,
        channelId,
        ageRange: fields.ageRange ?? null,
        genderSplit: fields.genderSplit ?? null,
        geo: fields.geo ?? [],
        sophistication: fields.sophistication ?? null,
        pains: fields.pains ?? [],
        motivations: fields.motivations ?? [],
        vocabularyNotes: fields.vocabularyNotes ?? null,
        aiGeneratedAt: meta.aiGeneratedAt ?? null,
        lastEditedBy: meta.lastEditedBy ?? null,
      })
      .returning();
    const row = rows[0];
    if (row === undefined) throw new Error("insert into audience_avatars returned no row");
    return rowToAvatar(row);
  }
}

export class DrizzleTrackingRepo implements TrackingRepo {
  async listPublishedProjects(): Promise<PublishedProjectRef[]> {
    const rows = await getDb()
      .select({
        projectId: schema.projects.id,
        workspaceId: schema.projects.workspaceId,
        channelId: schema.projects.channelId,
        publishedVideoId: schema.projects.publishedVideoId,
      })
      .from(schema.projects)
      .where(isNotNull(schema.projects.publishedVideoId));
    return rows.flatMap((row) =>
      row.publishedVideoId === null
        ? []
        : [
            {
              projectId: asProjectId(row.projectId),
              workspaceId: asWorkspaceId(row.workspaceId),
              channelId: asChannelId(row.channelId),
              publishedVideoId: row.publishedVideoId,
            },
          ],
    );
  }

  async upsertVideoStats(rows: TrackedVideoStats[]): Promise<void> {
    if (rows.length === 0) return;
    const db = getDb();
    for (const row of rows) {
      await db
        .insert(schema.nicheVideos)
        .values({
          youtubeVideoId: row.youtubeVideoId,
          channelYtid: row.channelYtid,
          title: row.title,
          thumbnailUrl: row.thumbnailUrl,
          publishedAt: row.publishedAt,
          viewCount: row.viewCount,
          channelMedianViews: row.channelMedianViews,
          outlierRatio: row.outlierRatio.toFixed(2),
          lastRefreshedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: schema.nicheVideos.youtubeVideoId,
          set: {
            title: row.title,
            viewCount: row.viewCount,
            channelMedianViews: row.channelMedianViews,
            outlierRatio: row.outlierRatio.toFixed(2),
            lastRefreshedAt: new Date(),
          },
        });
    }
  }
}

// ---------------------------------------------------------------------------
// In-memory implementations — tests and keyless fixture mode
// ---------------------------------------------------------------------------

interface MemChannel {
  entity: Channel;
  oauthRefreshTokenEnc: string | null;
}

export class InMemoryChannelStore implements ChannelRepo, TrackingRepo {
  private channels = new Map<string, MemChannel>();
  private snapshots: ChannelStatsSnapshot[] = [];
  /** Keyed `${channelId}:${youtubeVideoId}`. */
  private videos = new Map<string, ChannelVideo>();
  private avatars = new Map<string, AudienceAvatar>();
  public publishedProjects: PublishedProjectRef[] = [];
  public trackedVideos = new Map<string, TrackedVideoStats>();

  private now(): Date {
    return new Date();
  }

  // -- ChannelRepo --------------------------------------------------------

  list(workspaceId: WorkspaceId): Promise<Channel[]> {
    return Promise.resolve(
      [...this.channels.values()]
        .map((c) => c.entity)
        .filter((c) => c.workspaceId === workspaceId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    );
  }

  get(workspaceId: WorkspaceId, channelId: ChannelId): Promise<Channel | null> {
    const mem = this.channels.get(channelId);
    if (mem === undefined || mem.entity.workspaceId !== workspaceId) {
      return Promise.resolve(null);
    }
    return Promise.resolve(mem.entity);
  }

  findByYoutubeId(workspaceId: WorkspaceId, youtubeChannelId: string): Promise<Channel | null> {
    for (const mem of this.channels.values()) {
      if (
        mem.entity.workspaceId === workspaceId &&
        mem.entity.youtubeChannelId === youtubeChannelId
      ) {
        return Promise.resolve(mem.entity);
      }
    }
    return Promise.resolve(null);
  }

  create(data: NewChannelData): Promise<Channel> {
    const now = this.now();
    const entity = channelSchema.parse({
      id: randomUUID(),
      workspaceId: data.workspaceId,
      mode: data.mode,
      youtubeChannelId: data.youtubeChannelId,
      title: data.title,
      handle: data.handle,
      nicheKeywords: data.nicheKeywords,
      syncStatus: "never",
      lastSyncedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    this.channels.set(entity.id, { entity, oauthRefreshTokenEnc: data.oauthRefreshTokenEnc });
    return Promise.resolve(entity);
  }

  update(
    workspaceId: WorkspaceId,
    channelId: ChannelId,
    patch: ChannelPatch,
  ): Promise<Channel | null> {
    const mem = this.channels.get(channelId);
    if (mem === undefined || mem.entity.workspaceId !== workspaceId) {
      return Promise.resolve(null);
    }
    const entity = channelSchema.parse({
      ...mem.entity,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.handle !== undefined ? { handle: patch.handle } : {}),
      ...(patch.nicheKeywords !== undefined ? { nicheKeywords: patch.nicheKeywords } : {}),
      ...(patch.syncStatus !== undefined ? { syncStatus: patch.syncStatus } : {}),
      ...(patch.lastSyncedAt !== undefined ? { lastSyncedAt: patch.lastSyncedAt } : {}),
      ...(patch.mode !== undefined ? { mode: patch.mode } : {}),
      updatedAt: this.now(),
    });
    this.channels.set(channelId, {
      entity,
      oauthRefreshTokenEnc:
        patch.oauthRefreshTokenEnc !== undefined
          ? patch.oauthRefreshTokenEnc
          : mem.oauthRefreshTokenEnc,
    });
    return Promise.resolve(entity);
  }

  remove(workspaceId: WorkspaceId, channelId: ChannelId): Promise<boolean> {
    const mem = this.channels.get(channelId);
    if (mem === undefined || mem.entity.workspaceId !== workspaceId) {
      return Promise.resolve(false);
    }
    this.channels.delete(channelId);
    this.snapshots = this.snapshots.filter((s) => s.channelId !== channelId);
    for (const key of this.videos.keys()) {
      if (key.startsWith(`${channelId}:`)) this.videos.delete(key);
    }
    this.avatars.delete(channelId);
    return Promise.resolve(true);
  }

  latestSnapshot(
    workspaceId: WorkspaceId,
    channelId: ChannelId,
  ): Promise<ChannelStatsSnapshot | null> {
    const match = [...this.snapshots]
      .filter((s) => s.workspaceId === workspaceId && s.channelId === channelId)
      .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())[0];
    return Promise.resolve(match ?? null);
  }

  insertSnapshot(data: NewSnapshotData): Promise<ChannelStatsSnapshot> {
    const snapshot = channelStatsSnapshotSchema.parse({
      id: randomUUID(),
      workspaceId: data.workspaceId,
      channelId: data.channelId,
      capturedAt: data.capturedAt,
      subs: data.subs,
      totalViews: data.totalViews,
      medianViews90d: data.medianViews90d,
    });
    this.snapshots.push(snapshot);
    return Promise.resolve(snapshot);
  }

  listSnapshots(
    workspaceId: WorkspaceId,
    channelId: ChannelId,
    limit: number,
  ): Promise<ChannelStatsSnapshot[]> {
    return Promise.resolve(
      [...this.snapshots]
        .filter((s) => s.workspaceId === workspaceId && s.channelId === channelId)
        .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())
        .slice(0, limit),
    );
  }

  upsertChannelVideos(
    workspaceId: WorkspaceId,
    channelId: ChannelId,
    videos: readonly ChannelVideoUpsert[],
    capturedAt: Date,
  ): Promise<void> {
    for (const v of videos) {
      this.videos.set(
        `${channelId}:${v.youtubeVideoId}`,
        channelVideoSchema.parse({ ...v, workspaceId, channelId, capturedAt }),
      );
    }
    return Promise.resolve();
  }

  listChannelVideos(workspaceId: WorkspaceId, channelId: ChannelId): Promise<ChannelVideo[]> {
    return Promise.resolve(
      [...this.videos.values()]
        .filter((v) => v.workspaceId === workspaceId && v.channelId === channelId)
        .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()),
    );
  }

  listAllForSweep(): Promise<Channel[]> {
    return Promise.resolve([...this.channels.values()].map((c) => c.entity));
  }

  getRefreshTokenEnc(workspaceId: WorkspaceId, channelId: ChannelId): Promise<string | null> {
    const mem = this.channels.get(channelId);
    if (mem === undefined || mem.entity.workspaceId !== workspaceId) {
      return Promise.resolve(null);
    }
    return Promise.resolve(mem.oauthRefreshTokenEnc);
  }

  /** Test/debug helper — read the stored (encrypted) token for a channel. */
  getStoredToken(channelId: ChannelId): string | null {
    return this.channels.get(channelId)?.oauthRefreshTokenEnc ?? null;
  }

  /** Test helper — all snapshots, oldest first. */
  get allSnapshots(): readonly ChannelStatsSnapshot[] {
    return this.snapshots;
  }

  // -- AvatarRepo ---------------------------------------------------------

  getAvatar(workspaceId: WorkspaceId, channelId: ChannelId): Promise<AudienceAvatar | null> {
    const avatar = this.avatars.get(channelId);
    if (avatar === undefined || avatar.workspaceId !== workspaceId) {
      return Promise.resolve(null);
    }
    return Promise.resolve(avatar);
  }

  upsert(
    workspaceId: WorkspaceId,
    channelId: ChannelId,
    fields: AvatarFieldsPatch,
    meta: AvatarMetaPatch,
  ): Promise<AudienceAvatar> {
    const existing = this.avatars.get(channelId);
    if (existing !== undefined && existing.workspaceId !== workspaceId) {
      return Promise.reject(new Error("avatar belongs to a different workspace"));
    }
    const now = this.now();
    const base: AudienceAvatar =
      existing ??
      audienceAvatarSchema.parse({
        id: randomUUID(),
        workspaceId,
        channelId,
        ageRange: null,
        genderSplit: null,
        geo: [],
        sophistication: null,
        pains: [],
        motivations: [],
        vocabularyNotes: null,
        editableByUser: true,
        aiGeneratedAt: null,
        lastEditedBy: null,
        createdAt: now,
        updatedAt: now,
      });
    const merged = audienceAvatarSchema.parse({
      ...base,
      ...(fields.ageRange !== undefined ? { ageRange: fields.ageRange } : {}),
      ...(fields.genderSplit !== undefined ? { genderSplit: fields.genderSplit } : {}),
      ...(fields.geo !== undefined ? { geo: fields.geo } : {}),
      ...(fields.sophistication !== undefined ? { sophistication: fields.sophistication } : {}),
      ...(fields.pains !== undefined ? { pains: fields.pains } : {}),
      ...(fields.motivations !== undefined ? { motivations: fields.motivations } : {}),
      ...(fields.vocabularyNotes !== undefined ? { vocabularyNotes: fields.vocabularyNotes } : {}),
      ...(meta.aiGeneratedAt !== undefined ? { aiGeneratedAt: meta.aiGeneratedAt } : {}),
      ...(meta.lastEditedBy !== undefined ? { lastEditedBy: meta.lastEditedBy } : {}),
      updatedAt: now,
    });
    this.avatars.set(channelId, merged);
    return Promise.resolve(merged);
  }

  // ChannelRepo.get and AvatarRepo.get collide on name, so the class
  // implements ChannelRepo directly and exposes AvatarRepo as a view.
  asAvatarRepo(): AvatarRepo {
    return {
      get: (ws, ch) => this.getAvatar(ws, ch),
      upsert: (ws, ch, fields, meta) => this.upsert(ws, ch, fields, meta),
    };
  }

  // -- TrackingRepo -------------------------------------------------------

  listPublishedProjects(): Promise<PublishedProjectRef[]> {
    return Promise.resolve([...this.publishedProjects]);
  }

  upsertVideoStats(rows: TrackedVideoStats[]): Promise<void> {
    for (const row of rows) {
      this.trackedVideos.set(row.youtubeVideoId, row);
    }
    return Promise.resolve();
  }

  // -- Seeding (fixture mode + tests) -------------------------------------

  seedChannel(channel: Channel, oauthRefreshTokenEnc: string | null = null): void {
    this.channels.set(channel.id, { entity: channel, oauthRefreshTokenEnc });
  }

  seedSnapshot(snapshot: ChannelStatsSnapshot): void {
    this.snapshots.push(snapshot);
  }

  seedAvatar(avatar: AudienceAvatar): void {
    this.avatars.set(avatar.channelId, avatar);
  }
}

// ---------------------------------------------------------------------------
// Default repo selection — Drizzle with a DB, seeded in-memory without one
// ---------------------------------------------------------------------------

let sharedMemoryStore: InMemoryChannelStore | undefined;

/** Keyless fixture-mode store, seeded with the canonical fixtures so the app
 *  behaves like the Day-1 stubs did (fixture channel visible immediately). */
export function getSharedMemoryStore(): InMemoryChannelStore {
  if (sharedMemoryStore === undefined) {
    const store = new InMemoryChannelStore();
    store.seedChannel(fixtureChannel);
    store.seedSnapshot(fixtureSnapshot);
    store.seedAvatar(fixtureAvatar);
    sharedMemoryStore = store;
  }
  return sharedMemoryStore;
}

/** Test hook. */
export function resetSharedMemoryStoreForTests(): void {
  sharedMemoryStore = undefined;
}
