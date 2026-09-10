import { z } from "zod";

/**
 * Free standalone tools — spec §6 (/tools/*): no auth, IP rate limited
 * (freeTools policy, 5/day), fast-tier LLM only, tight token budgets.
 *
 * This module holds the tool ids and input schemas shared by the API route
 * and the (client) pages. The generation logic lives in server/tools/run.ts.
 */

export const FREE_TOOL_IDS = [
  "title-generator",
  "tag-generator",
  "description-generator",
  "hook-analyzer",
] as const;
export type FreeToolId = (typeof FREE_TOOL_IDS)[number];

export const freeToolRequestSchema = z.discriminatedUnion("tool", [
  z.object({
    tool: z.literal("title-generator"),
    topic: z.string().trim().min(3).max(200),
    audience: z.string().trim().max(120).optional(),
  }),
  z.object({
    tool: z.literal("tag-generator"),
    topic: z.string().trim().min(3).max(300),
  }),
  z.object({
    tool: z.literal("description-generator"),
    summary: z.string().trim().min(10).max(1200),
  }),
  z.object({
    tool: z.literal("hook-analyzer"),
    hook: z.string().trim().min(10).max(1500),
  }),
]);
export type FreeToolRequest = z.infer<typeof freeToolRequestSchema>;

export interface FreeToolResult {
  /** List-style results (titles, tags); null for prose tools. */
  items: string[] | null;
  /** Prose result (description, hook analysis); null for list tools. */
  text: string | null;
}
