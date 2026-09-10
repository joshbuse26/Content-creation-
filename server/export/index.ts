import type { ExportFormat } from "@/lib/types/enums";
import { exportDocx } from "./docx";
import { exportMarkdown } from "./markdown";
import { exportTeleprompter } from "./teleprompter";
import { exportPlainText } from "./text";
import {
  EXPORT_MIME_TYPES,
  exportFilename,
  type ExportResult,
  type ExportScriptInput,
} from "./types";

export { exportDocx } from "./docx";
export { exportMarkdown } from "./markdown";
export { exportTeleprompter, splitSentences, wrapForPrompter } from "./teleprompter";
export { exportPlainText } from "./text";
export {
  EXPORT_MIME_TYPES,
  exportFilename,
  slugify,
  totalSeconds,
  wordCount,
  type ExportResult,
  type ExportScriptInput,
  type ExportSection,
} from "./types";

/**
 * Dispatch a script export. Result matches the frozen scriptContracts.export
 * output shape ({filename, mimeType, content, encoding}) so the script
 * router's export procedure can return it directly.
 */
export async function exportScript(
  input: ExportScriptInput,
  format: ExportFormat,
): Promise<ExportResult> {
  const filename = exportFilename(input, format);
  const mimeType = EXPORT_MIME_TYPES[format];
  switch (format) {
    case "txt":
      return { filename, mimeType, content: exportPlainText(input), encoding: "utf8" };
    case "md":
      return { filename, mimeType, content: exportMarkdown(input), encoding: "utf8" };
    case "teleprompter":
      return { filename, mimeType, content: exportTeleprompter(input), encoding: "utf8" };
    case "docx": {
      const buffer = await exportDocx(input);
      return { filename, mimeType, content: buffer.toString("base64"), encoding: "base64" };
    }
  }
}
