// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { ReactNode } from "react";
import { FIXTURE_IDS, fixtureChatThreadWorkspace } from "@/lib/fixtures";
import type { ChatStreamEvent } from "@/lib/types/chat";
import type { ChatMessage } from "@/lib/types/entities";
import { asWorkspaceId, chatMessageIdSchema } from "@/lib/types/ids";
import { createAppQueryClient, shouldRetryQuery } from "@/components/providers/query-client";
import { trpc } from "@/components/providers/trpc";
import { ToastProvider } from "@/components/ui/toast";
import { ChatPanel } from "@/components/chat/chat-panel";
import { ChatThreadsProvider } from "@/components/chat/chat-threads-context";
import {
  BACKOFF_MAX_ATTEMPTS,
  RATE_LIMIT_TITLE,
  backoffDelayMs,
} from "@/components/chat/rate-limit";

/**
 * F0 — Coach reliability regression suite (docs/COACH-RELIABILITY.md).
 *
 * The production outage was a render→invalidate loop: the chat panel's
 * "reconcile on done" effect re-fired every render, invalidating getThread
 * AND listThreads each time, with `retry: 1` doubling every 429. These tests
 * mount the REAL panel against the REAL tRPC client + QueryClient policy and
 * a counting fake transport, and pin the request budget:
 *
 *  - a 429 shows ONE "Taking a breath" notice, retries with exponential
 *    backoff and circuit-breaks after BACKOFF_MAX_ATTEMPTS — bounded, never a loop;
 *  - remounting the panel 10× is a cache read, not 10 listThreads requests;
 *  - a stream completion refetches getThread exactly ONCE and listThreads ZERO times.
 */

const WS = asWorkspaceId(FIXTURE_IDS.workspace);

vi.mock("@/components/providers/workspace-context", () => ({
  useWorkspace: () => ({
    workspaceId: WS,
    workspace: null,
    channelId: null,
    channel: null,
    channels: [],
    selectChannel: vi.fn(),
  }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// ---------------------------------------------------------------------------
// Counting fake transport for the tRPC batch link
// ---------------------------------------------------------------------------

type ProcResult = { ok: true; data: unknown } | { ok: false; code: "TOO_MANY_REQUESTS" };
type ProcHandler = (input: unknown) => ProcResult;

const handlers = new Map<string, ProcHandler>();
const counts = new Map<string, number>();

function count(proc: string): number {
  return counts.get(proc) ?? 0;
}

const rateLimited: ProcResult = { ok: false, code: "TOO_MANY_REQUESTS" };

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(href, "http://localhost");
  const procs = url.pathname.replace(/^\/api\/trpc\//, "").split(",");
  let inputs: Record<string, unknown> = {};
  if (init?.method === "POST" && typeof init.body === "string") {
    inputs = JSON.parse(init.body) as Record<string, unknown>;
  } else {
    const raw = url.searchParams.get("input");
    if (raw !== null) inputs = JSON.parse(raw) as Record<string, unknown>;
  }
  const results = procs.map((proc, i) => {
    counts.set(proc, count(proc) + 1);
    const handler = handlers.get(proc);
    if (handler === undefined) throw new Error(`no fake handler for ${proc}`);
    const serialized = inputs[String(i)];
    const parsed =
      serialized === undefined
        ? undefined
        : superjson.deserialize(serialized as Parameters<typeof superjson.deserialize>[0]);
    const result = handler(parsed);
    if (result.ok) return { result: { data: superjson.serialize(result.data) } };
    return {
      error: superjson.serialize({
        message: "Rate limit exceeded. Try again shortly.",
        code: -32029,
        data: { code: result.code, httpStatus: 429, path: proc },
      }),
    };
  });
  const allFailed = results.every((r) => "error" in r);
  return Promise.resolve(
    new Response(JSON.stringify(results), {
      status: allFailed ? 429 : 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

function makeClients() {
  const queryClient = createAppQueryClient();
  const trpcClient = trpc.createClient({
    links: [httpBatchLink({ url: "/api/trpc", transformer: superjson, fetch: fakeFetch })],
  });
  return { queryClient, trpcClient };
}

type Clients = ReturnType<typeof makeClients>;

function Harness({ clients, children }: { clients: Clients; children: ReactNode }) {
  return (
    <trpc.Provider client={clients.trpcClient} queryClient={clients.queryClient}>
      <QueryClientProvider client={clients.queryClient}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
}

function Surface() {
  return (
    <ChatThreadsProvider projectId={null}>
      <ChatPanel projectId={null} />
    </ChatThreadsProvider>
  );
}

// ---------------------------------------------------------------------------
// Fake EventSource for the chat SSE stream
// ---------------------------------------------------------------------------

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];

  readyState = FakeEventSource.OPEN;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, ((e: MessageEvent<string>) => void)[]>();

  constructor(public readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, fn: (e: MessageEvent<string>) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }

  emit(event: ChatStreamEvent): void {
    for (const fn of this.listeners.get(event.type) ?? []) {
      fn(new MessageEvent<string>(event.type, { data: JSON.stringify(event) }));
    }
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }
}

// ---------------------------------------------------------------------------

const thread = fixtureChatThreadWorkspace;
const threadWithMessages = (messages: ChatMessage[]) => ({ thread, messages, nextCursor: null });

function message(id: string, role: ChatMessage["role"], content: string, seq: number): ChatMessage {
  return {
    id: chatMessageIdSchema.parse(id),
    threadId: thread.id,
    workspaceId: thread.workspaceId,
    role,
    content,
    toolCalls: null,
    toolCallId: null,
    creditsCharged: 0,
    seq,
    createdAt: new Date(1_700_000_000_000 + seq * 1000),
  };
}

const USER_ID = "00000000-0000-4000-8000-0000000000c1";
const ASSISTANT_ID = "00000000-0000-4000-8000-0000000000c2";

beforeEach(() => {
  handlers.clear();
  counts.clear();
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  handlers.set("chat.listThreads", () => ({ ok: true, data: [thread] }));
  handlers.set("chat.getThread", () => ({ ok: true, data: threadWithMessages([]) }));
  Element.prototype.scrollTo = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("QueryClient retry policy", () => {
  it("never retries TOO_MANY_REQUESTS, keeps one retry for other failures", () => {
    const tooMany = { data: { code: "TOO_MANY_REQUESTS", httpStatus: 429 } };
    expect(shouldRetryQuery(0, tooMany)).toBe(false);
    expect(shouldRetryQuery(0, { data: { httpStatus: 429 } })).toBe(false);
    expect(shouldRetryQuery(0, new Error("boom"))).toBe(true);
    expect(shouldRetryQuery(1, new Error("boom"))).toBe(false);
  });

  it("backoff is exponential from 1s and capped at 30s", () => {
    expect([0, 1, 2, 3, 4, 5, 10].map(backoffDelayMs)).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000,
    ]);
  });
});

describe("429 on chat reads (bounded, backed-off, circuit-broken)", () => {
  it("listThreads 429 → one notice, retries at 1s/2s/4s/8s, then pauses; manual retry only", async () => {
    vi.useFakeTimers();
    handlers.set("chat.listThreads", () => rateLimited);
    const clients = makeClients();
    render(
      <Harness clients={clients}>
        <Surface />
      </Harness>,
    );

    const tick = async (ms: number) => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    };

    // Initial load fails within the first few ms of fake time.
    await tick(50);
    expect(count("chat.listThreads")).toBe(1); // the global retry policy did NOT retry the 429
    expect(screen.getByTestId("rate-limit-notice")).toBeTruthy();
    expect(screen.getByText(RATE_LIMIT_TITLE)).toBeTruthy();
    expect(screen.getAllByRole("status")).toHaveLength(1);

    // Backoff: 1s, 2s, 4s, 8s — each window fires exactly one request, and
    // nothing fires before the window elapses (±50ms of settle time).
    await tick(900);
    expect(count("chat.listThreads")).toBe(1);
    await tick(150);
    expect(count("chat.listThreads")).toBe(2);
    await tick(1850);
    expect(count("chat.listThreads")).toBe(2);
    await tick(200);
    expect(count("chat.listThreads")).toBe(3);
    await tick(3850);
    expect(count("chat.listThreads")).toBe(3);
    await tick(200);
    expect(count("chat.listThreads")).toBe(4);
    await tick(7850);
    expect(count("chat.listThreads")).toBe(4);
    await tick(200);
    expect(count("chat.listThreads")).toBe(5);
    expect(count("chat.listThreads")).toBe(BACKOFF_MAX_ATTEMPTS);

    // Circuit open: no automatic retries, however long we wait.
    await tick(120_000);
    expect(count("chat.listThreads")).toBe(BACKOFF_MAX_ATTEMPTS);
    expect(screen.getByTestId("rate-limit-notice").getAttribute("data-paused")).toBe("true");

    // Manual retry is still available and recovers once the bucket clears.
    handlers.set("chat.listThreads", () => ({ ok: true, data: [thread] }));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await tick(50);
    expect(count("chat.listThreads")).toBe(BACKOFF_MAX_ATTEMPTS + 1);
    expect(screen.queryByTestId("rate-limit-notice")).toBeNull();
    expect(screen.getAllByText(thread.title).length).toBeGreaterThan(0);
    await tick(60_000);
    expect(count("chat.listThreads")).toBe(BACKOFF_MAX_ATTEMPTS + 1);
  });

  it("getThread 429 → notice inside the thread view, total requests bounded", async () => {
    vi.useFakeTimers();
    handlers.set("chat.getThread", () => rateLimited);
    const clients = makeClients();
    render(
      <Harness clients={clients}>
        <Surface />
      </Harness>,
    );
    const tick = async (ms: number) => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    };
    // listThreads resolves, the first thread is selected, getThread fires (429).
    await tick(100);
    await tick(100);
    expect(count("chat.listThreads")).toBe(1);
    expect(count("chat.getThread")).toBe(1);
    expect(screen.getByTestId("rate-limit-notice")).toBeTruthy();

    // Exhaust the backoff schedule (1+2+4+8s) and then a long idle.
    await tick(15_000);
    await tick(300_000);
    expect(count("chat.getThread")).toBe(BACKOFF_MAX_ATTEMPTS);
    // The read storm never touched the thread list.
    expect(count("chat.listThreads")).toBe(1);
  });
});

describe("request budget", () => {
  it("mounting and unmounting the chat surface 10× fires ONE listThreads request", async () => {
    const clients = makeClients();
    for (let i = 0; i < 10; i++) {
      const view = render(
        <Harness clients={clients}>
          <Surface />
        </Harness>,
      );
      await waitFor(() => {
        expect(screen.getAllByText(thread.title).length).toBeGreaterThan(0);
      });
      view.unmount();
    }
    // Bounded by the cache/staleTime, not by the number of mounts.
    expect(count("chat.listThreads")).toBeLessThanOrEqual(2);
    expect(count("chat.listThreads")).toBe(1);
    expect(count("chat.getThread")).toBe(1);
  });

  it("stream completion → exactly ONE getThread refetch, ZERO listThreads refetches", async () => {
    handlers.set("chat.sendMessage", () => ({
      ok: true,
      data: {
        userMessageId: USER_ID,
        assistantMessageId: ASSISTANT_ID,
        streamPath: `/api/chat-stream?workspaceId=${WS}&threadId=${thread.id}&messageId=${ASSISTANT_ID}`,
        status: "streaming",
      },
    }));
    const clients = makeClients();
    render(
      <Harness clients={clients}>
        <Surface />
      </Harness>,
    );
    await waitFor(() => {
      expect(screen.getByText(/say hello/i)).toBeTruthy();
    });
    expect(count("chat.listThreads")).toBe(1);
    expect(count("chat.getThread")).toBe(1);

    // Send: optimistic user bubble, then the stream opens at the ack's path.
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Give me 5 hooks" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    expect(count("chat.sendMessage")).toBe(1);
    expect(screen.getByTestId("optimistic-user-message").textContent).toBe("Give me 5 hooks");
    // No getThread poll while the reply streams.
    expect(count("chat.getThread")).toBe(1);

    const source = FakeEventSource.instances[0];
    if (source === undefined) throw new Error("stream not opened");
    expect(source.url).toContain("/api/chat-stream");

    // Once the server persists the turn, the reconciling refetch sees both messages.
    handlers.set("chat.getThread", () => ({
      ok: true,
      data: threadWithMessages([
        message(USER_ID, "user", "Give me 5 hooks", 0),
        message(ASSISTANT_ID, "assistant", "Hook one. Hook two.", 1),
      ]),
    }));

    act(() => {
      source.emit({ type: "message_delta", text: "Hook one. " });
      source.emit({ type: "message_delta", text: "Hook two." });
    });
    expect(screen.getByText(/Hook one\. Hook two\./)).toBeTruthy();
    expect(count("chat.getThread")).toBe(1);

    act(() => {
      source.emit({ type: "done" });
    });
    await waitFor(() => {
      expect(count("chat.getThread")).toBe(2);
    });
    // The overlay gives way to the persisted messages: no duplicate bubble.
    await waitFor(() => {
      expect(screen.getAllByText(/Hook one\. Hook two\./)).toHaveLength(1);
      expect(screen.queryByTestId("optimistic-user-message")).toBeNull();
    });
    expect(source.readyState).toBe(FakeEventSource.CLOSED);

    // Let any would-be loop show itself: the counts must not move.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(count("chat.getThread")).toBe(2);
    expect(count("chat.listThreads")).toBe(1);
    expect(count("chat.sendMessage")).toBe(1);
    // Composer is back: no stuck spinner, no disabled send.
    expect(screen.getByRole("textbox").hasAttribute("disabled")).toBe(false);
  });

  it("a stream that closes before any reply is an error, not a blank bubble", async () => {
    handlers.set("chat.sendMessage", () => ({
      ok: true,
      data: {
        userMessageId: USER_ID,
        assistantMessageId: ASSISTANT_ID,
        streamPath: "/api/chat-stream?x=1",
        status: "streaming",
      },
    }));
    const clients = makeClients();
    render(
      <Harness clients={clients}>
        <Surface />
      </Harness>,
    );
    await waitFor(() => {
      expect(screen.getByText(/say hello/i)).toBeTruthy();
    });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    const source = FakeEventSource.instances[0];
    if (source === undefined) throw new Error("stream not opened");
    act(() => {
      source.close();
      source.onerror?.();
    });
    await waitFor(() => {
      expect(screen.getByText(/could not reach the coach/i)).toBeTruthy();
    });
    // One reconciling refetch (the user message is persisted), then quiet.
    await waitFor(() => {
      expect(count("chat.getThread")).toBe(2);
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(count("chat.getThread")).toBe(2);
    expect(count("chat.listThreads")).toBe(1);
    expect(screen.queryByLabelText(/is typing/i)).toBeNull();
  });
});
