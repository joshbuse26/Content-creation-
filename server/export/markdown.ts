import { formatTimestamp } from "@/pipelines/packaging/chapters";
import { totalSeconds, wordCount, type ExportScriptInput } from "./types";

/** Markdown export: headings per section, retention notes as blockquotes. */
export function exportMarkdown(input: ExportScriptInput): string {
  const lines: string[] = [
    `# ${input.title}`,
    "",
    `> Version ${input.version} · ${wordCount(input)} words · est. runtime ${formatTimestamp(totalSeconds(input))}`,
    "",
  ];

  let cursor = 0;
  for (const section of input.sections) {
    lines.push(`## ${formatTimestamp(cursor)} — ${section.heading}`);
    lines.push("");
    if (section.retentionNote != null && section.retentionNote !== "") {
      lines.push(`> _Retention: ${section.retentionNote}_`);
      lines.push("");
    }
    lines.push(section.body);
    lines.push("");
    cursor += Math.max(0, section.estSeconds);
  }

  return lines.join("\n");
}
