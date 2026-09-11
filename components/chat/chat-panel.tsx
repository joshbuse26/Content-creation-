"use client";

import Link from "next/link";
import { skipToken } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, ChatThread, ChatToolCall } from "@/lib/types/entities";
import type { ChatThreadId, ProjectId, WorkspaceId } from "@/lib/types/ids";
import { COACH_NAME } from "@/lib/branding";
import { trpc } from "@/components/providers/trpc";
import { useWorkspace } from "@/components/providers/workspace-context";
import { Button, IconButton } from "@/components/ui/button";
import { IconArrowUp, IconPlus, IconSparkle, IconTrash, IconPencil } from "@/components/ui/icons";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/state";
import { useToast } from "@/components/ui/toast";
import { useChatStream } from "./use-chat-stream";
import { toolLabel } from "./tool-labels";

/**
 * Chat-first surface (Wave D, D1) — the default project path and the
 * workspace-level coach. A thread list/switcher, a streaming message list
 * (user / assistant / tool bubbles), a composer, and inline tool-confirmation
 * cards that call chat.confirmTool and meter through the staged pipeline.
 *
 * `projectId` null = the workspace-level coach thread. The persona is product-
 * native throughout (COACH_NAME); the underlying model is never named.
 */

export function ChatPanel({ projectId }: { projectId: ProjectId | null }) {
  const { workspaceId } = useWorkspace();
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const [selectedId, setSelectedId] = useState<ChatThreadId | null>(null);

  const threadsQuery = trpc.chat.listThreads.useQuery(
    workspaceId !== null ? { workspaceId, projectId, limit: 50 } : skipToken,
  );
  const threads = useMemo(() => threadsQuery.data ?? [], [threadsQuery.data]);

  // Default-select the most recent thread once threads load.
  useEffect(() => {
    const first = threads[0];
    if (selectedId === null && first !== undefined) setSelectedId(first.id);
  }, [threads, selectedId]);

  const createMutation = trpc.chat.createThread.useMutation({
    onSuccess: (thread) => {
      void utils.chat.listThreads.invalidate();
      setSelectedId(thread.id);
    },
    onError: () => {
      toast("Couldn't start a new conversation.");
    },
  });

  const startThread = useCallback(() => {
    if (workspaceId === null) return;
    createMutation.mutate({
      workspaceId,
      projectId,
      title: projectId === null ? "New coach chat" : "New conversation",
    });
  }, [workspaceId, projectId, createMutation]);

  if (workspaceId === null) return <LoadingState label="Loading workspace…" />;
  if (threadsQuery.isError) {
    return (
      <ErrorState
        message="Couldn't load your conversations."
        onRetry={() => {
          void threadsQuery.refetch();
        }}
      />
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
      <ThreadSidebar
        threads={threads}
        loading={threadsQuery.isLoading}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onNew={startThread}
        creating={createMutation.isPending}
      />
      <div className="min-w-0">
        {selectedId === null ? (
          <EmptyState
            title={`Chat with ${COACH_NAME}`}
            hint={
              projectId === null
                ? "Your channel coach helps you plan videos and run any studio tool."
                : "Plan this video conversationally — ask for hooks, an outline, a full draft, titles, or research."
            }
            action={
              <Button variant="primary" onClick={startThread} busy={createMutation.isPending}>
                <IconPlus size={14} /> Start a conversation
              </Button>
            }
          />
        ) : (
          <ChatThreadView
            key={selectedId}
            workspaceId={workspaceId}
            threadId={selectedId}
            projectId={projectId}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thread sidebar
// ---------------------------------------------------------------------------

function ThreadSidebar({
  threads,
  loading,
  selectedId,
  onSelect,
  onNew,
  creating,
}: {
  threads: ChatThread[];
  loading: boolean;
  selectedId: ChatThreadId | null;
  onSelect: (id: ChatThreadId) => void;
  onNew: () => void;
  creating: boolean;
}) {
  return (
    <aside className="flex flex-col gap-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={onNew}
        busy={creating}
        className="w-full justify-start"
      >
        <IconPlus size={13} /> New chat
      </Button>
      <ul className="flex flex-col gap-0.5" aria-label="Conversations">
        {loading ? (
          <li className="px-2 py-2 text-xs text-zinc-400">Loading…</li>
        ) : threads.length === 0 ? (
          <li className="px-2 py-2 text-xs text-zinc-400">No conversations yet.</li>
        ) : (
          threads.map((t) => {
            const active = t.id === selectedId;
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(t.id);
                  }}
                  aria-current={active ? "true" : undefined}
                  className={`w-full truncate rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                    active
                      ? "bg-emerald-50 font-medium text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                      : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  }`}
                >
                  {t.title}
                </button>
              </li>
            );
          })
        )}
      </ul>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// A single thread: messages + composer + tool cards
// ---------------------------------------------------------------------------

interface LiveTurn {
  text: string;
  proposal: ChatToolCall | null;
  streaming: boolean;
}

function ChatThreadView({
  workspaceId,
  threadId,
  projectId,
}: {
  workspaceId: WorkspaceId;
  threadId: ChatThreadId;
  projectId: ProjectId | null;
}) {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const stream = useChatStream();
  const [composer, setComposer] = useState("");
  const [live, setLive] = useState<LiveTurn | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const threadQuery = trpc.chat.getThread.useQuery({
    workspaceId,
    threadId,
    limit: 100,
    cursor: null,
  });
  const messages = useMemo(() => threadQuery.data?.messages ?? [], [threadQuery.data]);
  const thread = threadQuery.data?.thread ?? null;

  const creditsCharged = useMemo(
    () => messages.reduce((sum, m) => sum + m.creditsCharged, 0),
    [messages],
  );

  // A proposal is pending when no tool-role message has confirmed it yet.
  const confirmedIds = useMemo(
    () => new Set(messages.filter((m) => m.role === "tool").map((m) => m.toolCallId)),
    [messages],
  );

  const refetch = useCallback(() => {
    void utils.chat.getThread.invalidate({ workspaceId, threadId });
    void utils.chat.listThreads.invalidate();
  }, [utils, workspaceId, threadId]);

  // Keep scrolled to the newest message / streamed tokens.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, live]);

  const renameMutation = trpc.chat.renameThread.useMutation({
    onSuccess: refetch,
    onError: () => {
      toast("Rename failed.");
    },
  });
  const deleteMutation = trpc.chat.deleteThread.useMutation({
    onSuccess: () => {
      void utils.chat.listThreads.invalidate();
    },
    onError: () => {
      toast("Delete failed.");
    },
  });

  const sendMutation = trpc.chat.sendMessage.useMutation();

  const send = useCallback(async () => {
    const content = composer.trim();
    if (content === "" || sendMutation.isPending || live?.streaming === true) return;
    setComposer("");
    setLive({ text: "", proposal: null, streaming: true });
    try {
      const ack = await sendMutation.mutateAsync({ workspaceId, threadId, content });
      refetch(); // surface the persisted user message immediately
      await stream.start(ack.streamPath);
    } catch {
      toast("The coach couldn't respond. Try again.");
      setLive(null);
      return;
    }
  }, [composer, sendMutation, live, workspaceId, threadId, stream, refetch, toast]);

  // Mirror the live stream state into the optimistic turn; reconcile on done.
  useEffect(() => {
    if (stream.state.phase === "idle") return;
    setLive({
      text: stream.state.text,
      proposal: stream.state.proposal,
      streaming: stream.state.phase === "streaming",
    });
    if (stream.state.phase === "done") {
      refetch();
      // Clear the overlay once the authoritative message lands.
      const timer = window.setTimeout(() => {
        setLive(null);
        stream.reset();
      }, 150);
      return () => {
        window.clearTimeout(timer);
      };
    }
    if (stream.state.phase === "error") {
      toast(stream.state.error ?? "The coach stream failed.");
    }
  }, [stream.state, refetch, toast, stream]);

  const confirmMutation = trpc.chat.confirmTool.useMutation({
    onSuccess: (ack) => {
      refetch();
      toast(
        ack.estimatedCredits > 0
          ? `Done — ${ack.estimatedCredits} credit${ack.estimatedCredits === 1 ? "" : "s"} charged.`
          : "Done.",
        "success",
      );
    },
    onError: (err) => {
      toast(err.message || "Couldn't run that tool.");
    },
  });

  const onConfirm = useCallback(
    (proposal: ChatToolCall) => {
      confirmMutation.mutate({
        workspaceId,
        threadId,
        toolCallId: proposal.toolCallId,
        args: proposal.args,
      });
    },
    [confirmMutation, workspaceId, threadId],
  );

  const onRename = useCallback(() => {
    const next = window.prompt("Rename conversation", thread?.title ?? "");
    if (next !== null && next.trim() !== "") {
      renameMutation.mutate({ workspaceId, threadId, title: next.trim() });
    }
  }, [renameMutation, workspaceId, threadId, thread]);

  const onDelete = useCallback(() => {
    if (window.confirm("Delete this conversation? This can't be undone.")) {
      deleteMutation.mutate({ workspaceId, threadId });
    }
  }, [deleteMutation, workspaceId, threadId]);

  if (threadQuery.isLoading) return <LoadingState label="Loading conversation…" />;
  if (threadQuery.isError) {
    return (
      <ErrorState
        message="Couldn't load this conversation."
        onRetry={() => {
          void threadQuery.refetch();
        }}
      />
    );
  }

  return (
    <div className="flex h-[calc(100vh-18rem)] min-h-[24rem] flex-col rounded-lg border border-zinc-200 dark:border-zinc-800">
      <header className="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
        <h2 className="truncate text-sm font-semibold">{thread?.title ?? "Conversation"}</h2>
        <div className="flex items-center gap-1">
          {creditsCharged > 0 ? (
            <span className="mr-1 text-xs text-zinc-500 dark:text-zinc-400">
              {creditsCharged} credit{creditsCharged === 1 ? "" : "s"} this chat
            </span>
          ) : null}
          <IconButton label="Rename conversation" onClick={onRename}>
            <IconPencil size={14} />
          </IconButton>
          <IconButton label="Delete conversation" onClick={onDelete}>
            <IconTrash size={14} />
          </IconButton>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && live === null ? (
          <p className="py-8 text-center text-sm text-zinc-400">
            Say hello, or ask {COACH_NAME} for a hook, an outline, or a full draft.
          </p>
        ) : null}
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            pendingProposals={(m.toolCalls ?? []).filter((c) => !confirmedIds.has(c.toolCallId))}
            onConfirm={onConfirm}
            confirming={confirmMutation.isPending}
            projectId={projectId}
          />
        ))}
        {live !== null ? (
          <LiveAssistantBubble
            text={live.text}
            proposal={live.proposal}
            streaming={live.streaming}
            onConfirm={onConfirm}
            confirming={confirmMutation.isPending}
          />
        ) : null}
      </div>

      <Composer
        value={composer}
        onChange={setComposer}
        onSend={() => {
          void send();
        }}
        disabled={sendMutation.isPending || live?.streaming === true}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message bubbles
// ---------------------------------------------------------------------------

function roleClasses(role: ChatMessage["role"]): string {
  if (role === "user") return "ml-auto bg-emerald-600 text-white";
  if (role === "tool")
    return "mr-auto border border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300";
  return "mr-auto bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100";
}

function MessageBubble({
  message,
  pendingProposals,
  onConfirm,
  confirming,
  projectId,
}: {
  message: ChatMessage;
  pendingProposals: ChatToolCall[];
  onConfirm: (p: ChatToolCall) => void;
  confirming: boolean;
  projectId: ProjectId | null;
}) {
  const isTool = message.role === "tool";
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap ${roleClasses(message.role)}`}
      >
        {isTool ? (
          <span className="flex items-start gap-1.5">
            <IconSparkle size={14} className="mt-0.5 shrink-0 text-emerald-500" />
            <span>{message.content}</span>
          </span>
        ) : (
          message.content
        )}
        {isTool && projectId !== null && /editor/i.test(message.content) ? (
          <Link
            href={`/projects/${projectId}/editor`}
            className="mt-1.5 block text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
          >
            Open in editor →
          </Link>
        ) : null}
      </div>
      {pendingProposals.map((p) => (
        <ToolCard key={p.toolCallId} proposal={p} onConfirm={onConfirm} confirming={confirming} />
      ))}
    </div>
  );
}

function LiveAssistantBubble({
  text,
  proposal,
  streaming,
  onConfirm,
  confirming,
}: {
  text: string;
  proposal: ChatToolCall | null;
  streaming: boolean;
  onConfirm: (p: ChatToolCall) => void;
  confirming: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="max-w-[85%] rounded-2xl bg-zinc-100 px-3.5 py-2 text-sm whitespace-pre-wrap dark:bg-zinc-800 dark:text-zinc-100">
        {text === "" && streaming ? (
          <span className="inline-flex gap-1" aria-label={`${COACH_NAME} is typing`}>
            <Dot /> <Dot /> <Dot />
          </span>
        ) : (
          <>
            {text}
            {streaming ? <span className="ml-0.5 animate-pulse">▋</span> : null}
          </>
        )}
      </div>
      {proposal !== null ? (
        <ToolCard proposal={proposal} onConfirm={onConfirm} confirming={confirming} />
      ) : null}
    </div>
  );
}

function Dot() {
  return <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400" />;
}

// ---------------------------------------------------------------------------
// Tool confirmation card
// ---------------------------------------------------------------------------

function ToolCard({
  proposal,
  onConfirm,
  confirming,
}: {
  proposal: ChatToolCall;
  onConfirm: (p: ChatToolCall) => void;
  confirming: boolean;
}) {
  const [skipped, setSkipped] = useState(false);
  if (skipped) return null;
  const credits = proposal.estimatedCredits;
  return (
    <div className="max-w-[85%] rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900 dark:bg-emerald-950/40">
      <p className="text-sm text-zinc-700 dark:text-zinc-200">
        {COACH_NAME} wants to run <span className="font-semibold">{toolLabel(proposal.name)}</span>
        {credits > 0 ? (
          <>
            {" — "}
            <span className="font-semibold">
              {credits} credit{credits === 1 ? "" : "s"}
            </span>
          </>
        ) : (
          " — free"
        )}
        .
      </p>
      <div className="mt-2 flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          busy={confirming}
          onClick={() => {
            onConfirm(proposal);
          }}
        >
          Confirm
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={confirming}
          onClick={() => {
            setSkipped(true);
          }}
        >
          Skip
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

function Composer({
  value,
  onChange,
  onSend,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled: boolean;
}) {
  return (
    <div className="border-t border-zinc-200 p-2.5 dark:border-zinc-800">
      <div className="flex items-end gap-2">
        <label htmlFor="chat-composer" className="sr-only">
          Message {COACH_NAME}
        </label>
        <textarea
          id="chat-composer"
          rows={1}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={`Ask ${COACH_NAME} for a hook, an outline, a draft…`}
          className="max-h-40 min-h-[2.25rem] flex-1 resize-none rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <Button
          variant="primary"
          onClick={onSend}
          disabled={disabled || value.trim() === ""}
          aria-label="Send message"
        >
          <IconArrowUp size={15} />
        </Button>
      </div>
    </div>
  );
}
