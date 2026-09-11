import { z } from "zod";
import { chatToolNameSchema } from "./enums";
import { archetypeIdSchema } from "./enums";
import { styleCardSchema } from "./entities";

/**
 * Chat streaming + grounding types — FROZEN LAYER (Wave D, WAVE-D-PLAN §2a/§2b).
 *
 * The SSE event union mirrors the frozen ScriptStreamEvent style
 * (lib/types/pipeline.ts): a Zod discriminated union on `type`, JSON-encoded
 * one event per SSE frame. D1 streams `chat.sendMessage` replies over it; the
 * wire format and encode helper are shared with the script stream so the
 * client SSE plumbing stays uniform.
 */

// ---------------------------------------------------------------------------
// Chat SSE event union
// ---------------------------------------------------------------------------

/** A token/segment of the assistant's streamed reply. */
export const chatMessageDeltaEventSchema = z.object({
  type: z.literal("message_delta"),
  text: z.string(),
});

/**
 * The assistant proposes a credit-costing tool call. The client surfaces a
 * confirm dialog (name + args + estimatedCredits); on confirm it calls
 * `chat.confirmTool`, which executes the mapped staged handler (D1).
 */
export const chatToolProposedEventSchema = z.object({
  type: z.literal("tool_proposed"),
  toolCallId: z.string().min(1),
  name: chatToolNameSchema,
  args: z.record(z.string(), z.unknown()),
  estimatedCredits: z.number().int().nonnegative(),
});

/** The result of an executed tool call (after confirm). */
export const chatToolResultEventSchema = z.object({
  type: z.literal("tool_result"),
  toolCallId: z.string().min(1),
  ok: z.boolean(),
  summary: z.string(),
});

/** Terminal: the assistant turn finished cleanly. */
export const chatDoneEventSchema = z.object({ type: z.literal("done") });

/** Terminal: the assistant turn failed. */
export const chatErrorEventSchema = z.object({
  type: z.literal("error"),
  message: z.string(),
});

export const chatStreamEventSchema = z.discriminatedUnion("type", [
  chatMessageDeltaEventSchema,
  chatToolProposedEventSchema,
  chatToolResultEventSchema,
  chatDoneEventSchema,
  chatErrorEventSchema,
]);
export type ChatStreamEvent = z.infer<typeof chatStreamEventSchema>;

/** A chat stream is over when a `done` or `error` event arrives. */
export function isTerminalChatEvent(event: ChatStreamEvent): boolean {
  return event.type === "done" || event.type === "error";
}

/**
 * SSE wire encoding for a chat event — identical framing to the script
 * stream's encodeSseEvent (app/api/script-stream/stream.ts):
 *   event: <event.type>
 *   data:  <JSON of the whole event>
 * Kept here so the chat SSE route (D1) and this contract stay in one place.
 */
export function encodeChatSseEvent(event: ChatStreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

// ---------------------------------------------------------------------------
// CoachContext — the grounding bundle the Coach persona is injected with
// (WAVE-D-PLAN §2b). Assembled read-only from EXISTING data by the pure
// buildCoachContext(projectId, workspaceId) helper (lib/chat/context.ts).
// Every field degrades to null gracefully so a bare/new project still yields
// a valid context object.
// ---------------------------------------------------------------------------

/** The active style card + how it was resolved (for persona grounding + UI). */
export const coachStyleContextSchema = z.object({
  /** archetype | crossover | trained | own_channel | licensed | null. */
  source: z.string().nullable(),
  /** Archetype id when the active card is an archetype/crossover base. */
  archetypeId: archetypeIdSchema.nullable().default(null),
  card: styleCardSchema.nullable(),
});
export type CoachStyleContext = z.infer<typeof coachStyleContextSchema>;

/** A compact, LLM-injectable summary of the attached research pack. */
export const coachResearchSummarySchema = z.object({
  docCount: z.number().int().nonnegative(),
  totalWords: z.number().int().nonnegative(),
  /** Titles of the attached docs, capped for prompt budget. */
  titles: z.array(z.string()),
});
export type CoachResearchSummary = z.infer<typeof coachResearchSummarySchema>;

/** Minimal audience-avatar projection carried into the persona context. */
export const coachAudienceSchema = z.object({
  sophistication: z.string().nullable(),
  topPains: z.array(z.string()),
  topMotivations: z.array(z.string()),
  vocabularyNotes: z.string().nullable(),
});
export type CoachAudience = z.infer<typeof coachAudienceSchema>;

export const coachContextSchema = z.object({
  workspaceId: z.string(),
  projectId: z.string().nullable(),
  projectTitle: z.string().nullable(),
  channelTitle: z.string().nullable(),
  nicheKeywords: z.array(z.string()),
  style: coachStyleContextSchema,
  audience: coachAudienceSchema.nullable(),
  research: coachResearchSummarySchema,
  /** The chosen frame's angle — the steerable unique perspective, if any. */
  uniqueAngle: z.string().nullable(),
  /** Target runtime in minutes (chosen frame), if any. */
  durationMinutes: z.number().int().positive().nullable(),
});
export type CoachContext = z.infer<typeof coachContextSchema>;
