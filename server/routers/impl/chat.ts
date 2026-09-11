import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { chatContracts } from "@/lib/types/api";
import type { ChatMessage, ChatThread } from "@/lib/types/entities";
import { chatMessageIdSchema } from "@/lib/types/ids";
import { getChatTool } from "@/lib/chat/tools";
import { getChatStore } from "@/server/chat/store";
import { executeChatTool } from "@/server/chat/execute";
import { badRequest, notFound, type HandlerOpts } from "./_shared";

/**
 * chat router (Wave D — WAVE-D-PLAN §2a), D1 real implementation replacing
 * the D0 stubs. Thread + message storage is Drizzle-backed in production and
 * a fixture-seeded in-memory store keyless (server/chat/store.ts); the
 * streamed assistant reply is served over /api/chat-stream (the chat SSE
 * union), and tool execution goes through confirmTool → the EXISTING staged
 * handlers (server/chat/execute.ts), sharing the staged UI's idempotent
 * ledger path.
 *
 * Every handler is tenancy-scoped twice over: workspaceProcedure enforces
 * authz upstream, and each store read filters on workspace_id so a
 * cross-workspace thread or message is NOT_FOUND.
 */

type ListThreadsInput = z.output<typeof chatContracts.listThreads.input>;
type GetThreadInput = z.output<typeof chatContracts.getThread.input>;
type CreateThreadInput = z.output<typeof chatContracts.createThread.input>;
type SendMessageInput = z.output<typeof chatContracts.sendMessage.input>;
type ConfirmToolInput = z.output<typeof chatContracts.confirmTool.input>;
type RenameThreadInput = z.output<typeof chatContracts.renameThread.input>;
type DeleteThreadInput = z.output<typeof chatContracts.deleteThread.input>;

export const chatImpl = {
  async listThreads({ ctx, input }: HandlerOpts<ListThreadsInput>): Promise<ChatThread[]> {
    return getChatStore().listThreads(ctx.workspaceId, {
      projectId: input.projectId,
      limit: input.limit,
    });
  },

  async getThread({ ctx, input }: HandlerOpts<GetThreadInput>): Promise<{
    thread: ChatThread;
    messages: ChatMessage[];
    nextCursor: number | null;
  }> {
    const store = getChatStore();
    const thread = await store.getThread(ctx.workspaceId, input.threadId);
    if (thread === null) notFound("chat thread");
    const { messages, nextCursor } = await store.getMessages(ctx.workspaceId, input.threadId, {
      cursor: input.cursor,
      limit: input.limit,
    });
    return { thread, messages, nextCursor };
  },

  async createThread({ ctx, input }: HandlerOpts<CreateThreadInput>): Promise<ChatThread> {
    return getChatStore().createThread({
      workspaceId: ctx.workspaceId,
      projectId: input.projectId,
      title: input.title,
    });
  },

  async sendMessage({ ctx, input }: HandlerOpts<SendMessageInput>): Promise<{
    userMessageId: z.infer<typeof chatMessageIdSchema>;
    assistantMessageId: z.infer<typeof chatMessageIdSchema>;
    streamPath: string;
    status: "streaming";
  }> {
    const store = getChatStore();
    const thread = await store.getThread(ctx.workspaceId, input.threadId);
    if (thread === null) notFound("chat thread");

    // Persist the user message now (durable + seq-ordered); the assistant
    // reply is generated and persisted by the SSE route at the id we mint here.
    const userMessage = await store.appendMessage({
      threadId: input.threadId,
      workspaceId: ctx.workspaceId,
      role: "user",
      content: input.content,
    });
    const assistantMessageId = chatMessageIdSchema.parse(randomUUID());

    const streamPath =
      `/api/chat-stream?workspaceId=${encodeURIComponent(ctx.workspaceId)}` +
      `&threadId=${encodeURIComponent(input.threadId)}` +
      `&messageId=${encodeURIComponent(assistantMessageId)}`;
    return {
      userMessageId: userMessage.id,
      assistantMessageId,
      streamPath,
      status: "streaming",
    };
  },

  async confirmTool({ ctx, input }: HandlerOpts<ConfirmToolInput>): Promise<{
    toolCallId: string;
    accepted: boolean;
    estimatedCredits: number;
    status: "accepted";
  }> {
    const store = getChatStore();
    const thread = await store.getThread(ctx.workspaceId, input.threadId);
    if (thread === null) notFound("chat thread");

    // Locate the stored proposal (on an assistant message's tool_calls) so the
    // tool NAME is authoritative — the client only echoes the id + args.
    const messages = await store.listMessages(ctx.workspaceId, input.threadId);
    const proposal = messages
      .flatMap((m) => m.toolCalls ?? [])
      .find((c) => c.toolCallId === input.toolCallId);
    if (proposal === undefined) notFound("tool proposal");

    const tool = getChatTool(proposal.name);
    if (tool === null) notFound("chat tool");

    // Re-validate the (possibly user-edited) args against the tool's frozen
    // arg schema before anything runs or charges.
    const validated = tool.argsSchema.safeParse(input.args);
    if (!validated.success) {
      badRequest(`invalid arguments for ${proposal.name}: ${validated.error.message}`);
    }
    const args = validated.data as Record<string, unknown>;

    // Execute via the existing staged handler (shared idempotent charge path,
    // licensed guard + mode checks intact). Credits may throw PRECONDITION_FAILED.
    const result = await executeChatTool({ ctx, name: proposal.name, args });

    await store.appendMessage({
      threadId: input.threadId,
      workspaceId: ctx.workspaceId,
      role: "tool",
      content: result.summary,
      toolCallId: input.toolCallId,
      creditsCharged: result.creditsCharged,
    });

    return {
      toolCallId: input.toolCallId,
      accepted: true,
      estimatedCredits: result.creditsCharged,
      status: "accepted",
    };
  },

  async renameThread({ ctx, input }: HandlerOpts<RenameThreadInput>): Promise<ChatThread> {
    const thread = await getChatStore().renameThread(ctx.workspaceId, input.threadId, input.title);
    if (thread === null) notFound("chat thread");
    return thread;
  },

  async deleteThread({
    ctx,
    input,
  }: HandlerOpts<DeleteThreadInput>): Promise<{ deleted: boolean }> {
    const deleted = await getChatStore().deleteThread(ctx.workspaceId, input.threadId);
    if (!deleted) notFound("chat thread");
    return { deleted };
  },
};
