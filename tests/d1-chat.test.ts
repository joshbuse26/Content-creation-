import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import { resetConfigForTests } from "@/lib/config";
import {
  FIXTURE_IDS,
  fixtureCoachContext,
  fixtureFrame,
  fixtureProject,
  fixtureVoiceProfile,
} from "@/lib/fixtures";
import { scriptContracts } from "@/lib/types/api";
import { buildCoachSystemPrompt } from "@/lib/chat/persona";
import { synthCoachReply, toCoachTurn } from "@/lib/chat/orchestrator";
import { chatStreamEventSchema, type ChatStreamEvent } from "@/lib/types/chat";
import type { ChatToolCall, VoiceProfile } from "@/lib/types/entities";
import {
  asUserId,
  chatMessageIdSchema,
  chatThreadIdSchema,
  voiceProfileIdSchema,
  workspaceIdSchema,
} from "@/lib/types/ids";
import { setEngineDepsForTests } from "@/pipelines/script/deps";
import { setStageDepsForTests } from "@/pipelines/stages/deps";
import { setPartnerSourceForTests } from "@/pipelines/stages/partners";
import { chatImpl } from "@/server/routers/impl/chat";
import { scriptStagesImpl } from "@/server/routers/impl/script-stages";
import { InMemoryChatStore, setChatStoreForTests } from "@/server/chat/store";
import { runAssistantTurn } from "@/server/chat/turn";
import type { WorkspaceHandlerCtx } from "@/server/routers/impl/_shared";
import {
  getSharedWorkspaceStore,
  resetSharedWorkspaceStoreForTests,
} from "@/server/workspace/memory";
import { fixtureCtx } from "./a2-helpers";
import { makeStageDeps } from "./c1-helpers";

/**
 * D1: chat-first surface + tool-calling. The chat tool path must meter
 * IDENTICALLY to the staged UI (same idempotent ledger key), fail closed on
 * the licensed-voice guard, be tenancy-scoped, stream a union-conforming
 * event sequence, and work end to end in fixture mode with zero keys — and
 * the persona must never name the underlying model/vendor.
 */

type Deps = ReturnType<typeof makeStageDeps>;
let deps: Deps;
let chatStore: InMemoryChatStore;

const threadId = chatThreadIdSchema.parse(FIXTURE_IDS.chatThread);
const archetypeGen = { mode: "archetype", archetypeId: "high-stakes-challenge" } as const;

beforeEach(() => {
  resetSharedWorkspaceStoreForTests();
  deps = makeStageDeps();
  setEngineDepsForTests(deps.engine);
  setStageDepsForTests(deps);
  setPartnerSourceForTests(deps.partners);
  chatStore = new InMemoryChatStore();
  setChatStoreForTests(chatStore);
});
afterEach(() => {
  resetSharedWorkspaceStoreForTests();
  setEngineDepsForTests(undefined);
  setStageDepsForTests(undefined);
  setPartnerSourceForTests(undefined);
  setChatStoreForTests(undefined);
  resetConfigForTests();
});

/** Persist an assistant message carrying a tool proposal, return the proposal. */
async function seedProposal(
  name: string,
  args: Record<string, unknown>,
  estimatedCredits: number,
): Promise<ChatToolCall> {
  const proposal: ChatToolCall = {
    toolCallId: `call_${name}_${randomUUID().slice(0, 8)}`,
    name: name as ChatToolCall["name"],
    args,
    estimatedCredits,
  };
  await chatStore.appendMessage({
    threadId,
    workspaceId: fixtureCtx.workspaceId,
    role: "assistant",
    content: `Proposing ${name}.`,
    toolCalls: [proposal],
  });
  return proposal;
}

async function collectTurn(assistantMessageId: string): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = [];
  for await (const event of runAssistantTurn({
    workspaceId: fixtureCtx.workspaceId,
    threadId,
    projectId: fixtureProject.id,
    assistantMessageId: chatMessageIdSchema.parse(assistantMessageId),
  })) {
    events.push(event);
  }
  return events;
}

describe("fixture chat end to end (zero keys)", () => {
  it("send → streamed reply → tool_proposed → confirm → tool_result, 1 credit", async () => {
    const ack = await chatImpl.sendMessage({
      ctx: fixtureCtx,
      input: { workspaceId: fixtureCtx.workspaceId, threadId, content: "Help me nail the hook" },
    });
    expect(ack.status).toBe("streaming");
    expect(ack.streamPath).toContain("/api/chat-stream");

    const events = await collectTurn(ack.assistantMessageId);
    // SSE event sequence conforms to the frozen chat union.
    for (const event of events) chatStreamEventSchema.parse(event);
    expect(events.some((e) => e.type === "message_delta")).toBe(true);
    expect(events.at(-1)?.type).toBe("done");

    const proposed = events.find((e) => e.type === "tool_proposed");
    expect(proposed?.type).toBe("tool_proposed");
    if (proposed?.type !== "tool_proposed") throw new Error("no proposal");
    expect(proposed.name).toBe("make_hooks");
    expect(proposed.estimatedCredits).toBe(1);

    // Nothing charged until the user confirms.
    expect(deps.engine.store.creditEntries).toHaveLength(0);

    const confirm = await chatImpl.confirmTool({
      ctx: fixtureCtx,
      input: {
        workspaceId: fixtureCtx.workspaceId,
        threadId,
        toolCallId: proposed.toolCallId,
        args: proposed.args,
      },
    });
    expect(confirm.accepted).toBe(true);
    expect(confirm.estimatedCredits).toBe(1);
    expect(deps.engine.store.creditEntries).toHaveLength(1);

    // A tool-role result message is persisted with credits_charged.
    const { messages } = await chatImpl.getThread({
      ctx: fixtureCtx,
      input: { workspaceId: fixtureCtx.workspaceId, threadId, limit: 100, cursor: null },
    });
    const toolMsg = messages.find((m) => m.role === "tool" && m.toolCallId === proposed.toolCallId);
    expect(toolMsg).toBeDefined();
    expect(toolMsg?.creditsCharged).toBe(1);
    expect(toolMsg?.content.toLowerCase()).toContain("hook");
  });
});

describe("metering through the chat tool path", () => {
  it("confirmTool charges exactly once, even re-confirmed (idempotent)", async () => {
    const proposal = await seedProposal(
      "make_hooks",
      { projectId: fixtureProject.id, generation: archetypeGen },
      1,
    );
    const input = {
      workspaceId: fixtureCtx.workspaceId,
      threadId,
      toolCallId: proposal.toolCallId,
      args: proposal.args,
    };
    await chatImpl.confirmTool({ ctx: fixtureCtx, input });
    await chatImpl.confirmTool({ ctx: fixtureCtx, input });
    expect(deps.engine.store.creditEntries).toHaveLength(1);
  });

  it("shares the idempotency key with the staged UI — no double charge", async () => {
    // Staged UI runs the same stage with the same input first.
    const stagedInput = scriptContracts.hooks.input.parse({
      workspaceId: fixtureCtx.workspaceId,
      projectId: fixtureProject.id,
      generation: archetypeGen,
    });
    await scriptStagesImpl.hooks({ ctx: fixtureCtx, input: stagedInput });
    expect(deps.engine.store.creditEntries).toHaveLength(1);

    // An identical chat confirm (same args → same hashed run identity) re-serves.
    const proposal = await seedProposal(
      "make_hooks",
      { projectId: fixtureProject.id, generation: archetypeGen },
      1,
    );
    await chatImpl.confirmTool({
      ctx: fixtureCtx,
      input: {
        workspaceId: fixtureCtx.workspaceId,
        threadId,
        toolCallId: proposal.toolCallId,
        args: proposal.args,
      },
    });
    expect(deps.engine.store.creditEntries).toHaveLength(1);
  });

  it("a 0-credit workspace rejects confirm with PRECONDITION_FAILED (no free script)", async () => {
    const workspace = getSharedWorkspaceStore().workspaces.find(
      (w) => w.id === FIXTURE_IDS.workspace,
    );
    if (workspace === undefined) throw new Error("fixture workspace missing");
    workspace.creditBalance = 0;

    const proposal = await seedProposal(
      "make_hooks",
      { projectId: fixtureProject.id, generation: archetypeGen },
      1,
    );
    const err = await chatImpl
      .confirmTool({
        ctx: fixtureCtx,
        input: {
          workspaceId: fixtureCtx.workspaceId,
          threadId,
          toolCallId: proposal.toolCallId,
          args: proposal.args,
        },
      })
      .catch((e: unknown) => e);
    expect((err as TRPCError).code).toBe("PRECONDITION_FAILED");
    expect(deps.engine.store.creditEntries).toHaveLength(0);
  });

  it("an ADMIN_EMAILS writer at 0 credits confirms without a debit (free-admin bypass)", async () => {
    const workspace = getSharedWorkspaceStore().workspaces.find(
      (w) => w.id === FIXTURE_IDS.workspace,
    );
    if (workspace === undefined) throw new Error("fixture workspace missing");
    workspace.creditBalance = 0;

    const proposal = await seedProposal(
      "make_hooks",
      { projectId: fixtureProject.id, generation: archetypeGen },
      1,
    );
    const exemptCtx: WorkspaceHandlerCtx = {
      ...fixtureCtx,
      userEmail: "joshbuse@hexbandit.io",
      role: "writer",
    };
    process.env.ADMIN_EMAILS = "joshbuse@hexbandit.io";
    resetConfigForTests();
    const result = await chatImpl.confirmTool({
      ctx: exemptCtx,
      input: {
        workspaceId: fixtureCtx.workspaceId,
        threadId,
        toolCallId: proposal.toolCallId,
        args: proposal.args,
      },
    });
    expect(result.status).toBe("accepted");
    expect(deps.engine.store.creditEntries).toHaveLength(0);
    delete process.env.ADMIN_EMAILS;
    resetConfigForTests();
  });
});

describe("licensed-voice guard via the chat draft tool", () => {
  it("fails closed (FORBIDDEN, no charge) when the voice has no signed license", async () => {
    // A licensed profile missing its signed license — unusable. Constructed
    // directly (the schema refuses persisting one) to exercise the guard.
    const unusable = {
      ...fixtureVoiceProfile,
      id: voiceProfileIdSchema.parse(randomUUID()),
      source: "licensed",
      licenseDocUrl: null,
      licenseSignedAt: null,
    } as VoiceProfile;
    deps.engine.store.seedVoiceProfile(unusable);

    const proposal = await seedProposal(
      "draft_script",
      { projectId: fixtureProject.id, frameId: fixtureFrame.id, voiceProfileId: unusable.id },
      4,
    );
    const err = await chatImpl
      .confirmTool({
        ctx: fixtureCtx,
        input: {
          workspaceId: fixtureCtx.workspaceId,
          threadId,
          toolCallId: proposal.toolCallId,
          args: proposal.args,
        },
      })
      .catch((e: unknown) => e);
    expect((err as TRPCError).code).toBe("FORBIDDEN");
    expect((err as TRPCError).message).toMatch(/license/i);
    expect(deps.engine.store.creditEntries).toHaveLength(0);
  });
});

describe("tenancy on threads and messages", () => {
  const foreignCtx: WorkspaceHandlerCtx = {
    userId: asUserId(FIXTURE_IDS.user),
    workspaceId: workspaceIdSchema.parse("00000000-0000-4000-8000-0000000000aa"),
  };

  it("a foreign workspace cannot see or act on another workspace's thread", async () => {
    const list = await chatImpl.listThreads({
      ctx: foreignCtx,
      input: { workspaceId: foreignCtx.workspaceId, projectId: null, limit: 50 },
    });
    expect(list).toHaveLength(0);

    for (const op of [
      () =>
        chatImpl.getThread({
          ctx: foreignCtx,
          input: { workspaceId: foreignCtx.workspaceId, threadId, limit: 50, cursor: null },
        }),
      () =>
        chatImpl.sendMessage({
          ctx: foreignCtx,
          input: { workspaceId: foreignCtx.workspaceId, threadId, content: "hi" },
        }),
      () =>
        chatImpl.confirmTool({
          ctx: foreignCtx,
          input: {
            workspaceId: foreignCtx.workspaceId,
            threadId,
            toolCallId: "call_whatever",
            args: {},
          },
        }),
      () =>
        chatImpl.deleteThread({
          ctx: foreignCtx,
          input: { workspaceId: foreignCtx.workspaceId, threadId },
        }),
    ]) {
      const err = await op().catch((e: unknown) => e);
      expect((err as TRPCError).code).toBe("NOT_FOUND");
    }
  });
});

describe("persona + orchestrator guardrails", () => {
  it("buildCoachSystemPrompt never names the model/vendor", () => {
    const prompt = buildCoachSystemPrompt(fixtureCoachContext);
    expect(prompt).not.toMatch(/grok|xai/i);
    expect(prompt).toContain("Coach");
  });

  it("a malformed tool directive yields no proposal, just the reply", () => {
    const turn = toCoachTurn("Here's my take.\n\n```coach-tool\n{not json}\n```");
    expect(turn.proposal).toBeNull();
    expect(turn.replyText).toContain("Here's my take.");
  });

  it("a workspace-level coach (no project) proposes nothing under-specified", () => {
    const wsContext = { ...fixtureCoachContext, projectId: null, projectTitle: null };
    const reply = synthCoachReply("give me a hook", wsContext);
    expect(toCoachTurn(reply).proposal).toBeNull();
  });
});
