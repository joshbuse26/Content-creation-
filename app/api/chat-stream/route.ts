import { NextResponse } from "next/server";
import { z } from "zod";
import { assertAccess } from "@/lib/authz";
import { logger } from "@/lib/logger";
import {
  asUserId,
  chatMessageIdSchema,
  chatThreadIdSchema,
  scriptIdSchema,
  workspaceIdSchema,
} from "@/lib/types/ids";
import { getScriptEventBus } from "@/pipelines/script/events";
import { getEngineStore } from "@/pipelines/script/store";
import { getChatStore } from "@/server/chat/store";
import { bridgeDraftStream, runAssistantTurn } from "@/server/chat/turn";
import { getRoleResolver } from "@/server/membership";
import { clientIpFromRequest, enforceRateLimitHttp } from "@/server/ratelimit";
import { getSessionWithFixtureFallback } from "@/server/session";
import { createChatSseStream } from "./stream";

/**
 * GET /api/chat-stream — the chat SSE surface (Wave D, D1). Two modes, both
 * emitting the frozen chat event union (lib/types/chat.ts):
 *
 *  - assistant turn: ?workspaceId=&threadId=&messageId= — streams the Coach's
 *    reply (message_delta…), an optional tool_proposed, then done. The
 *    assistant message is persisted at `messageId` (the sendMessage ack id).
 *  - draft bridge: ?workspaceId=&scriptId=&toolCallId= — re-streams a draft
 *    tool's sections (message_delta per section) and a terminal tool_result,
 *    bridged from the existing script event bus.
 *
 * Auth mirrors the script stream: session required, then assertAccess
 * (chat:read) on the workspace, then the row-level workspace check on the
 * thread/script — an unknown or foreign row is a 404, indistinguishable.
 */

export const dynamic = "force-dynamic";

const turnQuerySchema = z.object({
  workspaceId: workspaceIdSchema,
  threadId: chatThreadIdSchema,
  messageId: chatMessageIdSchema,
});

const bridgeQuerySchema = z.object({
  workspaceId: workspaceIdSchema,
  scriptId: scriptIdSchema,
  toolCallId: z.string().min(1),
});

const STREAM_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

export async function GET(req: Request): Promise<Response> {
  const session = await getSessionWithFixtureFallback();
  const sessionUserId = session?.user.id ?? "";
  if (sessionUserId === "") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const denied = await enforceRateLimitHttp(
    "general",
    `chat-sse:${sessionUserId}:${clientIpFromRequest(req)}`,
  );
  if (denied !== null) return denied;

  const url = new URL(req.url);
  const scriptIdParam = url.searchParams.get("scriptId");

  // --- draft bridge mode -------------------------------------------------
  if (scriptIdParam !== null) {
    const parsed = bridgeQuerySchema.safeParse({
      workspaceId: url.searchParams.get("workspaceId"),
      scriptId: scriptIdParam,
      toolCallId: url.searchParams.get("toolCallId"),
    });
    if (!parsed.success) return NextResponse.json({ error: "invalid query" }, { status: 400 });
    const { workspaceId, scriptId, toolCallId } = parsed.data;
    try {
      await assertAccess(asUserId(sessionUserId), workspaceId, "chat", "read", getRoleResolver());
    } catch {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const script = await getEngineStore().getScript(workspaceId, scriptId);
    if (script === null) return NextResponse.json({ error: "not found" }, { status: 404 });
    const stream = createChatSseStream(
      bridgeDraftStream({ bus: getScriptEventBus(), scriptId, toolCallId, signal: req.signal }),
    );
    return new Response(stream, { headers: STREAM_HEADERS });
  }

  // --- assistant turn mode ----------------------------------------------
  const parsed = turnQuerySchema.safeParse({
    workspaceId: url.searchParams.get("workspaceId"),
    threadId: url.searchParams.get("threadId"),
    messageId: url.searchParams.get("messageId"),
  });
  if (!parsed.success) return NextResponse.json({ error: "invalid query" }, { status: 400 });
  const { workspaceId, threadId, messageId } = parsed.data;

  try {
    await assertAccess(asUserId(sessionUserId), workspaceId, "chat", "read", getRoleResolver());
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const thread = await getChatStore().getThread(workspaceId, threadId);
  if (thread === null) return NextResponse.json({ error: "not found" }, { status: 404 });

  logger.debug({ threadId }, "chat SSE stream opened");
  const stream = createChatSseStream(
    runAssistantTurn({
      workspaceId,
      threadId,
      projectId: thread.projectId,
      assistantMessageId: messageId,
    }),
  );
  return new Response(stream, { headers: STREAM_HEADERS });
}
