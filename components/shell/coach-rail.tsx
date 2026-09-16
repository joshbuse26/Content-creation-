"use client";

import { useChatThreads } from "@/components/chat/chat-threads-context";
import { RateLimitNotice } from "@/components/chat/rate-limit";
import { ThreadList } from "@/components/chat/thread-list";
import { Button } from "@/components/ui/button";
import { IconPlus } from "@/components/ui/icons";

/**
 * The Coach section of the left rail: "+ New chat" and the recent
 * conversations. Reads the ONE ChatThreadsProvider the shell mounts on
 * /coach — it never runs its own listThreads query (F0 request discipline).
 */
export function CoachRail() {
  const threadList = useChatThreads();
  const { threads, selectedId, select, startThread, creating } = threadList;

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2 px-3" aria-label="Chats">
      <Button variant="primary" size="sm" onClick={startThread} busy={creating} className="w-full">
        <IconPlus size={13} /> New chat
      </Button>
      <p className="px-2.5 pt-1 text-[11px] font-semibold tracking-wide text-muted uppercase">
        Recent
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {threadList.backoff.limited && !threadList.hasData ? (
          <RateLimitNotice backoff={threadList.backoff} what="your conversations" />
        ) : threadList.failed ? (
          <p className="px-2.5 py-2 text-xs text-muted">
            Couldn&rsquo;t load conversations.{" "}
            <button
              type="button"
              onClick={threadList.refetch}
              className="cursor-pointer font-medium text-accent-400 hover:underline"
            >
              Retry
            </button>
          </p>
        ) : (
          <ThreadList
            threads={threads}
            loading={threadList.loading}
            selectedId={selectedId}
            onSelect={select}
          />
        )}
      </div>
    </section>
  );
}
