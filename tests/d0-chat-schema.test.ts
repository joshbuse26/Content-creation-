import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  fixtureChatMessages,
  fixtureChatThread,
  fixtureChatThreadWorkspace,
  fixtureCoachContext,
  fixtureTrainStyleCardResult,
  fixtureTrainedVoiceProfile,
  FIXTURE_IDS,
} from "@/lib/fixtures";
import {
  chatMessageSchema,
  chatThreadSchema,
  chatToolCallSchema,
  trainStyleCardInputSchema,
  voiceProfileSchema,
} from "@/lib/types/entities";
import {
  chatStreamEventSchema,
  coachContextSchema,
  encodeChatSseEvent,
  isTerminalChatEvent,
  type ChatStreamEvent,
} from "@/lib/types/chat";
import { CHAT_ROLES, CHAT_TOOL_NAMES, VOICE_SOURCES } from "@/lib/types/enums";

/**
 * Wave D (D0): frozen chat + trained-voice schema contracts (WAVE-D-PLAN
 * §2a/§2c). These are the shapes D1/D2 build against — they must stay valid
 * and self-consistent with the fixtures.
 */

describe("chat entity schemas", () => {
  it("chatThreadSchema accepts project-scoped and workspace-level threads", () => {
    expect(() => chatThreadSchema.parse(fixtureChatThread)).not.toThrow();
    expect(fixtureChatThread.projectId).toBe(FIXTURE_IDS.project);
    // Workspace-level coach thread: projectId null is valid.
    expect(() => chatThreadSchema.parse(fixtureChatThreadWorkspace)).not.toThrow();
    expect(fixtureChatThreadWorkspace.projectId).toBeNull();
  });

  it("chatMessageSchema models user, assistant(+tool_calls), and tool result", () => {
    for (const m of fixtureChatMessages) expect(() => chatMessageSchema.parse(m)).not.toThrow();
    const roles = fixtureChatMessages.map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "tool"]);
    const assistant = fixtureChatMessages.find((m) => m.role === "assistant");
    expect(assistant?.toolCalls?.[0]).toMatchObject({ name: "list_topics", estimatedCredits: 1 });
    const tool = fixtureChatMessages.find((m) => m.role === "tool");
    // A tool result links back to the proposing call and carries its charge.
    expect(tool?.toolCallId).toBe("call_topics_1");
    expect(tool?.creditsCharged).toBe(1);
  });

  it("chatToolCallSchema requires a name from the frozen tool registry", () => {
    expect(() =>
      chatToolCallSchema.parse({
        toolCallId: "x",
        name: "not_a_tool",
        args: {},
        estimatedCredits: 0,
      }),
    ).toThrow();
  });

  it("messages within a thread are seq-ordered", () => {
    const seqs = fixtureChatMessages.map((m) => m.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });
});

describe("chat SSE event union", () => {
  const events: ChatStreamEvent[] = [
    { type: "message_delta", text: "hello" },
    {
      type: "tool_proposed",
      toolCallId: "c1",
      name: "list_topics",
      args: { channelId: FIXTURE_IDS.channel },
      estimatedCredits: 1,
    },
    { type: "tool_result", toolCallId: "c1", ok: true, summary: "done" },
    { type: "done" },
    { type: "error", message: "boom" },
  ];

  it("parses every variant", () => {
    for (const e of events) expect(() => chatStreamEventSchema.parse(e)).not.toThrow();
  });

  it("done and error are terminal; the rest are not", () => {
    expect(isTerminalChatEvent({ type: "done" })).toBe(true);
    expect(isTerminalChatEvent({ type: "error", message: "x" })).toBe(true);
    expect(isTerminalChatEvent({ type: "message_delta", text: "x" })).toBe(false);
  });

  it("encodeChatSseEvent mirrors the script SSE framing", () => {
    expect(encodeChatSseEvent({ type: "done" })).toBe('event: done\ndata: {"type":"done"}\n\n');
    const frame = encodeChatSseEvent({ type: "message_delta", text: "hi" });
    expect(frame.startsWith("event: message_delta\ndata: ")).toBe(true);
    expect(frame.endsWith("\n\n")).toBe(true);
  });
});

describe("coachContextSchema", () => {
  it("validates the assembled context fixture", () => {
    expect(() => coachContextSchema.parse(fixtureCoachContext)).not.toThrow();
  });
});

describe("trained voice contract", () => {
  it("VOICE_SOURCES gains 'trained'", () => {
    expect(VOICE_SOURCES).toContain("trained");
  });

  it("a trained voice requires trainedFromChannelId (provenance)", () => {
    expect(() => voiceProfileSchema.parse(fixtureTrainedVoiceProfile)).not.toThrow();
    expect(fixtureTrainedVoiceProfile.trainedFromChannelId).toBe(FIXTURE_IDS.channel);
    expect(() =>
      voiceProfileSchema.parse({ ...fixtureTrainedVoiceProfile, trainedFromChannelId: null }),
    ).toThrow();
  });

  it("non-trained sources default the trained columns to null", () => {
    const parsed = voiceProfileSchema.parse({
      ...fixtureTrainedVoiceProfile,
      source: "own_channel",
      trainedFromChannelId: undefined,
      trainedAt: undefined,
    });
    expect(parsed.trainedFromChannelId).toBeNull();
    expect(parsed.trainedAt).toBeNull();
  });

  it("trainStyleCardInputSchema + result fixture validate", () => {
    expect(() => trainStyleCardInputSchema.parse({ channelId: FIXTURE_IDS.channel })).not.toThrow();
    expect(fixtureTrainStyleCardResult.voiceProfile.source).toBe("trained");
    expect(fixtureTrainStyleCardResult.remix).toBe(false);
  });
});

describe("frozen enums", () => {
  it("CHAT_ROLES and CHAT_TOOL_NAMES are frozen", () => {
    expect(CHAT_ROLES).toEqual(["user", "assistant", "tool"]);
    expect(CHAT_TOOL_NAMES).toHaveLength(8);
  });
});

describe("migration 0008", () => {
  const sql = readFileSync(
    join(__dirname, "..", "db", "migrations", "0008_wave_d_chat_and_trained_voice.sql"),
    "utf8",
  );

  it("creates the chat tables and their indexes", () => {
    expect(sql).toContain('CREATE TABLE "chat_threads"');
    expect(sql).toContain('CREATE TABLE "chat_messages"');
    expect(sql).toContain("chat_messages_thread_seq_uq");
    expect(sql).toContain("chat_threads_workspace_project_idx");
  });

  it("adds the trained-voice value + columns, and casts to text in the CHECK", () => {
    expect(sql).toContain("ADD VALUE 'trained'");
    expect(sql).toContain('"trained_from_channel_id"');
    expect(sql).toContain('"trained_at"');
    // The CHECK casts source to text so it doesn't use the freshly added
    // enum value in the same transaction (Postgres rejects that).
    expect(sql).toContain("\"source\"::text <> 'trained'");
  });
});
