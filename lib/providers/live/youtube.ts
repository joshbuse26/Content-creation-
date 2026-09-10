import { z } from "zod";
import { getConfig } from "@/lib/config";
import type { YoutubeProvider, YtChannel, YtSearchResult, YtVideoStats } from "../types";

const API = "https://www.googleapis.com/youtube/v3";

/** ISO-8601 duration (PT#H#M#S) → seconds. */
export function parseIsoDuration(iso: string): number {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (m === null) return 0;
  const [, h, min, s] = m;
  return Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0);
}

const channelListSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        snippet: z.object({
          title: z.string(),
          customUrl: z.string().optional(),
        }),
        statistics: z.object({
          subscriberCount: z.string().optional(),
          viewCount: z.string().optional(),
          videoCount: z.string().optional(),
        }),
        contentDetails: z.object({
          relatedPlaylists: z.object({ uploads: z.string() }),
        }),
      }),
    )
    .default([]),
});

const playlistItemsSchema = z.object({
  items: z
    .array(
      z.object({
        contentDetails: z.object({ videoId: z.string() }),
      }),
    )
    .default([]),
});

const videoListSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        snippet: z.object({
          title: z.string(),
          publishedAt: z.string(),
          channelId: z.string(),
          thumbnails: z.object({ high: z.object({ url: z.string() }).optional() }).optional(),
        }),
        statistics: z.object({
          viewCount: z.string().optional(),
          likeCount: z.string().optional(),
          commentCount: z.string().optional(),
        }),
        contentDetails: z.object({ duration: z.string() }),
      }),
    )
    .default([]),
});

const searchListSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.object({ videoId: z.string().optional() }),
        snippet: z.object({
          title: z.string(),
          publishedAt: z.string(),
          channelId: z.string(),
          thumbnails: z.object({ high: z.object({ url: z.string() }).optional() }).optional(),
        }),
      }),
    )
    .default([]),
});

/** Live YouTube Data API v3 provider (public reads; 10k units/day — spec §8). */
export class LiveYoutube implements YoutubeProvider {
  private async request(path: string, params: Record<string, string>): Promise<unknown> {
    const { GOOGLE_API_KEY } = getConfig();
    if (GOOGLE_API_KEY === undefined) {
      throw new Error("GOOGLE_API_KEY is required for the live YouTube provider");
    }
    const qs = new URLSearchParams({ ...params, key: GOOGLE_API_KEY });
    const res = await fetch(`${API}/${path}?${qs.toString()}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      throw new Error(`YouTube API ${path} failed with status ${res.status}`);
    }
    return (await res.json()) as unknown;
  }

  async getChannel(idOrHandle: string): Promise<YtChannel> {
    const trimmed = idOrHandle
      .replace(/^https?:\/\/(www\.)?youtube\.com\/(channel\/|c\/)?/, "")
      .replace(/\/.*$/, "")
      .trim();
    const params: Record<string, string> = {
      part: "snippet,statistics,contentDetails",
      ...(trimmed.startsWith("UC") ? { id: trimmed } : { forHandle: trimmed.replace(/^@/, "") }),
    };
    const data = channelListSchema.parse(await this.request("channels", params));
    const item = data.items[0];
    if (item === undefined) {
      throw new Error("Channel not found");
    }
    return {
      youtubeChannelId: item.id,
      title: item.snippet.title,
      handle: item.snippet.customUrl ?? null,
      subs: Number(item.statistics.subscriberCount ?? 0),
      totalViews: Number(item.statistics.viewCount ?? 0),
      videoCount: Number(item.statistics.videoCount ?? 0),
      uploadsPlaylistId: item.contentDetails.relatedPlaylists.uploads,
    };
  }

  async listRecentVideoIds(uploadsPlaylistId: string, max: number): Promise<string[]> {
    const data = playlistItemsSchema.parse(
      await this.request("playlistItems", {
        part: "contentDetails",
        playlistId: uploadsPlaylistId,
        maxResults: String(Math.min(max, 50)),
      }),
    );
    return data.items.map((i) => i.contentDetails.videoId);
  }

  async getVideoStats(videoIds: string[]): Promise<YtVideoStats[]> {
    if (videoIds.length === 0) return [];
    const out: YtVideoStats[] = [];
    for (let i = 0; i < videoIds.length; i += 50) {
      const batch = videoIds.slice(i, i + 50);
      const data = videoListSchema.parse(
        await this.request("videos", {
          part: "snippet,statistics,contentDetails",
          id: batch.join(","),
        }),
      );
      for (const item of data.items) {
        out.push({
          youtubeVideoId: item.id,
          title: item.snippet.title,
          publishedAt: item.snippet.publishedAt,
          viewCount: Number(item.statistics.viewCount ?? 0),
          likeCount:
            item.statistics.likeCount !== undefined ? Number(item.statistics.likeCount) : null,
          commentCount:
            item.statistics.commentCount !== undefined
              ? Number(item.statistics.commentCount)
              : null,
          durationSeconds: parseIsoDuration(item.contentDetails.duration),
          thumbnailUrl: item.snippet.thumbnails?.high?.url ?? null,
          channelYtid: item.snippet.channelId,
        });
      }
    }
    return out;
  }

  async searchVideos(query: string, publishedAfterIso?: string): Promise<YtSearchResult[]> {
    const data = searchListSchema.parse(
      await this.request("search", {
        part: "snippet",
        q: query,
        type: "video",
        order: "viewCount",
        maxResults: "25",
        ...(publishedAfterIso !== undefined ? { publishedAfter: publishedAfterIso } : {}),
      }),
    );
    return data.items.flatMap((item) => {
      const videoId = item.id.videoId;
      if (videoId === undefined) return [];
      return [
        {
          youtubeVideoId: videoId,
          channelYtid: item.snippet.channelId,
          title: item.snippet.title,
          publishedAt: item.snippet.publishedAt,
          thumbnailUrl: item.snippet.thumbnails?.high?.url ?? null,
        },
      ];
    });
  }
}
