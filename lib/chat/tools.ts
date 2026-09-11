import { z } from "zod";
import {
  researchContracts,
  revisionContracts,
  scriptContracts,
  thumbnailsContracts,
  titlesContracts,
} from "@/lib/types/api";
import { CHAT_TOOL_NAMES, type ChatToolName } from "@/lib/types/enums";
import { CREDIT_COSTS } from "@/server/credits";

/**
 * CHAT_TOOLS — the typed chat tool-calling registry (WAVE-D-PLAN §2b),
 * FROZEN in D0. Each tool maps to an EXISTING staged pipeline handler; D1
 * wires execution (import the handler, never reimplement) so a chat tool
 * call and the staged UI hitting the same stage share one idempotent charge.
 *
 * D0 freezes the surface only: the arg schema, the credit cost (drawn from
 * server/credits.ts CREDIT_COSTS, or 0 for a free/read tool), and a `mapsTo`
 * note naming the exact handler D1 calls. Arg schemas are derived from the
 * existing contract inputs (minus `workspaceId`, which the chat router
 * injects from context) so they cannot drift from the handlers.
 */

/** Strip the router-injected workspaceId from a contract input. */
const toolArgs = (input: z.ZodObject): z.ZodType => input.omit({ workspaceId: true });

export interface ChatTool {
  name: ChatToolName;
  description: string;
  /** Precise args, aligned to the mapped handler's input (no workspaceId). */
  argsSchema: z.ZodType;
  /** Credits this tool costs when executed. 0 = free/read (runs inline). */
  creditCost: number;
  /** The existing handler D1 executes for this tool (import, never reimplement). */
  mapsTo: string;
}

export const CHAT_TOOLS = {
  list_topics: {
    name: "list_topics",
    description:
      "Propose fresh video topic candidates for the channel, grounded in its niche, " +
      "recent outliers, and the active style card.",
    argsSchema: toolArgs(scriptContracts.topics.input),
    creditCost: CREDIT_COSTS.scriptTopics,
    mapsTo: "scriptStagesImpl.topics (script.topics)",
  },
  make_outline: {
    name: "make_outline",
    description:
      "Build a section outline from the chosen topic and research, honoring the style " +
      "card's pacing and the target duration.",
    argsSchema: toolArgs(scriptContracts.outline.input),
    creditCost: CREDIT_COSTS.scriptOutline,
    mapsTo: "scriptStagesImpl.outline (script.outline)",
  },
  make_hooks: {
    name: "make_hooks",
    description:
      "Generate three tagged hook candidates constrained to the style card's allowed " +
      "hook patterns, with one auto-picked by the card's preference.",
    argsSchema: toolArgs(scriptContracts.hooks.input),
    creditCost: CREDIT_COSTS.scriptHooks,
    mapsTo: "scriptStagesImpl.hooks (script.hooks)",
  },
  draft_script: {
    name: "draft_script",
    description:
      "Write the full section-streamed script from the approved outline and chosen hook " +
      "(retention, voice, fact-check, and quality passes run inside).",
    argsSchema: toolArgs(scriptContracts.draft.input),
    creditCost: CREDIT_COSTS.scriptDraft,
    mapsTo: "scriptStagesImpl.draft (script.draft)",
  },
  revise_section: {
    name: "revise_section",
    description:
      "Run the revision pass over a script, proposing per-section diff suggestions the " +
      "user can accept or reject.",
    argsSchema: toolArgs(revisionContracts.run.input),
    creditCost: CREDIT_COSTS.revisionPass,
    mapsTo: "revisionImpl.run (revision.run)",
  },
  make_titles: {
    name: "make_titles",
    description: "Generate scored title options across pattern families for the project.",
    argsSchema: toolArgs(titlesContracts.generate.input),
    creditCost: CREDIT_COSTS.titles,
    mapsTo: "titlesImpl.generate (titles.generate)",
  },
  thumbnail_brief: {
    name: "thumbnail_brief",
    description:
      "Produce a thumbnail composition brief (pattern + subject + overlay text) for the " +
      "project. v1 text brief is free; image generation (v1.1) meters per image.",
    argsSchema: toolArgs(thumbnailsContracts.generate.input),
    // v1: text brief only — free. Re-cost when image generation is wired
    // (CREDIT_REASONS already reserves `thumbnail`); see thumbnails impl.
    creditCost: 0,
    mapsTo: "thumbnailsImpl.generate (thumbnails.generate)",
  },
  fetch_research: {
    name: "fetch_research",
    description: "Run the research agent for a query and attach a cited brief to the project.",
    argsSchema: toolArgs(researchContracts.search.input),
    creditCost: CREDIT_COSTS.researchRun,
    mapsTo: "researchImpl.search (research.search)",
  },
} as const satisfies Record<ChatToolName, ChatTool>;

/** Every registered tool, in the frozen registry order. */
export const CHAT_TOOL_LIST: readonly ChatTool[] = CHAT_TOOL_NAMES.map((name) => CHAT_TOOLS[name]);

/** Lookup with a runtime guard (name comes off the wire in D1). */
export function getChatTool(name: string): ChatTool | null {
  return name in CHAT_TOOLS ? CHAT_TOOLS[name as ChatToolName] : null;
}

/**
 * Pure pre-execution credit estimate for a proposed tool call (WAVE-D-PLAN
 * §2b): the quote surfaced in the confirm dialog and carried on the
 * `tool_proposed` SSE event. Args are accepted so a future per-arg cost
 * (e.g. image count on thumbnail generation) can refine it; today every
 * tool is flat-cost, so the registry cost is returned. Unknown tools cost 0.
 */
export function estimateToolCredits(name: string, _args: Record<string, unknown> = {}): number {
  const tool = getChatTool(name);
  return tool?.creditCost ?? 0;
}

/**
 * JSON-schema view of the registry (for future MCP tool-definition parity).
 * `unrepresentable: "any"` keeps refinement-carrying arg schemas (e.g. the
 * generation target) representable rather than throwing.
 */
export interface ChatToolJsonSchema {
  name: ChatToolName;
  description: string;
  creditCost: number;
  inputSchema: unknown;
}

export function chatToolsJsonSchema(): ChatToolJsonSchema[] {
  return CHAT_TOOL_LIST.map((tool) => ({
    name: tool.name,
    description: tool.description,
    creditCost: tool.creditCost,
    inputSchema: z.toJSONSchema(tool.argsSchema, { unrepresentable: "any" }),
  }));
}
