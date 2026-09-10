import type { ResearchDoc } from "@/lib/types/entities";
import type { ProjectId, WorkspaceId } from "@/lib/types/ids";
import type { EngineDeps } from "@/pipelines/script/deps";
import { countWords } from "@/pipelines/script/readability";
import { RESEARCH_DOC_CONTENT_CAP } from "./pipeline";

/**
 * §5.5 transcript import — licensed TranscriptProvider only, never scraped.
 */

const VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/;

/** Extract a YouTube video id from the URL shapes users actually paste. */
export function parseYoutubeVideoId(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\.|^m\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.split("/")[1] ?? "";
    return VIDEO_ID.test(id) ? id : null;
  }
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const v = url.searchParams.get("v");
    if (v !== null && VIDEO_ID.test(v)) return v;
    const parts = url.pathname.split("/").filter((p) => p !== "");
    const markers = ["shorts", "embed", "live", "v"];
    if (parts.length >= 2 && markers.includes(parts[0] ?? "")) {
      const id = parts[1] ?? "";
      return VIDEO_ID.test(id) ? id : null;
    }
  }
  return null;
}

export class TranscriptImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptImportError";
  }
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export async function importTranscript(
  deps: EngineDeps,
  params: {
    workspaceId: WorkspaceId;
    projectId: ProjectId;
    youtubeVideoUrl: string;
  },
): Promise<ResearchDoc> {
  const videoId = parseYoutubeVideoId(params.youtubeVideoUrl);
  if (videoId === null) {
    throw new TranscriptImportError("could not parse a YouTube video id from that URL");
  }
  const transcript = await deps.transcript.getTranscript(videoId);
  const lines = transcript.segments.map(
    (segment) => `[${formatTimestamp(segment.startSeconds)}] ${segment.text}`,
  );
  const content = lines.join("\n").slice(0, RESEARCH_DOC_CONTENT_CAP);
  if (countWords(content) === 0) {
    throw new TranscriptImportError("transcript is empty for that video");
  }
  return deps.store.insertResearchDoc({
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    kind: "transcript",
    sourceUrl: params.youtubeVideoUrl,
    title: `Transcript: ${videoId} (${transcript.language})`,
    content,
    wordCount: countWords(content),
  });
}
