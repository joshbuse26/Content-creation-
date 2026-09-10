import type { ExportScriptInput } from "./types";

/**
 * Teleprompter export: large-type-friendly plain text.
 *
 * - Short lines (default 38 chars) so the text stays readable when scaled up.
 * - One sentence starts per line group; blank line between sentences for
 *   breathing room.
 * - Loud section-break markers so the operator can jump between takes.
 * - Headings and notes are stripped to only what the presenter reads aloud.
 */

const DEFAULT_LINE_WIDTH = 38;

export function wrapForPrompter(text: string, width: number = DEFAULT_LINE_WIDTH): string[] {
  const words = text.split(/\s+/).filter((w) => w !== "");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current === "") {
      current = word;
    } else if (current.length + 1 + word.length <= width) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== "") lines.push(current);
  return lines;
}

/** Split a body into sentences, tolerant of decimals and abbreviations-lite. */
export function splitSentences(body: string): string[] {
  return body
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"$])/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

export function exportTeleprompter(
  input: ExportScriptInput,
  options: { lineWidth?: number } = {},
): string {
  const width = options.lineWidth ?? DEFAULT_LINE_WIDTH;
  const out: string[] = [];

  for (const section of input.sections) {
    out.push(`>>> ${section.heading.toUpperCase()} <<<`);
    out.push("");
    for (const sentence of splitSentences(section.body)) {
      out.push(...wrapForPrompter(sentence, width));
      out.push("");
    }
  }

  out.push(">>> END OF SCRIPT <<<");
  return out.join("\n") + "\n";
}
