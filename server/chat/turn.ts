import { LLM_MODELS } from "@/lib/config";
import { buildCoachContext } from "@/lib/chat/context";
import { buildCoachSystemPrompt } from "@/lib/chat/persona";
import { synthCoachReply, toCoachTurn, TOOL_PROTOCOL_INSTRUCTIONS } from "@/lib/chat/orchestrator";
import type { ChatStreamEvent } from "@/lib/types/chat";
import type { ChatMessage } from "@/lib/types/entities";
import type { ChatMessageId, ChatThreadId, ProjectId, WorkspaceId } from "@/lib/types/ids";
import { isTerminalEvent } from "@/pipelines/script/events";
import type { ScriptEventBus } from "@/pipelines/script/events";
import { getStageDeps } from "@/pipelines/stages/deps";
import { getChatStore, type ChatStore } from "@/server/chat/store";

/**
 * The assistant turn (Wave D, D1) — the async generator behind the chat SSE
 * route. Mirrors the script stream's event-driven shape but runs INLINE (the
 * coach reply is a single fast generation, not a multi-stage worker job):
 *
 *   1. assemble the grounding CoachContext (buildCoachContext) and system
 *      prompt (buildCoachSystemPrompt + the tool-call protocol);
 *   2. generate the reply — deterministically in fixture mode (synthCoachReply,
 *      zero keys), via the LlmProvider (Grok tier, under the hood) otherwise;
 *   3. parse an optional tool directive from the reply (toCoachTurn);
 *   4. PERSIST the assistant message (content + any tool_calls) BEFORE
 *      streaming, so a dropped connection never loses the turn;
 *   5. stream the natural-language reply as message_delta events, then a
 *      tool_proposed event if the Coach proposed a tool, then done.
 *
 * The vendor name never reaches the stream: the persona forbids it and the
 * reply text is all that is surfaced (tool directive stripped).
 */

const DELTA_WORDS = 6;

/** Chunk reply text into word-group deltas for a natural streaming cadence. */
function* chunkText(text: string): Generator<string> {
  if (text === "") return;
  const words = text.split(/(\s+)/).filter((w) => w !== "");
  let buf = "";
  let count = 0;
  for (const token of words) {
    buf += token;
    if (/\S/.test(token)) count += 1;
    if (count >= DELTA_WORDS) {
      yield buf;
      buf = "";
      count = 0;
    }
  }
  if (buf !== "") yield buf;
}

/** Render prior thread messages as a transcript for the prompt. */
function buildTranscript(history: ChatMessage[]): string {
  return history
    .map((m) => {
      const who = m.role === "user" ? "Creator" : m.role === "assistant" ? "Coach" : "Tool result";
      return `${who}: ${m.content}`;
    })
    .join("\n");
}

export async function* runAssistantTurn(params: {
  workspaceId: WorkspaceId;
  threadId: ChatThreadId;
  projectId: ProjectId | null;
  assistantMessageId: ChatMessageId;
  store?: ChatStore;
}): AsyncGenerator<ChatStreamEvent> {
  const store = params.store ?? getChatStore();
  const deps = await getStageDeps();

  const context = await buildCoachContext(params.projectId, params.workspaceId, deps);
  const history = await store.listMessages(params.workspaceId, params.threadId);
  const lastUser = [...history].reverse().find((m) => m.role === "user");
  const userText = lastUser?.content ?? "";

  let raw: string;
  if (deps.engine.mode === "fixture") {
    raw = synthCoachReply(userText, context);
  } else {
    const system = `${buildCoachSystemPrompt(context)}\n\n${TOOL_PROTOCOL_INSTRUCTIONS}`;
    const response = await deps.engine.llm.complete({
      model: LLM_MODELS.sonnet,
      system,
      prompt: buildTranscript(history),
      maxTokens: 1200,
      temperature: 0.7,
    });
    raw = response.text;
  }

  const turn = toCoachTurn(raw);

  // Persist the finished assistant message first (durable even if the client
  // disconnects mid-stream); then stream it back.
  await store.appendMessage({
    id: params.assistantMessageId,
    threadId: params.threadId,
    workspaceId: params.workspaceId,
    role: "assistant",
    content: turn.replyText,
    toolCalls: turn.proposal === null ? null : [turn.proposal],
  });

  for (const chunk of chunkText(turn.replyText)) {
    yield { type: "message_delta", text: chunk };
  }

  if (turn.proposal !== null) {
    yield {
      type: "tool_proposed",
      toolCallId: turn.proposal.toolCallId,
      name: turn.proposal.name,
      args: turn.proposal.args,
      estimatedCredits: turn.proposal.estimatedCredits,
    };
  }

  yield { type: "done" };
}

/**
 * Draft bridge (Wave D, D1) — streams a draft tool's sections through the
 * chat event union by subscribing to the EXISTING script event bus and
 * re-encoding: each completed section becomes a message_delta, the terminal
 * `complete` becomes a tool_result, and a `failed` becomes an error. This is
 * the "draft streams through the chat stream too" path; the tool message the
 * confirm already persisted carries the scriptId for the editor deep-link.
 */
export async function* bridgeDraftStream(params: {
  bus: ScriptEventBus;
  scriptId: string;
  toolCallId: string;
  signal?: AbortSignal;
}): AsyncGenerator<ChatStreamEvent> {
  let sections = 0;
  for await (const event of params.bus.subscribe(params.scriptId, params.signal)) {
    if (event.type === "section") {
      sections += 1;
      yield {
        type: "message_delta",
        text: `\n\n## ${event.section.heading}\n${event.section.body}`,
      };
    } else if (event.type === "complete") {
      yield {
        type: "tool_result",
        toolCallId: params.toolCallId,
        ok: true,
        summary: `Draft complete — ${sections} section${sections === 1 ? "" : "s"} written.`,
      };
      yield { type: "done" };
      return;
    } else if (event.type === "failed") {
      yield {
        type: "error",
        message: "The draft run failed. Your credits for a failed run are not kept.",
      };
      return;
    }
    if (isTerminalEvent(event)) return;
  }
}
