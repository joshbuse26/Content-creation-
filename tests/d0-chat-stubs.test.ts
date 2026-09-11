import { describe, expect, it } from "vitest";
import type { TRPCError } from "@trpc/server";
import { FIXTURE_IDS } from "@/lib/fixtures";
import { chatContracts, voiceContracts } from "@/lib/types/api";
import { assertGenerationModeAllowed } from "@/server/modes";
import { chatImpl } from "@/server/routers/impl/chat";
import { voiceImpl } from "@/server/routers/impl/voice";
import { fixtureCtx } from "./a2-helpers";

/**
 * Wave D (D0): the chat + voice-train CONTRACT STUBS (WAVE-D-PLAN §2a/§2c).
 * They return realistic, contract-valid fixtures so D1's chat screen and
 * D2's trained-card flow can be built keylessly. Zero-cost by contract.
 */

const parse = {
  listThreads: (o: Record<string, unknown> = {}) =>
    chatContracts.listThreads.input.parse({ workspaceId: FIXTURE_IDS.workspace, ...o }),
  getThread: (o: Record<string, unknown> = {}) =>
    chatContracts.getThread.input.parse({
      workspaceId: FIXTURE_IDS.workspace,
      threadId: FIXTURE_IDS.chatThread,
      ...o,
    }),
  createThread: (o: Record<string, unknown> = {}) =>
    chatContracts.createThread.input.parse({
      workspaceId: FIXTURE_IDS.workspace,
      title: "New thread",
      ...o,
    }),
  sendMessage: (o: Record<string, unknown> = {}) =>
    chatContracts.sendMessage.input.parse({
      workspaceId: FIXTURE_IDS.workspace,
      threadId: FIXTURE_IDS.chatThread,
      content: "hi",
      ...o,
    }),
  confirmTool: (o: Record<string, unknown> = {}) =>
    chatContracts.confirmTool.input.parse({
      workspaceId: FIXTURE_IDS.workspace,
      threadId: FIXTURE_IDS.chatThread,
      toolCallId: "call_topics_1",
      args: {},
      ...o,
    }),
  renameThread: (o: Record<string, unknown> = {}) =>
    chatContracts.renameThread.input.parse({
      workspaceId: FIXTURE_IDS.workspace,
      threadId: FIXTURE_IDS.chatThread,
      title: "Renamed",
      ...o,
    }),
  deleteThread: (o: Record<string, unknown> = {}) =>
    chatContracts.deleteThread.input.parse({
      workspaceId: FIXTURE_IDS.workspace,
      threadId: FIXTURE_IDS.chatThread,
      ...o,
    }),
};

describe("chat.listThreads / getThread", () => {
  it("lists contract-valid threads, filterable by project", async () => {
    const all = await chatImpl.listThreads({ ctx: fixtureCtx, input: parse.listThreads() });
    expect(() => chatContracts.listThreads.output.parse(all)).not.toThrow();
    expect(all.length).toBe(2);
    const scoped = await chatImpl.listThreads({
      ctx: fixtureCtx,
      input: parse.listThreads({ projectId: FIXTURE_IDS.project }),
    });
    expect(scoped.every((t) => t.projectId === FIXTURE_IDS.project)).toBe(true);
    expect(scoped.length).toBe(1);
  });

  it("getThread returns the thread + seq-ordered messages", async () => {
    const out = await chatImpl.getThread({ ctx: fixtureCtx, input: parse.getThread() });
    expect(() => chatContracts.getThread.output.parse(out)).not.toThrow();
    expect(out.thread.id).toBe(FIXTURE_IDS.chatThread);
    expect(out.messages.map((m) => m.seq)).toEqual([0, 1, 2]);
  });

  it("getThread on an unknown thread is NOT_FOUND", async () => {
    const err = await chatImpl
      .getThread({
        ctx: fixtureCtx,
        input: parse.getThread({ threadId: "00000000-0000-4000-8000-0000000000ee" }),
      })
      .catch((e: unknown) => e);
    expect((err as TRPCError).code).toBe("NOT_FOUND");
  });
});

describe("chat mutations (zero-cost stubs)", () => {
  it("createThread echoes the requested project + title", async () => {
    const out = await chatImpl.createThread({
      ctx: fixtureCtx,
      input: parse.createThread({ projectId: FIXTURE_IDS.project, title: "Plan the intro" }),
    });
    expect(() => chatContracts.createThread.output.parse(out)).not.toThrow();
    expect(out.title).toBe("Plan the intro");
    expect(out.projectId).toBe(FIXTURE_IDS.project);
    expect(out.workspaceId).toBe(FIXTURE_IDS.workspace);
  });

  it("sendMessage acks with a stream handle", async () => {
    const out = await chatImpl.sendMessage({ ctx: fixtureCtx, input: parse.sendMessage() });
    expect(() => chatContracts.sendMessage.output.parse(out)).not.toThrow();
    expect(out.status).toBe("streaming");
    expect(out.streamPath).toContain(FIXTURE_IDS.chatThread);
  });

  it("confirmTool requires a real stored proposal (D1 lookup guard)", async () => {
    // D1 replaced the D0 ack-only stub: confirmTool now resolves the proposal
    // from the thread's persisted tool_calls, so an unknown toolCallId is
    // NOT_FOUND (never an ack). The real propose→confirm→execute→meter path is
    // covered with full deps in tests/d1-chat.test.ts.
    const err = await chatImpl
      .confirmTool({
        ctx: fixtureCtx,
        input: parse.confirmTool({ toolCallId: "call_does_not_exist" }),
      })
      .catch((e: unknown) => e);
    expect((err as TRPCError).code).toBe("NOT_FOUND");
  });

  it("renameThread + deleteThread are contract-valid", async () => {
    const renamed = await chatImpl.renameThread({ ctx: fixtureCtx, input: parse.renameThread() });
    expect(renamed.title).toBe("Renamed");
    const deleted = await chatImpl.deleteThread({ ctx: fixtureCtx, input: parse.deleteThread() });
    expect(deleted.deleted).toBe(true);
  });
});

describe("voice.trainFromChannel stub + mode seam", () => {
  it("returns a first-class trained voice profile bound to the channel", async () => {
    const input = voiceContracts.trainFromChannel.input.parse({
      workspaceId: FIXTURE_IDS.workspace,
      channelId: FIXTURE_IDS.channel,
    });
    const out = await voiceImpl.trainFromChannel({ ctx: fixtureCtx, input });
    expect(() => voiceContracts.trainFromChannel.output.parse(out)).not.toThrow();
    expect(out.voiceProfile.source).toBe("trained");
    expect(out.voiceProfile.trainedFromChannelId).toBe(FIXTURE_IDS.channel);
    expect(out.remix).toBe(false);
  });

  it("flags a competitor remix when remixFrom is provided", async () => {
    const input = voiceContracts.trainFromChannel.input.parse({
      workspaceId: FIXTURE_IDS.workspace,
      channelId: FIXTURE_IDS.channel,
      remixFrom: ["UCcompetitor00000000000001"],
    });
    const out = await voiceImpl.trainFromChannel({ ctx: fixtureCtx, input });
    expect(out.remix).toBe(true);
  });

  it("train_on_my_channel generation mode still rejects until D2", () => {
    const err = (() => {
      try {
        assertGenerationModeAllowed("train_on_my_channel");
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect((err as TRPCError).code).toBe("NOT_IMPLEMENTED");
  });
});
