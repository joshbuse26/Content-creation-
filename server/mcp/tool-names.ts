/**
 * The 8 MCP tool names (build spec §6) — kept in a leaf module with no
 * imports so both the apiKeys router impl (scope validation), the settings
 * UI (scope pickers) and the MCP dispatcher can share them without cycles.
 *
 * API-key `scopes` are exactly these names: a key may only call tools it is
 * scoped for (the fixture key, for example, is read-only).
 */

export const MCP_TOOL_NAMES = [
  "get_channel_stats",
  "get_idea_feed",
  "run_research",
  "generate_script",
  "get_script",
  "generate_titles",
  "generate_thumbnail",
  "get_project_status",
] as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

export function isMcpToolName(value: string): value is McpToolName {
  return (MCP_TOOL_NAMES as readonly string[]).includes(value);
}

/** One-line summaries for the settings UI scope picker. */
export const MCP_TOOL_SUMMARIES: Record<McpToolName, string> = {
  get_channel_stats: "Read a channel and its latest stats snapshot",
  get_idea_feed: "Read the idea feed for a channel",
  run_research: "Start a research run for a project (1 credit)",
  generate_script: "Generate a full script for a project (6 credits)",
  get_script: "Read a script with its sections and quality report",
  generate_titles: "Generate a scored title set for a project (1 credit)",
  generate_thumbnail: "Produce a thumbnail text brief for a project",
  get_project_status: "Read a project's pipeline status",
};
