"use client";

import { skipToken } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ChatThread } from "@/lib/types/entities";
import type { ChatThreadId, ProjectId } from "@/lib/types/ids";
import { trpc } from "@/components/providers/trpc";
import { useWorkspace } from "@/components/providers/workspace-context";
import { useToast } from "@/components/ui/toast";
import { useRateLimitBackoff, type RateLimitBackoff } from "./rate-limit";

/**
 * ONE chat.listThreads query per surface (F0 — Coach reliability).
 *
 * The thread list is owned here, at the page/provider level, and every child
 * (the ChatPanel, its sidebar rail, any future switcher) reads it from
 * context. Children never call chat.listThreads themselves and never
 * invalidate it on send/done/confirm — the list changes only when a thread is
 * created, renamed or deleted, and those are the only callers of
 * `invalidate()`. Reads stay cached for CHAT_LIST_STALE_MS and never refetch
 * on window focus, so remounting a panel is a cache read, not a request.
 *
 * The SELECTION lives here too (F1): the shell's left rail and the chat
 * panel both render the thread list, so which thread is open must be one
 * piece of state they share — not two copies that drift.
 */

export const CHAT_LIST_STALE_MS = 30_000;
export const CHAT_LIST_LIMIT = 50;

export interface ChatThreadsContextValue {
  projectId: ProjectId | null;
  threads: ChatThread[];
  /** First load in flight (no data yet). */
  loading: boolean;
  /** The list has loaded at least once (may be stale while a refetch fails). */
  hasData: boolean;
  /** A non-rate-limit failure with no data to show. */
  failed: boolean;
  backoff: RateLimitBackoff;
  refetch: () => void;
  /** Invalidate the list — createThread/renameThread/deleteThread only. */
  invalidate: () => Promise<void>;
  /** The open thread; defaults to the most recent once the list loads. */
  selectedId: ChatThreadId | null;
  select: (id: ChatThreadId | null) => void;
  /** Create a thread and open it; resolves to the thread, or null on failure (already toasted). */
  startThread: () => Promise<ChatThread | null>;
  creating: boolean;
}

const Ctx = createContext<ChatThreadsContextValue | null>(null);

export function ChatThreadsProvider({
  projectId,
  enabled = true,
  children,
}: {
  projectId: ProjectId | null;
  /**
   * False parks the provider: no listThreads request, an empty list. Lets
   * the app shell keep ONE provider mounted on every route (stable tree, no
   * remounts on navigation) while only chat surfaces actually fetch.
   */
  enabled?: boolean;
  children: ReactNode;
}) {
  const { workspaceId } = useWorkspace();
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const query = trpc.chat.listThreads.useQuery(
    enabled && workspaceId !== null
      ? { workspaceId, projectId, limit: CHAT_LIST_LIMIT }
      : skipToken,
    { staleTime: CHAT_LIST_STALE_MS, refetchOnWindowFocus: false, refetchOnReconnect: false },
  );
  const backoff = useRateLimitBackoff(query);

  const threads = useMemo(() => query.data ?? [], [query.data]);
  const { refetch: refetchQuery } = query;
  const refetch = useCallback(() => {
    void refetchQuery();
  }, [refetchQuery]);
  const invalidate = useCallback(() => utils.chat.listThreads.invalidate(), [utils]);

  const [selectedId, setSelectedId] = useState<ChatThreadId | null>(null);
  // Default-select the most recent thread once threads load.
  useEffect(() => {
    const first = threads[0];
    if (selectedId === null && first !== undefined) setSelectedId(first.id);
  }, [threads, selectedId]);

  const createMutation = trpc.chat.createThread.useMutation({
    onSuccess: (thread) => {
      void invalidate();
      setSelectedId(thread.id);
    },
    onError: () => {
      toast("Couldn't start a new conversation.");
    },
  });
  const { mutateAsync: createThread, isPending: creating } = createMutation;
  const startThread = useCallback(async (): Promise<ChatThread | null> => {
    if (workspaceId === null) return null;
    try {
      return await createThread({
        workspaceId,
        projectId,
        title: projectId === null ? "New coach chat" : "New conversation",
      });
    } catch {
      return null; // onError already toasted
    }
  }, [workspaceId, projectId, createThread]);

  const value = useMemo<ChatThreadsContextValue>(
    () => ({
      projectId,
      threads,
      loading: query.isLoading,
      hasData: query.data !== undefined,
      failed: query.isError && !backoff.limited && query.data === undefined,
      backoff,
      refetch,
      invalidate,
      selectedId,
      select: setSelectedId,
      startThread,
      creating,
    }),
    [
      projectId,
      threads,
      query.isLoading,
      query.isError,
      query.data,
      backoff,
      refetch,
      invalidate,
      selectedId,
      startThread,
      creating,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * For shell chrome that renders on every route but only has a thread
 * context on chat surfaces (the top bar's "New chat" action). Null outside a
 * provider — never a throw.
 */
export function useOptionalChatThreads(): ChatThreadsContextValue | null {
  return useContext(Ctx);
}

export function useChatThreads(): ChatThreadsContextValue {
  const value = useContext(Ctx);
  if (value === null) {
    throw new Error("useChatThreads must be used inside <ChatThreadsProvider>");
  }
  return value;
}
