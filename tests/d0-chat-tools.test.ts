import { describe, expect, it } from "vitest";
import { fixtureChatToolEstimates } from "@/lib/fixtures";
import {
  CHAT_TOOLS,
  CHAT_TOOL_LIST,
  chatToolsJsonSchema,
  estimateToolCredits,
  getChatTool,
} from "@/lib/chat/tools";
import { CHAT_TOOL_NAMES } from "@/lib/types/enums";
import { CREDIT_COSTS } from "@/server/credits";

/**
 * Wave D (D0): the CHAT_TOOLS registry (WAVE-D-PLAN §2b). Frozen surface —
 * D1 wires execution against it. Verifies completeness, credit estimates,
 * that arg schemas drop the router-injected workspaceId, and the JSON-schema
 * export (MCP parity).
 */

describe("CHAT_TOOLS registry", () => {
  it("covers exactly the frozen tool names, in order", () => {
    expect(Object.keys(CHAT_TOOLS).sort()).toEqual([...CHAT_TOOL_NAMES].sort());
    expect(CHAT_TOOL_LIST.map((t) => t.name)).toEqual([...CHAT_TOOL_NAMES]);
  });

  it("every tool has a description and a maps-to handler note", () => {
    for (const tool of CHAT_TOOL_LIST) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.mapsTo.length).toBeGreaterThan(0);
      expect(tool.creditCost).toBeGreaterThanOrEqual(0);
    }
  });

  it("arg schemas are aligned to the handler input MINUS workspaceId", () => {
    // A well-formed topics call parses without a workspaceId.
    expect(() =>
      CHAT_TOOLS.list_topics.argsSchema.parse({
        channelId: "00000000-0000-4000-8000-000000000010",
        count: 5,
      }),
    ).not.toThrow();
    // workspaceId is not part of any tool's arg shape (the router injects it).
    for (const tool of CHAT_TOOL_LIST) {
      const shape = (tool.argsSchema as { shape?: Record<string, unknown> }).shape ?? {};
      expect(Object.keys(shape)).not.toContain("workspaceId");
    }
  });
});

describe("estimateToolCredits", () => {
  it("matches the credit-cost fixture for every tool", () => {
    for (const name of CHAT_TOOL_NAMES) {
      expect(estimateToolCredits(name)).toBe(fixtureChatToolEstimates[name]);
    }
  });

  it("draws costs from CREDIT_COSTS (no invented numbers)", () => {
    expect(estimateToolCredits("list_topics")).toBe(CREDIT_COSTS.scriptTopics);
    expect(estimateToolCredits("make_outline")).toBe(CREDIT_COSTS.scriptOutline);
    expect(estimateToolCredits("make_hooks")).toBe(CREDIT_COSTS.scriptHooks);
    expect(estimateToolCredits("draft_script")).toBe(CREDIT_COSTS.scriptDraft);
    expect(estimateToolCredits("revise_section")).toBe(CREDIT_COSTS.revisionPass);
    expect(estimateToolCredits("make_titles")).toBe(CREDIT_COSTS.titles);
    expect(estimateToolCredits("fetch_research")).toBe(CREDIT_COSTS.researchRun);
    // thumbnail_brief: v1 text brief is free.
    expect(estimateToolCredits("thumbnail_brief")).toBe(0);
  });

  it("is pure and safe for unknown tools", () => {
    expect(estimateToolCredits("nope")).toBe(0);
    expect(getChatTool("nope")).toBeNull();
    expect(getChatTool("draft_script")?.name).toBe("draft_script");
  });
});

describe("chatToolsJsonSchema", () => {
  it("exports one JSON schema per tool with an object inputSchema", () => {
    const schemas = chatToolsJsonSchema();
    expect(schemas.map((s) => s.name)).toEqual([...CHAT_TOOL_NAMES]);
    for (const s of schemas) {
      expect(s.inputSchema).toBeTypeOf("object");
      expect((s.inputSchema as { type?: string }).type).toBe("object");
      expect(s.creditCost).toBe(estimateToolCredits(s.name));
    }
  });
});
