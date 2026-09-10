import { z } from "zod";
import { getConfig } from "@/lib/config";
import type { Transcript, TranscriptProvider } from "../types";

/**
 * Live transcript provider — licensed third-party API (Supadata-compatible
 * shape). YouTube is never scraped directly (spec §2.3).
 */

const responseSchema = z.object({
  lang: z.string().default("en"),
  content: z
    .array(
      z.object({
        text: z.string(),
        offset: z.number(),
      }),
    )
    .default([]),
});

export class LiveTranscript implements TranscriptProvider {
  async getTranscript(youtubeVideoId: string): Promise<Transcript> {
    const { TRANSCRIPT_API_KEY } = getConfig();
    if (TRANSCRIPT_API_KEY === undefined) {
      throw new Error("TRANSCRIPT_API_KEY is required for the live transcript provider");
    }
    const qs = new URLSearchParams({ videoId: youtubeVideoId, text: "false" });
    const res = await fetch(`https://api.supadata.ai/v1/youtube/transcript?${qs.toString()}`, {
      headers: { "x-api-key": TRANSCRIPT_API_KEY },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new Error(`Transcript API failed with status ${res.status}`);
    }
    const data = responseSchema.parse((await res.json()) as unknown);
    const segments = data.content.map((c) => ({
      startSeconds: Math.round(c.offset / 1000),
      text: c.text,
    }));
    return {
      youtubeVideoId,
      language: data.lang,
      segments,
      fullText: segments.map((s) => s.text).join(" "),
    };
  }
}
