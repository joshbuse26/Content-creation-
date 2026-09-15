"use client";

import { skipToken } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import type { ChatThread } from "@/lib/types/entities";
import type { ProjectId } from "@/lib/types/ids";
import { trpc } from "@/components/providers/trpc";
import { useWorkspace } from "@/components/providers/workspace-context";
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
}

const Ctx = createContext<ChatThreadsContextValue | null>(null);

export function ChatThreadsProvider({
  projectId,
  children,
}: {
  projectId: ProjectId | null;
  children: ReactNode;
}) {
  const { workspaceId } = useWorkspace();
  const utils = trpc.useUtils();

  const query = trpc.chat.listThreads.useQuery(
    workspaceId !== null ? { workspaceId, projectId, limit: CHAT_LIST_LIMIT } : skipToken,
    { staleTime: CHAT_LIST_STALE_MS, refetchOnWindowFocus: false, refetchOnReconnect: false },
  );
  const backoff = useRateLimitBackoff(query);

  const threads = useMemo(() => query.data ?? [], [query.data]);
  const { refetch: refetchQuery } = query;
  const refetch = useCallback(() => {
    void refetchQuery();
  }, [refetchQuery]);
  const invalidate = useCallback(() => utils.chat.listThreads.invalidate(), [utils]);

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
    }),
    [projectId, threads, query.isLoading, query.isError, query.data, backoff, refetch, invalidate],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChatThreads(): ChatThreadsContextValue {
  const value = useContext(Ctx);
  if (value === null) {
    throw new Error("useChatThreads must be used inside <ChatThreadsProvider>");
  }
  return value;
}
