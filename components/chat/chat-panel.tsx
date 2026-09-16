"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, ChatThread, ChatToolCall } from "@/lib/types/entities";
import type { ChatMessageId, ChatThreadId, ProjectId, WorkspaceId } from "@/lib/types/ids";
import { COACH_NAME } from "@/lib/branding";
import { isRateLimitError } from "@/components/providers/query-client";
import { trpc } from "@/components/providers/trpc";
import { useWorkspace } from "@/components/providers/workspace-context";
import { Button, IconButton } from "@/components/ui/button";
import {
  IconArrowUp,
  IconPlus,
  IconSearch,
  IconSparkle,
  IconTrash,
  IconPencil,
} from "@/components/ui/icons";
import { ErrorState, LoadingState } from "@/components/ui/state";
import { useToast } from "@/components/ui/toast";
import { isUiCreditExempt } from "@/components/lib/credits-ui";
import { useChatThreads } from "./chat-threads-context";
import { coachSeedPrompt, takeCoachSeed } from "./coach-seed";
import { OutliersLauncher } from "./outliers-launcher";
import { RateLimitNotice, useRateLimitBackoff } from "./rate-limit";
import { ThreadList } from "./thread-list";
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
 *
 * Request discipline (F0 — Coach reliability, see docs/COACH-RELIABILITY.md):
 *  - chat.listThreads is owned by <ChatThreadsProvider> (one query per
 *    surface); this panel only reads it and invalidates it on create/
 *    rename/delete — never on send, stream completion or tool confirm.
 *  - chat.getThread fetches on thread change and is refetched exactly ONCE
 *    per stream completion (keyed on the stream's completionId).
 *  - a 429 on either read stops everything and shows one "Taking a breath"
 *    notice with bounded, backed-off retries — never an automatic loop.
 */

/** Surfaced when chat.sendMessage itself is rate-limited. */
export const SEND_RATE_LIMITED_MESSAGE = `${COACH_NAME} is taking a breath — try again in a moment.`;

/**
 * Starter prompts for an empty coach: the three jobs creators come for.
 * Plain product copy — no model is named.
 */
export const COACH_STARTERS = [
  "Give me 5 hooks for my next video",
  "Outline a 10-minute explainer",
  "Package this idea: titles + thumbnail",
] as const;

export function ChatPanel({
  projectId,
  threadRail = "inline",
}: {
  projectId: ProjectId | null;
  /**
   * Where the thread list renders. "inline" = this panel's own sidebar;
   * "shell" = the app shell's left rail renders it (Coach), so this panel
   * is conversation-only. Both read the same ChatThreadsProvider.
   */
  threadRail?: "inline" | "shell";
}) {
  const { workspaceId } = useWorkspace();
  const threadList = useChatThreads();
  const { threads, selectedId, select, startThread, creating } = threadList;

  // A concept handed over from the discovery surface ("Ask Coach"): read once,
  // used to prefill the composer so the Coach can go straight to a hook/outline.
  const [seedPrompt, setSeedPrompt] = useState<string | null>(null);
  useEffect(() => {
    if (projectId === null) return;
    const seed = takeCoachSeed(projectId);
    if (seed !== null) setSeedPrompt(coachSeedPrompt(seed));
  }, [projectId]);

  // A seeded prompt (discovery hand-off or a starter chip) with no thread
  // yet: open one so it lands in a fresh conversation. Guarded per seed so a
  // failed create surfaces its toast once instead of retrying forever.
  const autoStartedFor = useRef<string | null>(null);
  useEffect(() => {
    if (
      seedPrompt !== null &&
      autoStartedFor.current !== seedPrompt &&
      selectedId === null &&
      !threadList.loading &&
      threadList.hasData &&
      threads.length === 0 &&
      !creating
    ) {
      autoStartedFor.current = seedPrompt;
      startThread();
    }
  }, [
    seedPrompt,
    selectedId,
    threadList.loading,
    threadList.hasData,
    threads.length,
    creating,
    startThread,
  ]);

  if (workspaceId === null) return <LoadingState label="Loading workspace…" />;
  if (threadList.backoff.limited && !threadList.hasData) {
    return <RateLimitNotice backoff={threadList.backoff} what="your conversations" />;
  }
  if (threadList.failed) {
    return <ErrorState message="Couldn't load your conversations." onRetry={threadList.refetch} />;
  }

  const conversation =
    selectedId === null ? (
      <CoachEmptyState
        projectId={projectId}
        onStart={startThread}
        onStarter={setSeedPrompt}
        creating={creating}
      />
    ) : (
      <ChatThreadView
        key={selectedId}
        workspaceId={workspaceId}
        threadId={selectedId}
        projectId={projectId}
        initialComposer={seedPrompt}
        onSeedConsumed={() => {
          setSeedPrompt(null);
        }}
      />
    );

  if (threadRail === "shell") {
    return <div className="flex min-h-0 flex-1 flex-col">{conversation}</div>;
  }

  return (
    <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
      <ThreadSidebar
        threads={threads}
        loading={threadList.loading}
        selectedId={selectedId}
        onSelect={select}
        onNew={startThread}
        creating={creating}
      />
      <div className="flex min-h-0 min-w-0 flex-col">{conversation}</div>
    </div>
  );
}

function CoachEmptyState({
  projectId,
  onStart,
  onStarter,
  creating,
}: {
  projectId: ProjectId | null;
  /** Open a blank conversation. */
  onStart: () => void;
  /** Seed the composer with a starter; the panel opens the conversation. */
  onStarter: (prompt: string) => void;
  creating: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 py-12 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-500/15 text-accent-400">
        <IconSparkle size={20} />
      </div>
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Ask {COACH_NAME}</h2>
        <p className="mt-1 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
          {projectId === null
            ? "Hooks, outlines, packaging, research — plan your next video and run any studio tool from here."
            : "Plan this video conversationally — ask for hooks, an outline, a full draft, titles, or research."}
        </p>
      </div>
      <div
        className="flex flex-wrap items-center justify-center gap-2"
        aria-label="Starter prompts"
      >
        {COACH_STARTERS.map((starter) => (
          <button
            key={starter}
            type="button"
            disabled={creating}
            onClick={() => {
              onStarter(starter);
            }}
            className="cursor-pointer rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:border-accent-400 hover:text-accent-700 disabled:opacity-50 dark:border-line dark:text-zinc-300 dark:hover:border-accent-500 dark:hover:text-accent-300"
          >
            {starter}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button variant="primary" onClick={onStart} busy={creating}>
          <IconPlus size={14} /> Start a conversation
        </Button>
        <Link
          href="/discover"
          className="inline-flex items-center gap-1 text-sm font-medium text-accent-700 hover:underline dark:text-accent-400"
        >
          <IconSearch size={13} /> Browse trending ideas
        </Link>
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
      <Link
        href="/discover"
        className="inline-flex w-full items-center gap-1.5 rounded-md px-2.5 py-2 text-sm font-medium text-accent-700 transition-colors hover:bg-accent-50 dark:text-accent-400 dark:hover:bg-accent-950/40"
      >
        <IconSearch size={13} /> Trending ideas
      </Link>
      <ThreadList threads={threads} loading={loading} selectedId={selectedId} onSelect={onSelect} />
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

/**
 * The turn in flight: the optimistic user bubble plus the ids the sendMessage
 * ack minted, so both bubbles reconcile DECLARATIVELY — each optimistic
 * bubble hides itself the moment the persisted message with that id is in
 * the thread query, with no timers and no extra fetches.
 */
interface PendingTurn {
  content: string;
  userMessageId: ChatMessageId | null;
  assistantMessageId: ChatMessageId | null;
}

function ChatThreadView({
  workspaceId,
  threadId,
  projectId,
  initialComposer = null,
  onSeedConsumed,
}: {
  workspaceId: WorkspaceId;
  threadId: ChatThreadId;
  projectId: ProjectId | null;
  /** Prefill for the composer, handed over from the discovery surface. */
  initialComposer?: string | null;
  onSeedConsumed?: () => void;
}) {
  const { toast } = useToast();
  const { workspace } = useWorkspace();
  const creditExempt = isUiCreditExempt(workspace?.role);
  const utils = trpc.useUtils();
  const threadList = useChatThreads();
  const stream = useChatStream();
  const [composer, setComposer] = useState(initialComposer ?? "");
  // The seed is consumed at mount (used as the composer's initial value).
  const seedConsumed = useRef(false);
  useEffect(() => {
    if (!seedConsumed.current && initialComposer !== null) {
      seedConsumed.current = true;
      onSeedConsumed?.();
    }
  }, [initialComposer, onSeedConsumed]);
  const [sending, setSending] = useState(false);
  const [turn, setTurn] = useState<PendingTurn | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Fetches on thread change only (the view is keyed by threadId); no
  // interval, no focus refetch — the stream completion triggers the one
  // reconciling refetch below.
  const threadQuery = trpc.chat.getThread.useQuery(
    { workspaceId, threadId, limit: 100, cursor: null },
    { staleTime: 30_000, refetchOnWindowFocus: false, refetchOnReconnect: false },
  );
  const threadBackoff = useRateLimitBackoff(threadQuery);
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

  /** Refetch THIS thread only. The thread list is untouched — a message
   *  never changes a title, so listThreads has nothing new to say. */
  const refetchThread = useCallback(
    () => utils.chat.getThread.invalidate({ workspaceId, threadId }),
    [utils, workspaceId, threadId],
  );

  // The live overlay is DERIVED from the stream (no mirrored state, no
  // effect): typing dots while the send is in flight, the streamed text
  // while streaming, and the finished text until the persisted message lands.
  const live = useMemo<LiveTurn | null>(() => {
    const s = stream.state;
    if (s.phase === "streaming" || s.phase === "done") {
      return { text: s.text, proposal: s.proposal, streaming: s.phase === "streaming" };
    }
    if (sending && s.phase === "idle") return { text: "", proposal: null, streaming: true };
    return null;
  }, [stream.state, sending]);

  const messageIds = useMemo(() => new Set(messages.map((m) => m.id)), [messages]);
  const optimisticUser =
    turn !== null && (turn.userMessageId === null || !messageIds.has(turn.userMessageId))
      ? turn.content
      : null;

  // Keep scrolled to the newest message / streamed tokens.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, live]);

  const renameMutation = trpc.chat.renameThread.useMutation({
    onSuccess: () => {
      // A title change is the ONE message-level action the thread list cares about.
      void refetchThread();
      void threadList.invalidate();
    },
    onError: () => {
      toast("Rename failed.");
    },
  });
  const deleteMutation = trpc.chat.deleteThread.useMutation({
    onSuccess: async () => {
      // Refresh the list FIRST, then drop the selection, so the provider's
      // default-to-newest never lands on the thread that was just deleted.
      await threadList.invalidate();
      threadList.select(null);
    },
    onError: () => {
      toast("Delete failed.");
    },
  });

  const sendMutation = trpc.chat.sendMessage.useMutation();

  const send = useCallback(async () => {
    const content = composer.trim();
    if (content === "" || sending) return;
    setComposer("");
    setSending(true);
    setTurn({ content, userMessageId: null, assistantMessageId: null });
    try {
      const ack = await sendMutation.mutateAsync({ workspaceId, threadId, content });
      setTurn({
        content,
        userMessageId: ack.userMessageId,
        assistantMessageId: ack.assistantMessageId,
      });
      // The reply streams straight into the overlay; getThread is reconciled
      // once when the stream completes (below), not polled meanwhile.
      await stream.start(ack.streamPath);
    } catch (err) {
      toast(
        isRateLimitError(err)
          ? SEND_RATE_LIMITED_MESSAGE
          : "The coach couldn't respond. Try again.",
      );
      setTurn(null);
      setComposer((current) => (current === "" ? content : current));
    } finally {
      setSending(false);
    }
  }, [composer, sending, sendMutation, workspaceId, threadId, stream, toast]);

  // Reconcile EXACTLY ONCE per completed stream (done or error), keyed on the
  // stream's monotonic completionId — never on the phase, which would refire
  // on every render while it still reads "done".
  const handledCompletion = useRef(0);
  useEffect(() => {
    const { completionId, phase, error } = stream.state;
    if (completionId === handledCompletion.current) return;
    handledCompletion.current = completionId;
    if (phase === "error") toast(error ?? "The coach stream failed.");
    void refetchThread();
  }, [stream.state, refetchThread, toast]);

  // Clear the overlay only once the authoritative assistant message is in
  // the thread (the server persists it before streaming), so the reply never
  // flickers away — and never lingers as a duplicate.
  useEffect(() => {
    if (stream.state.phase !== "done") return;
    const assistantId = turn?.assistantMessageId ?? null;
    if (assistantId !== null && messageIds.has(assistantId)) {
      stream.reset();
    }
  }, [stream, stream.state.phase, turn, messageIds]);

  const confirmMutation = trpc.chat.confirmTool.useMutation({
    onSuccess: (ack) => {
      void refetchThread();
      toast(
        !creditExempt && ack.estimatedCredits > 0
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
  if (threadQuery.data === undefined) {
    // Nothing to show yet: a 429 gets the bounded-retry notice, anything
    // else the plain error state. Never a blank panel, never a spinner.
    if (threadBackoff.limited) {
      return <RateLimitNotice backoff={threadBackoff} what="this conversation" />;
    }
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
    <div className="flex min-h-[24rem] flex-1 flex-col rounded-card border border-zinc-200 bg-white dark:border-line dark:bg-surface">
      <header className="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-2.5 dark:border-line">
        <h2 className="truncate text-sm font-semibold">{thread?.title ?? "Conversation"}</h2>
        <div className="flex items-center gap-1">
          {creditExempt ? (
            <span className="mr-1 text-xs text-zinc-500 dark:text-zinc-400">Unlimited</span>
          ) : creditsCharged > 0 ? (
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

      <OutliersLauncher
        onPick={(prompt) => {
          setComposer(prompt);
        }}
      />

      {threadQuery.isError ? (
        // Stale data is still on screen; the refresh failed. Keep the
        // conversation visible and surface the (bounded) retry inline.
        threadBackoff.limited ? (
          <div className="px-3 pt-3">
            <RateLimitNotice backoff={threadBackoff} what="this conversation" />
          </div>
        ) : (
          <p className="px-4 pt-3 text-xs text-zinc-500 dark:text-zinc-400">
            Couldn't refresh this conversation.{" "}
            <button
              type="button"
              className="font-medium text-accent-700 hover:underline dark:text-accent-400"
              onClick={() => {
                void threadQuery.refetch();
              }}
            >
              Try again
            </button>
          </p>
        )
      ) : null}

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && live === null && optimisticUser === null ? (
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
        {optimisticUser !== null ? (
          <div className="flex flex-col gap-1.5" data-testid="optimistic-user-message">
            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap ${roleClasses("user")}`}
            >
              {optimisticUser}
            </div>
          </div>
        ) : null}
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
        disabled={sending}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message bubbles
// ---------------------------------------------------------------------------

function roleClasses(role: ChatMessage["role"]): string {
  if (role === "user")
    return "ml-auto bg-accent-600 text-white dark:bg-accent-500 dark:text-accent-fg";
  if (role === "tool")
    return "mr-auto border border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-line dark:bg-surface dark:text-zinc-300";
  return "mr-auto bg-zinc-100 text-zinc-800 dark:bg-surface-2 dark:text-zinc-100";
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
            <IconSparkle size={14} className="mt-0.5 shrink-0 text-accent-500" />
            <span>{message.content}</span>
          </span>
        ) : (
          message.content
        )}
        {isTool && projectId !== null && /editor/i.test(message.content) ? (
          <Link
            href={`/projects/${projectId}/editor`}
            className="mt-1.5 block text-xs font-medium text-accent-700 hover:underline dark:text-accent-400"
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
      <div className="max-w-[85%] rounded-2xl bg-zinc-100 px-3.5 py-2 text-sm whitespace-pre-wrap dark:bg-surface-2 dark:text-zinc-100">
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
  const { workspace } = useWorkspace();
  const exempt = isUiCreditExempt(workspace?.role);
  if (skipped) return null;
  const credits = proposal.estimatedCredits;
  return (
    <div className="max-w-[85%] rounded-xl border border-accent-200 bg-accent-50/60 p-3 dark:border-accent-900 dark:bg-accent-950/40">
      <p className="text-sm text-zinc-700 dark:text-zinc-200">
        {COACH_NAME} wants to run <span className="font-semibold">{toolLabel(proposal.name)}</span>
        {exempt || credits === 0 ? (
          " — included"
        ) : (
          <>
            {" — "}
            <span className="font-semibold">
              {credits} credit{credits === 1 ? "" : "s"}
            </span>
          </>
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
    <div className="border-t border-zinc-200 p-2.5 dark:border-line">
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
          className="max-h-40 min-h-[2.25rem] flex-1 resize-none rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-accent-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
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
