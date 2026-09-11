import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { CoachContext } from "@/lib/types/chat";
import type { ChatToolCall } from "@/lib/types/entities";
import { getChatTool, estimateToolCredits } from "@/lib/chat/tools";

/**
 * Chat orchestration — tool-intent parsing + the coach reply generator
 * (Wave D, D1). Pure and provider-agnostic: the SSE route wires the LLM and
 * streaming, this module decides what the Coach says and whether it proposes
 * a tool.
 *
 * Tool-call protocol (deterministic, not model-native function calling):
 * the Coach is instructed to end a reply with a single fenced block
 *
 *   ```coach-tool
 *   {"name":"make_hooks","args":{...}}
 *   ```
 *
 * when it wants to run a studio tool. parseToolDirective extracts that block;
 * buildToolProposal validates the name against CHAT_TOOLS and the args against
 * the tool's argsSchema. On ANY parse/validation failure there is NO proposal
 * — the user just gets the natural-language reply (fail-safe; never executes
 * or charges on a malformed directive). The same parser runs over both the
 * live model output and the deterministic fixture reply, so fixture mode
 * exercises the identical propose → confirm path with zero keys.
 *
 * GUARDRAIL: nothing here names the underlying model/vendor; the persona
 * (lib/chat/persona.ts) owns the product-native voice.
 */

/** Appended to the system prompt so the model emits parseable tool requests. */
export const TOOL_PROTOCOL_INSTRUCTIONS = [
  `When the creator asks you to actually produce work that one of your tools`,
  `performs, end your reply with a single fenced block, on its own, exactly like:`,
  ``,
  "```coach-tool",
  `{"name":"<tool>","args":{ ... }}`,
  "```",
  ``,
  `Valid tool names: list_topics, make_outline, make_hooks, draft_script,`,
  `revise_section, make_titles, thumbnail_brief, fetch_research. Put only`,
  `arguments you are sure of in "args"; omit the rest. Never include the block`,
  `unless you genuinely want to run the tool — the creator confirms (and pays)`,
  `before anything runs. Keep the natural-language part short and above the block.`,
].join("\n");

const directiveSchema = z.object({
  name: z.string(),
  args: z.record(z.string(), z.unknown()).default({}),
});

const TOOL_BLOCK_RE = /```coach-tool\s*([\s\S]*?)```/g;

/** The raw (unvalidated) tool request in a reply, if any — the LAST block wins. */
export function parseToolDirective(
  text: string,
): { name: string; args: Record<string, unknown> } | null {
  let match: RegExpExecArray | null;
  let last: string | null = null;
  TOOL_BLOCK_RE.lastIndex = 0;
  while ((match = TOOL_BLOCK_RE.exec(text)) !== null) {
    last = match[1] ?? null;
  }
  if (last === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(last.trim());
  } catch {
    return null;
  }
  const parsed = directiveSchema.safeParse(json);
  if (!parsed.success) return null;
  return { name: parsed.data.name, args: parsed.data.args };
}

/** The natural-language reply with any tool block(s) removed and trimmed. */
export function stripToolDirective(text: string): string {
  return text.replace(TOOL_BLOCK_RE, "").trim();
}

/**
 * Validate a raw directive into a concrete tool proposal: the name must be a
 * known tool and the args must satisfy its frozen argsSchema. Returns null on
 * any mismatch (→ no proposal). The toolCallId is what the client echoes back
 * to chat.confirmTool; args are the VALIDATED args that will be executed.
 */
export function buildToolProposal(
  name: string,
  args: Record<string, unknown>,
): ChatToolCall | null {
  const tool = getChatTool(name);
  if (tool === null) return null;
  const parsed = tool.argsSchema.safeParse(args);
  if (!parsed.success) return null;
  const validArgs = parsed.data as Record<string, unknown>;
  return {
    toolCallId: `call_${name}_${randomUUID().slice(0, 8)}`,
    name: tool.name,
    args: validArgs,
    estimatedCredits: estimateToolCredits(name, validArgs),
  };
}

export interface CoachTurn {
  /** The natural-language reply, tool block already stripped. */
  replyText: string;
  /** A validated tool proposal, or null when the turn is text-only. */
  proposal: ChatToolCall | null;
}

/**
 * Turn a raw model reply into a CoachTurn: strip the directive from the text,
 * and build a validated proposal from it (null when absent/invalid). Shared
 * by the live path and the fixture path.
 */
export function toCoachTurn(rawReply: string): CoachTurn {
  const directive = parseToolDirective(rawReply);
  const proposal = directive === null ? null : buildToolProposal(directive.name, directive.args);
  return { replyText: stripToolDirective(rawReply), proposal };
}

// ---------------------------------------------------------------------------
// Deterministic fixture reply (keyless mode)
// ---------------------------------------------------------------------------

interface IntentRule {
  test: RegExp;
  /** Build a raw directive's args from context; null ⇒ propose nothing. */
  build: (
    ctx: CoachContext,
    userText: string,
  ) => { name: string; args: Record<string, unknown> } | null;
  /** A short natural-language lead-in for the reply. */
  say: (ctx: CoachContext) => string;
}

/** First match wins; order matters (draft before the generic "script"). */
const INTENT_RULES: readonly IntentRule[] = [
  {
    test: /\b(hook|opening|cold open|intro)\b/i,
    build: (ctx) =>
      ctx.projectId === null ? null : { name: "make_hooks", args: { projectId: ctx.projectId } },
    say: () =>
      "Good instinct — the hook does most of the work. I can generate three tagged hook options constrained to your style card.",
  },
  {
    test: /\b(outline|structure|sections?|beats?)\b/i,
    build: (ctx) =>
      ctx.projectId === null ? null : { name: "make_outline", args: { projectId: ctx.projectId } },
    say: () =>
      "Let's lock the structure first. I can build a section outline honoring your pacing and target length.",
  },
  {
    test: /\b(title|headline|name it)\b/i,
    build: (ctx) =>
      ctx.projectId === null ? null : { name: "make_titles", args: { projectId: ctx.projectId } },
    say: () => "Titles decide the click. I can generate scored options across pattern families.",
  },
  {
    test: /\b(research|sources?|fact.?check|evidence)\b/i,
    build: (ctx, userText) =>
      ctx.projectId === null
        ? null
        : {
            name: "fetch_research",
            args: { projectId: ctx.projectId, query: deriveQuery(userText, ctx) },
          },
    say: () =>
      "Happy to ground this in sources. I can run the research agent and attach a cited brief.",
  },
  {
    test: /\b(thumbnail|thumb)\b/i,
    build: (ctx) =>
      ctx.projectId === null
        ? null
        : {
            name: "thumbnail_brief",
            args: {
              projectId: ctx.projectId,
              compositionPattern: "auto",
              subjectDescription: ctx.projectTitle ?? ctx.uniqueAngle ?? "the video's subject",
            },
          },
    say: () => "I can sketch a thumbnail brief — composition pattern, subject, and overlay text.",
  },
  {
    test: /\b(topic|ideas?|what should i make)\b/i,
    // Topics needs a channelId the grounding context doesn't carry — so the
    // fixture twin offers it in words but proposes nothing (the live model
    // fills channelId). Never propose an under-specified tool.
    build: () => null,
    say: () =>
      "I can pull fresh topic candidates grounded in your niche and recent outliers — tell me the channel and I'll line them up.",
  },
];

function deriveQuery(userText: string, ctx: CoachContext): string {
  const cleaned = userText
    .replace(/\b(research|look up|find|sources? (on|for)|about)\b/gi, "")
    .trim();
  if (cleaned.length >= 8) return cleaned.slice(0, 200);
  return ctx.nicheKeywords[0] ?? ctx.projectTitle ?? "background for this video";
}

/**
 * Deterministic keyless coach reply. Produces a grounded natural reply and,
 * when the message expresses a tool intent the context can fully specify,
 * appends the coach-tool directive block — so fixture mode streams a real
 * propose → confirm flow. Same output shape the live model is instructed to
 * produce, so toCoachTurn parses both identically.
 */
export function synthCoachReply(userText: string, ctx: CoachContext): string {
  const grounding =
    ctx.projectId === null
      ? "I'm your channel coach — ask me to plan a video, workshop angles, or run any studio tool."
      : `For "${ctx.projectTitle ?? "this video"}"${ctx.uniqueAngle === null ? "" : ` (angle: ${ctx.uniqueAngle})`}, here's my read:`;

  for (const rule of INTENT_RULES) {
    if (!rule.test.test(userText)) continue;
    const directive = rule.build(ctx, userText);
    const lead = `${grounding} ${rule.say(ctx)}`;
    if (directive === null) return lead;
    return `${lead}\n\n\`\`\`coach-tool\n${JSON.stringify(directive)}\n\`\`\``;
  }

  return `${grounding} Tell me where you want to start — topics, a hook, the outline, a full draft, titles, a thumbnail brief, or research — and I'll take it from there.`;
}
