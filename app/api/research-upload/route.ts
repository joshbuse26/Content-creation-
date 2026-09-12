import { NextResponse } from "next/server";
import { assertAccess } from "@/lib/authz";
import { logger } from "@/lib/logger";
import { PdfError, PDF_MAX_BYTES } from "@/lib/research/pdf";
import { asUserId, projectIdSchema, workspaceIdSchema } from "@/lib/types/ids";
import { getEngineDeps } from "@/pipelines/script/deps";
import { savePdfUpload, UploadCapError } from "@/pipelines/research/upload";
import { getRoleResolver } from "@/server/membership";
import { clientIpFromRequest, enforceRateLimitHttp } from "@/server/ratelimit";
import { getSessionWithFixtureFallback } from "@/server/session";

/**
 * POST /api/research-upload — binary PDF research upload (WAVE-D-PLAN §3 D4).
 *
 * Kept outside tRPC because tRPC carries JSON, not binary; the text
 * `research.upload` procedure stays as-is for MD/TXT/paste. Auth mirrors the
 * thumbnail-image route: session required, then assertAccess
 * (research:create) on the workspace, then the project's row-level workspace
 * check — a missing/foreign project is a 404, indistinguishable.
 *
 * Accepts multipart/form-data: `workspaceId`, `projectId`, and a `file` PDF.
 * The file is validated (magic number, size cap) and parsed to text behind a
 * hard timeout in `extractPdfText`, then stored as a `kind:"upload"`
 * research_doc attributed to the filename — identical storage, word caps and
 * citation path to paste/url research. No credit is charged (same as the
 * text-upload path). The response is the created research doc as JSON (dates
 * ISO-encoded; this is a direct-fetch endpoint, not a superjson tRPC call).
 */

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const session = await getSessionWithFixtureFallback();
  const sessionUserId = session?.user.id ?? "";
  if (sessionUserId === "") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const denied = await enforceRateLimitHttp(
    "general",
    `research-upload:${sessionUserId}:${clientIpFromRequest(req)}`,
  );
  if (denied !== null) return denied;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }

  const ws = workspaceIdSchema.safeParse(form.get("workspaceId"));
  const pj = projectIdSchema.safeParse(form.get("projectId"));
  if (!ws.success || !pj.success) {
    return NextResponse.json({ error: "invalid workspaceId or projectId" }, { status: 400 });
  }
  const workspaceId = ws.data;
  const projectId = pj.data;

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }
  if (file.size > PDF_MAX_BYTES) {
    return NextResponse.json(
      { error: `PDF is ${file.size} bytes; the cap is ${PDF_MAX_BYTES}` },
      { status: 413 },
    );
  }

  try {
    await assertAccess(
      asUserId(sessionUserId),
      workspaceId,
      "research",
      "create",
      getRoleResolver(),
    );
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const deps = await getEngineDeps();
  const project = await deps.store.getProject(workspaceId, projectId);
  if (project === null) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const filename = typeof file.name === "string" && file.name !== "" ? file.name : "upload.pdf";
  const bytes = new Uint8Array(await file.arrayBuffer());

  try {
    const doc = await savePdfUpload(deps, { workspaceId, projectId, filename, bytes });
    return NextResponse.json(doc, { status: 201 });
  } catch (err) {
    if (err instanceof PdfError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    if (err instanceof UploadCapError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "research PDF upload failed",
    );
    return NextResponse.json({ error: "upload failed" }, { status: 500 });
  }
}
