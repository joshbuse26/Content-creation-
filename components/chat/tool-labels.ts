import type { ChatToolName } from "@/lib/types/enums";

/** Human, product-native labels for the chat tools (no vendor name, ever). */
export const TOOL_LABELS: Record<ChatToolName, string> = {
  list_topics: "Topic ideas",
  make_outline: "Outline",
  make_hooks: "Hooks",
  draft_script: "Draft",
  revise_section: "Revision pass",
  make_titles: "Titles",
  thumbnail_brief: "Thumbnail brief",
  fetch_research: "Research",
};

export function toolLabel(name: string): string {
  return (TOOL_LABELS as Record<string, string>)[name] ?? name;
}
