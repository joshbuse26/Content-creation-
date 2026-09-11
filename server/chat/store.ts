import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { getDb, hasDb, schema } from "@/db";
import { fixtureChatMessages, fixtureChatThread, fixtureChatThreadWorkspace } from "@/lib/fixtures";
import { chatMessageSchema, chatThreadSchema } from "@/lib/types/entities";
import type { ChatMessage, ChatThread, ChatToolCall } from "@/lib/types/entities";
import {
  chatMessageIdSchema,
  chatThreadIdSchema,
  type ChatMessageId,
  type ChatThreadId,
  type ProjectId,
  type WorkspaceId,
} from "@/lib/types/ids";
import type { ChatRole } from "@/lib/types/enums";

/**
 * ChatStore — persistence for the chat-first surface (Wave D, D1). Replaces
 * the D0 contract stubs in server/routers/impl/chat.ts with real thread +
 * message storage.
 *
 * Two implementations, selected by getChatStore() exactly like the engine
 * store: Drizzle-backed (production, when DATABASE_URL is set) and in-memory
 * (fixture mode / tests — seeded with the shared chat fixtures so the whole
 * chat surface works with ZERO keys). Every read is workspace-scoped and
 * filters on the denormalized workspace_id column, so cross-workspace thread
 * or message access is indistinguishable from a missing row (NOT_FOUND at
 * the router). chat_messages.seq is assigned monotonically per thread.
 */

export interface NewChatMessage {
  /** Optional explicit id — the SSE route persists the assistant message at
   *  the id it handed the client in the sendMessage ack. */
  id?: ChatMessageId;
  threadId: ChatThreadId;
  workspaceId: WorkspaceId;
  role: ChatRole;
  content: string;
  toolCalls?: ChatToolCall[] | null;
  toolCallId?: string | null;
  creditsCharged?: number;
}

export interface MessagePage {
  messages: ChatMessage[];
  nextCursor: number | null;
}

export interface ChatStore {
  listThreads(
    workspaceId: WorkspaceId,
    opts: { projectId: ProjectId | null; limit: number },
  ): Promise<ChatThread[]>;
  getThread(workspaceId: WorkspaceId, threadId: ChatThreadId): Promise<ChatThread | null>;
  createThread(params: {
    workspaceId: WorkspaceId;
    projectId: ProjectId | null;
    title: string;
  }): Promise<ChatThread>;
  renameThread(
    workspaceId: WorkspaceId,
    threadId: ChatThreadId,
    title: string,
  ): Promise<ChatThread | null>;
  deleteThread(workspaceId: WorkspaceId, threadId: ChatThreadId): Promise<boolean>;
  /** A seq-ordered page of messages with seq > cursor (null ⇒ from the start). */
  getMessages(
    workspaceId: WorkspaceId,
    threadId: ChatThreadId,
    opts: { cursor: number | null; limit: number },
  ): Promise<MessagePage>;
  /** Every message in a thread, seq-ascending (history + proposal lookup). */
  listMessages(workspaceId: WorkspaceId, threadId: ChatThreadId): Promise<ChatMessage[]>;
  getMessage(workspaceId: WorkspaceId, messageId: ChatMessageId): Promise<ChatMessage | null>;
  /** Appends a message, assigning the next monotonic seq for the thread. */
  appendMessage(message: NewChatMessage): Promise<ChatMessage>;
}

// ---------------------------------------------------------------------------
// In-memory store (fixture mode / tests)
// ---------------------------------------------------------------------------

const clone = <T>(value: T): T => structuredClone(value);

export class InMemoryChatStore implements ChatStore {
  private threads: ChatThread[] = [];
  private messages: ChatMessage[] = [];

  constructor(seed = true) {
    if (seed) {
      this.threads = [clone(fixtureChatThread), clone(fixtureChatThreadWorkspace)];
      this.messages = fixtureChatMessages.map(clone);
    }
  }

  listThreads(
    workspaceId: WorkspaceId,
    opts: { projectId: ProjectId | null; limit: number },
  ): Promise<ChatThread[]> {
    const threads = this.threads
      .filter((t) => t.workspaceId === workspaceId)
      .filter((t) => opts.projectId === null || t.projectId === opts.projectId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, opts.limit)
      .map(clone);
    return Promise.resolve(threads);
  }

  getThread(workspaceId: WorkspaceId, threadId: ChatThreadId): Promise<ChatThread | null> {
    const thread = this.threads.find((t) => t.id === threadId && t.workspaceId === workspaceId);
    return Promise.resolve(thread === undefined ? null : clone(thread));
  }

  createThread(params: {
    workspaceId: WorkspaceId;
    projectId: ProjectId | null;
    title: string;
  }): Promise<ChatThread> {
    const now = new Date();
    const thread = chatThreadSchema.parse({
      id: chatThreadIdSchema.parse(randomUUID()),
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      title: params.title,
      createdAt: now,
      updatedAt: now,
    });
    this.threads.push(clone(thread));
    return Promise.resolve(thread);
  }

  renameThread(
    workspaceId: WorkspaceId,
    threadId: ChatThreadId,
    title: string,
  ): Promise<ChatThread | null> {
    const thread = this.threads.find((t) => t.id === threadId && t.workspaceId === workspaceId);
    if (thread === undefined) return Promise.resolve(null);
    thread.title = title;
    thread.updatedAt = new Date();
    return Promise.resolve(clone(thread));
  }

  deleteThread(workspaceId: WorkspaceId, threadId: ChatThreadId): Promise<boolean> {
    const before = this.threads.length;
    this.threads = this.threads.filter(
      (t) => !(t.id === threadId && t.workspaceId === workspaceId),
    );
    const removed = this.threads.length < before;
    if (removed) this.messages = this.messages.filter((m) => m.threadId !== threadId);
    return Promise.resolve(removed);
  }

  getMessages(
    workspaceId: WorkspaceId,
    threadId: ChatThreadId,
    opts: { cursor: number | null; limit: number },
  ): Promise<MessagePage> {
    const after = opts.cursor ?? -1;
    const all = this.messages
      .filter((m) => m.threadId === threadId && m.workspaceId === workspaceId && m.seq > after)
      .sort((a, b) => a.seq - b.seq);
    const messages = all.slice(0, opts.limit).map(clone);
    const last = messages[messages.length - 1];
    const nextCursor = last !== undefined && all.length > messages.length ? last.seq : null;
    return Promise.resolve({ messages, nextCursor });
  }

  listMessages(workspaceId: WorkspaceId, threadId: ChatThreadId): Promise<ChatMessage[]> {
    const all = this.messages
      .filter((m) => m.threadId === threadId && m.workspaceId === workspaceId)
      .sort((a, b) => a.seq - b.seq)
      .map(clone);
    return Promise.resolve(all);
  }

  getMessage(workspaceId: WorkspaceId, messageId: ChatMessageId): Promise<ChatMessage | null> {
    const msg = this.messages.find((m) => m.id === messageId && m.workspaceId === workspaceId);
    return Promise.resolve(msg === undefined ? null : clone(msg));
  }

  appendMessage(message: NewChatMessage): Promise<ChatMessage> {
    const maxSeq = this.messages
      .filter((m) => m.threadId === message.threadId)
      .reduce((max, m) => Math.max(max, m.seq), -1);
    const row = chatMessageSchema.parse({
      id: message.id ?? chatMessageIdSchema.parse(randomUUID()),
      threadId: message.threadId,
      workspaceId: message.workspaceId,
      role: message.role,
      content: message.content,
      toolCalls: message.toolCalls ?? null,
      toolCallId: message.toolCallId ?? null,
      creditsCharged: message.creditsCharged ?? 0,
      seq: maxSeq + 1,
      createdAt: new Date(),
    });
    this.messages.push(clone(row));
    const thread = this.threads.find((t) => t.id === message.threadId);
    if (thread !== undefined) thread.updatedAt = new Date();
    return Promise.resolve(row);
  }
}

// ---------------------------------------------------------------------------
// Drizzle store (production)
// ---------------------------------------------------------------------------

export class DrizzleChatStore implements ChatStore {
  async listThreads(
    workspaceId: WorkspaceId,
    opts: { projectId: ProjectId | null; limit: number },
  ): Promise<ChatThread[]> {
    const where =
      opts.projectId === null
        ? eq(schema.chatThreads.workspaceId, workspaceId)
        : and(
            eq(schema.chatThreads.workspaceId, workspaceId),
            eq(schema.chatThreads.projectId, opts.projectId),
          );
    const rows = await getDb()
      .select()
      .from(schema.chatThreads)
      .where(where)
      .orderBy(desc(schema.chatThreads.updatedAt))
      .limit(opts.limit);
    return rows.map((r) => chatThreadSchema.parse(r));
  }

  async getThread(workspaceId: WorkspaceId, threadId: ChatThreadId): Promise<ChatThread | null> {
    const rows = await getDb()
      .select()
      .from(schema.chatThreads)
      .where(
        and(eq(schema.chatThreads.id, threadId), eq(schema.chatThreads.workspaceId, workspaceId)),
      )
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : chatThreadSchema.parse(row);
  }

  async createThread(params: {
    workspaceId: WorkspaceId;
    projectId: ProjectId | null;
    title: string;
  }): Promise<ChatThread> {
    const rows = await getDb()
      .insert(schema.chatThreads)
      .values({
        workspaceId: params.workspaceId,
        projectId: params.projectId,
        title: params.title,
      })
      .returning();
    const row = rows[0];
    if (row === undefined) throw new Error("chat thread insert returned no row");
    return chatThreadSchema.parse(row);
  }

  async renameThread(
    workspaceId: WorkspaceId,
    threadId: ChatThreadId,
    title: string,
  ): Promise<ChatThread | null> {
    const rows = await getDb()
      .update(schema.chatThreads)
      .set({ title, updatedAt: new Date() })
      .where(
        and(eq(schema.chatThreads.id, threadId), eq(schema.chatThreads.workspaceId, workspaceId)),
      )
      .returning();
    const row = rows[0];
    return row === undefined ? null : chatThreadSchema.parse(row);
  }

  async deleteThread(workspaceId: WorkspaceId, threadId: ChatThreadId): Promise<boolean> {
    const rows = await getDb()
      .delete(schema.chatThreads)
      .where(
        and(eq(schema.chatThreads.id, threadId), eq(schema.chatThreads.workspaceId, workspaceId)),
      )
      .returning({ id: schema.chatThreads.id });
    return rows.length > 0;
  }

  async getMessages(
    workspaceId: WorkspaceId,
    threadId: ChatThreadId,
    opts: { cursor: number | null; limit: number },
  ): Promise<MessagePage> {
    const after = opts.cursor ?? -1;
    const rows = await getDb()
      .select()
      .from(schema.chatMessages)
      .where(
        and(
          eq(schema.chatMessages.threadId, threadId),
          eq(schema.chatMessages.workspaceId, workspaceId),
          gt(schema.chatMessages.seq, after),
        ),
      )
      .orderBy(asc(schema.chatMessages.seq))
      .limit(opts.limit + 1);
    const hasMore = rows.length > opts.limit;
    const page = rows.slice(0, opts.limit).map((r) => chatMessageSchema.parse(r));
    const last = page[page.length - 1];
    const nextCursor = hasMore && last !== undefined ? last.seq : null;
    return { messages: page, nextCursor };
  }

  async listMessages(workspaceId: WorkspaceId, threadId: ChatThreadId): Promise<ChatMessage[]> {
    const rows = await getDb()
      .select()
      .from(schema.chatMessages)
      .where(
        and(
          eq(schema.chatMessages.threadId, threadId),
          eq(schema.chatMessages.workspaceId, workspaceId),
        ),
      )
      .orderBy(asc(schema.chatMessages.seq));
    return rows.map((r) => chatMessageSchema.parse(r));
  }

  async getMessage(
    workspaceId: WorkspaceId,
    messageId: ChatMessageId,
  ): Promise<ChatMessage | null> {
    const rows = await getDb()
      .select()
      .from(schema.chatMessages)
      .where(
        and(
          eq(schema.chatMessages.id, messageId),
          eq(schema.chatMessages.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : chatMessageSchema.parse(row);
  }

  async appendMessage(message: NewChatMessage): Promise<ChatMessage> {
    // Next monotonic seq for the thread (the thread_seq unique index is the
    // backstop against a concurrent writer racing the same seq).
    const agg = await getDb()
      .select({ maxSeq: sql<number | null>`max(${schema.chatMessages.seq})` })
      .from(schema.chatMessages)
      .where(eq(schema.chatMessages.threadId, message.threadId));
    const nextSeq = (agg[0]?.maxSeq ?? -1) + 1;
    const rows = await getDb()
      .insert(schema.chatMessages)
      .values({
        ...(message.id !== undefined ? { id: message.id } : {}),
        threadId: message.threadId,
        workspaceId: message.workspaceId,
        role: message.role,
        content: message.content,
        toolCalls: message.toolCalls ?? null,
        toolCallId: message.toolCallId ?? null,
        creditsCharged: message.creditsCharged ?? 0,
        seq: nextSeq,
      })
      .returning();
    const row = rows[0];
    if (row === undefined) throw new Error("chat message insert returned no row");
    // Touch the thread so listThreads orders by recent activity.
    await getDb()
      .update(schema.chatThreads)
      .set({ updatedAt: new Date() })
      .where(eq(schema.chatThreads.id, message.threadId));
    return chatMessageSchema.parse(row);
  }
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

let cached: ChatStore | undefined;

/**
 * Store selection: Drizzle when a database is configured, otherwise the
 * fixture-seeded in-memory store (zero-env mode) — one shared instance per
 * process so the router, the SSE route, and confirmTool see the same data.
 */
export function getChatStore(): ChatStore {
  cached ??= hasDb() ? new DrizzleChatStore() : new InMemoryChatStore();
  return cached;
}

/** Test hook: swap in a fresh store (or a specific instance). */
export function setChatStoreForTests(store: ChatStore | undefined): void {
  cached = store;
}
