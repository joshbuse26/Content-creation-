import { extractPdfText, type ExtractPdfOptions } from "@/lib/research/pdf";
import type { ResearchDoc } from "@/lib/types/entities";
import type { Plan, ResearchKind } from "@/lib/types/enums";
import type { ProjectId, WorkspaceId } from "@/lib/types/ids";
import type { EngineDeps } from "@/pipelines/script/deps";
import { countWords } from "@/pipelines/script/readability";
import { RESEARCH_DOC_CONTENT_CAP } from "./pipeline";

/**
 * §5.5 uploads — the tRPC `research.upload` procedure accepts ALREADY-PARSED
 * text (the frozen contract carries `content: string`); MD/TXT flow through
 * it. Binary PDF uploads come in over the dedicated multipart route
 * (app/api/research-upload) which extracts text server-side via
 * `lib/research/pdf.ts` and then persists through `savePdfUpload` below —
 * same research_docs storage, same per-plan word caps, same citation path as
 * paste/url (a PDF doc's per-fact source is its filename).
 *
 * Word caps by plan: 5k words on free, 25k on any paid tier (spec §5.5).
 */

export const FREE_UPLOAD_WORD_CAP = 5_000;
export const PAID_UPLOAD_WORD_CAP = 25_000;

export function uploadWordCap(plan: Plan): number {
  return plan === "free" ? FREE_UPLOAD_WORD_CAP : PAID_UPLOAD_WORD_CAP;
}

export class UploadCapError extends Error {
  constructor(
    public readonly wordCount: number,
    public readonly cap: number,
  ) {
    super(`upload is ${wordCount} words; the cap on your plan is ${cap}`);
    this.name = "UploadCapError";
  }
}

export async function saveUpload(
  deps: EngineDeps,
  params: {
    workspaceId: WorkspaceId;
    projectId: ProjectId;
    filename: string;
    kind: ResearchKind;
    content: string;
  },
): Promise<ResearchDoc> {
  const plan = (await deps.store.getWorkspacePlan(params.workspaceId)) ?? "free";
  const cap = uploadWordCap(plan);
  const wordCount = countWords(params.content);
  if (wordCount > cap) {
    throw new UploadCapError(wordCount, cap);
  }
  const content = params.content.slice(0, RESEARCH_DOC_CONTENT_CAP);
  return deps.store.insertResearchDoc({
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    kind: params.kind,
    sourceUrl: null,
    title: params.filename,
    content,
    wordCount,
  });
}

/**
 * Extract text from an uploaded PDF and persist it as a `kind: "upload"`
 * research doc, attributed to the filename. Validation (magic number, size
 * cap, parse timeout) happens inside `extractPdfText`; the per-plan word cap
 * is enforced by `saveUpload`. No credit is charged — identical to the
 * paste/url text-upload path.
 */
export async function savePdfUpload(
  deps: EngineDeps,
  params: {
    workspaceId: WorkspaceId;
    projectId: ProjectId;
    filename: string;
    bytes: Uint8Array;
  },
  pdfOptions: ExtractPdfOptions = {},
): Promise<ResearchDoc> {
  const { text } = await extractPdfText(params.bytes, { mode: deps.mode, ...pdfOptions });
  return saveUpload(deps, {
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    filename: params.filename,
    kind: "upload",
    content: text,
  });
}
