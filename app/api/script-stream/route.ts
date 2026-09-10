import { NextResponse } from "next/server";
import { z } from "zod";
import { assertAccess } from "@/lib/authz";
import { logger } from "@/lib/logger";
import { asUserId, scriptIdSchema, workspaceIdSchema } from "@/lib/types/ids";
import { getScriptEventBus } from "@/pipelines/script/events";
import { getEngineStore } from "@/pipelines/script/store";
import { auth } from "@/server/auth";
import { getRoleResolver } from "@/server/membership";
import { createScriptSseStream } from "./stream";

/**
 * GET /api/script-stream?workspaceId=…&scriptId=…
 *
 * Streams the frozen ScriptStreamEvent union as Server-Sent Events while
 * the 7-stage script pipeline runs (spec §5.7: sections streamed to the
 * editor as they complete). Late subscribers replay the full event history
 * for the script, so a page refresh mid-run recovers cleanly.
 *
 * Auth mirrors the tRPC layer: session required, then assertAccess
 * (script:read) on the workspace, then the script's row-level workspace
 * check — an unknown script and a foreign script are indistinguishable.
 */

export const dynamic = "force-dynamic";

const querySchema = z.object({
  workspaceId: workspaceIdSchema,
  scriptId: scriptIdSchema,
});

export async function GET(req: Request): Promise<Response> {
  const session = await auth();
  const sessionUserId = session?.user.id ?? "";
  if (sessionUserId === "") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    workspaceId: url.searchParams.get("workspaceId"),
    scriptId: url.searchParams.get("scriptId"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid query" }, { status: 400 });
  }
  const { workspaceId, scriptId } = parsed.data;

  try {
    await assertAccess(asUserId(sessionUserId), workspaceId, "script", "read", getRoleResolver());
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const script = await getEngineStore().getScript(workspaceId, scriptId);
  if (script === null) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  logger.debug({ scriptId: scriptId }, "script SSE stream opened");
  const stream = createScriptSseStream(getScriptEventBus(), scriptId, {
    signal: req.signal,
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
