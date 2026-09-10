import type { LlmModel } from "@/lib/config";

/**
 * Provider interfaces — FROZEN LAYER.
 *
 * Every external dependency sits behind one of these. Selection between the
 * live implementations (real APIs) and the fixture implementations
 * (deterministic, zero keys) is by env `PROVIDERS=fixture|live` via
 * getProviders() in lib/providers/index.ts.
 */

// ---------------------------------------------------------------------------
// LLM
// ---------------------------------------------------------------------------

export interface LlmRequest {
  model: LlmModel;
  system?: string;
  prompt: string;
  maxTokens: number;
  temperature?: number;
  /** Defaults to 120s (spec §5). */
  timeoutMs?: number;
}

export interface LlmResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: "end_turn" | "max_tokens" | "other";
}

export interface LlmProvider {
  complete(req: LlmRequest): Promise<LlmResponse>;
  /** Streams text deltas; the full text is the concatenation of all chunks. */
  stream(req: LlmRequest): AsyncIterable<string>;
}

// ---------------------------------------------------------------------------
// YouTube Data API v3
// ---------------------------------------------------------------------------

export interface YtChannel {
  youtubeChannelId: string;
  title: string;
  handle: string | null;
  subs: number;
  totalViews: number;
  videoCount: number;
  uploadsPlaylistId: string;
}

export interface YtVideoStats {
  youtubeVideoId: string;
  title: string;
  publishedAt: string;
  viewCount: number;
  likeCount: number | null;
  commentCount: number | null;
  durationSeconds: number;
  thumbnailUrl: string | null;
  channelYtid: string;
}

export interface YtSearchResult {
  youtubeVideoId: string;
  channelYtid: string;
  title: string;
  publishedAt: string;
  thumbnailUrl: string | null;
}

export interface YoutubeProvider {
  /** Accepts a channel id (UC…), @handle, or channel URL. */
  getChannel(idOrHandle: string): Promise<YtChannel>;
  /** Most recent uploads, newest first. */
  listRecentVideoIds(uploadsPlaylistId: string, max: number): Promise<string[]>;
  /** Batched stats — callers may pass up to 50 ids per call (1 quota unit). */
  getVideoStats(videoIds: string[]): Promise<YtVideoStats[]>;
  /** search.list — 100 quota units. Budgeted upstream (spec §8). */
  searchVideos(query: string, publishedAfterIso?: string): Promise<YtSearchResult[]>;
}

// ---------------------------------------------------------------------------
// Transcripts (licensed third-party provider — never scraped)
// ---------------------------------------------------------------------------

export interface TranscriptSegment {
  startSeconds: number;
  text: string;
}

export interface Transcript {
  youtubeVideoId: string;
  language: string;
  segments: TranscriptSegment[];
  fullText: string;
}

export interface TranscriptProvider {
  getTranscript(youtubeVideoId: string): Promise<Transcript>;
}

// ---------------------------------------------------------------------------
// Web search (research agent)
// ---------------------------------------------------------------------------

export interface WebSearchResult {
  url: string;
  title: string;
  snippet: string;
}

export interface SearchProvider {
  search(query: string, count: number): Promise<WebSearchResult[]>;
}

// ---------------------------------------------------------------------------
// Image generation (thumbnails)
// ---------------------------------------------------------------------------

export interface ImageRequest {
  prompt: string;
  width: number;
  height: number;
  count: number;
}

export interface GeneratedImage {
  /** Hosted URL (live providers) — caller MUST copy to object storage. */
  url: string | null;
  /** Inline PNG (fixture provider). */
  base64Png: string | null;
}

export interface ImageProvider {
  generate(req: ImageRequest): Promise<GeneratedImage[]>;
}

// ---------------------------------------------------------------------------

export interface Providers {
  llm: LlmProvider;
  youtube: YoutubeProvider;
  transcript: TranscriptProvider;
  search: SearchProvider;
  image: ImageProvider;
}
