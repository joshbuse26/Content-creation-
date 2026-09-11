import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { fixtureChatMessages, fixtureChatThread, fixtureChatThreadWorkspace } from "@/lib/fixtures";
import type { chatContracts } from "@/lib/types/api";
import type { ChatMessage, ChatThread } from "@/lib/types/entities";
import { chatMessageIdSchema, chatThreadIdSchema } from "@/lib/types/ids";
import { estimateToolCredits } from "@/lib/chat/tools";
import { notFound, type HandlerOpts } from "./_shared";

type ListThreadsInput = z.output<typeof chatContracts.listThreads.input>;
type GetThreadInput = z.output<typeof chatContracts.getThread.input>;
type CreateThreadInput = z.output<typeof chatContracts.createThread.input>;
type SendMessageInput = z.output<typeof chatContracts.sendMessage.input>;
type ConfirmToolInput = z.output<typeof chatContracts.confirmTool.input>;
type RenameThreadInput = z.output<typeof chatContracts.renameThread.input>;
type DeleteThreadInput = z.output<typeof chatContracts.deleteThread.input>;

/**
 * chat router (Wave D — WAVE-D-PLAN §2a) — FROZEN CONTRACT STUBS. D0 freezes
 * the surface and returns realistic fixtures so a chat screen + tool flow can
 * be built against it keylessly. D1 replaces these bodies with real thread
 * storage, system-context assembly (buildCoachContext), streamed replies
 * (chat SSE union), and tool proposal→confirm→staged-pipeline execution.
 *
 * Zero-cost by contract: none of these procedures charge credits — the
 * credit-costing happens inside tool execution (confirmTool → staged handler,
 * D1), sharing the staged UI's idempotent ledger path.
 *
 * All handlers are tenancy-scoped: workspaceProcedure enforces authz upstream,
 * and the stubs only ever surface fixtures for the caller's own workspace.
 */

/** The stub's known threads, scoped to the fixture workspace. */
function stubThreads(): ChatThread[] {
  return [fixtureChatThread, fixtureChatThreadWorkspace];
}

function findStubThread(threadId: string): ChatThread | null {
  return stubThreads().find((t) => t.id === threadId) ?? null;
}

export const chatImpl = {
  async listThreads({ ctx, input }: HandlerOpts<ListThreadsInput>): Promise<ChatThread[]> {
    const threads = stubThreads()
      .filter((t) => t.workspaceId === ctx.workspaceId)
      .filter((t) => input.projectId === null || t.projectId === input.projectId)
      .slice(0, input.limit);
    return Promise.resolve(threads);
  },

  async getThread({ ctx, input }: HandlerOpts<GetThreadInput>): Promise<{
    thread: ChatThread;
    messages: ChatMessage[];
    nextCursor: number | null;
  }> {
    const thread = findStubThread(input.threadId);
    if (thread === null || thread.workspaceId !== ctx.workspaceId) notFound("chat thread");
    // Page by seq: return messages with seq > cursor, capped at limit.
    const after = input.cursor ?? -1;
    const all = fixtureChatMessages
      .filter((m) => m.threadId === input.threadId && m.seq > after)
      .sort((a, b) => a.seq - b.seq);
    const messages = all.slice(0, input.limit);
    const last = messages[messages.length - 1];
    const nextCursor = last !== undefined && all.length > messages.length ? last.seq : null;
    return Promise.resolve({ thread, messages, nextCursor });
  },

  async createThread({ ctx, input }: HandlerOpts<CreateThreadInput>): Promise<ChatThread> {
    const now = new Date();
    const thread: ChatThread = {
      id: chatThreadIdSchema.parse(randomUUID()),
      workspaceId: ctx.workspaceId,
      projectId: input.projectId,
      title: input.title,
      createdAt: now,
      updatedAt: now,
    };
    return Promise.resolve(thread);
  },

  async sendMessage({ ctx, input }: HandlerOpts<SendMessageInput>): Promise<{
    userMessageId: z.infer<typeof chatMessageIdSchema>;
    assistantMessageId: z.infer<typeof chatMessageIdSchema>;
    streamPath: string;
    status: "streaming";
  }> {
    const thread = findStubThread(input.threadId);
    if (thread === null || thread.workspaceId !== ctx.workspaceId) notFound("chat thread");
    const userMessageId = chatMessageIdSchema.parse(randomUUID());
    const assistantMessageId = chatMessageIdSchema.parse(randomUUID());
    // D1 serves the streamed reply over the chat SSE union at this path.
    const streamPath =
      `/api/chat-stream?workspaceId=${encodeURIComponent(ctx.workspaceId)}` +
      `&threadId=${encodeURIComponent(input.threadId)}` +
      `&messageId=${encodeURIComponent(assistantMessageId)}`;
    return Promise.resolve({
      userMessageId,
      assistantMessageId,
      streamPath,
      status: "streaming",
    });
  },

  async confirmTool({ ctx, input }: HandlerOpts<ConfirmToolInput>): Promise<{
    toolCallId: string;
    accepted: boolean;
    estimatedCredits: number;
    status: "accepted";
  }> {
    const thread = findStubThread(input.threadId);
    if (thread === null || thread.workspaceId !== ctx.workspaceId) notFound("chat thread");
    // D0 stub acks. The real estimate resolves from the stored proposal's
    // tool name (D1); if the args carry a `name` hint, quote it, else 0.
    const name = typeof input.args.name === "string" ? input.args.name : "";
    return Promise.resolve({
      toolCallId: input.toolCallId,
      accepted: true,
      estimatedCredits: estimateToolCredits(name, input.args),
      status: "accepted",
    });
  },

  async renameThread({ ctx, input }: HandlerOpts<RenameThreadInput>): Promise<ChatThread> {
    const thread = findStubThread(input.threadId);
    if (thread === null || thread.workspaceId !== ctx.workspaceId) notFound("chat thread");
    return Promise.resolve({ ...thread, title: input.title, updatedAt: new Date() });
  },

  async deleteThread({
    ctx,
    input,
  }: HandlerOpts<DeleteThreadInput>): Promise<{ deleted: boolean }> {
    const thread = findStubThread(input.threadId);
    if (thread === null || thread.workspaceId !== ctx.workspaceId) notFound("chat thread");
    return Promise.resolve({ deleted: true });
  },
};
