import { formatTimestamp } from "@/pipelines/packaging/chapters";
import { totalSeconds, wordCount, type ExportScriptInput } from "./types";

/** Plain-text export: readable, printable, no markup. */
export function exportPlainText(input: ExportScriptInput): string {
  const header = [
    input.title.toUpperCase(),
    `Version ${input.version} · ${wordCount(input)} words · est. runtime ${formatTimestamp(totalSeconds(input))}`,
    "=".repeat(72),
  ];

  let cursor = 0;
  const blocks = input.sections.map((section) => {
    const at = formatTimestamp(cursor);
    cursor += Math.max(0, section.estSeconds);
    return [`[${at}] ${section.heading} (${section.kind})`, "-".repeat(48), section.body].join(
      "\n",
    );
  });

  return [...header, "", blocks.join("\n\n")].join("\n") + "\n";
}
