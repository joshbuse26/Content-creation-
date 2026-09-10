import type { ExportFormat, SectionKind } from "@/lib/types/enums";

/**
 * Script export — pure functions from a script+sections input to the four
 * supported formats (spec: txt / md / docx / teleprompter). No DB access:
 * callers assemble ExportScriptInput and get back deterministic output.
 */

export interface ExportSection {
  kind: SectionKind;
  heading: string;
  body: string;
  estSeconds: number;
  retentionNote?: string | null;
}

export interface ExportScriptInput {
  /** Project / working video title. */
  title: string;
  version: number;
  sections: ExportSection[];
}

/** Matches the frozen scriptContracts.export output shape. */
export interface ExportResult {
  filename: string;
  mimeType: string;
  /** utf-8 text, or base64 for binary (docx). */
  content: string;
  encoding: "utf8" | "base64";
}

export const EXPORT_MIME_TYPES: Record<ExportFormat, string> = {
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  teleprompter: "text/plain; charset=utf-8",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
  return slug === "" ? "script" : slug;
}

export function exportFilename(input: ExportScriptInput, format: ExportFormat): string {
  const base = `${slugify(input.title)}-v${input.version}`;
  switch (format) {
    case "txt":
      return `${base}.txt`;
    case "md":
      return `${base}.md`;
    case "teleprompter":
      return `${base}.teleprompter.txt`;
    case "docx":
      return `${base}.docx`;
  }
}

export function totalSeconds(input: ExportScriptInput): number {
  return input.sections.reduce((sum, s) => sum + Math.max(0, s.estSeconds), 0);
}

export function wordCount(input: ExportScriptInput): number {
  return input.sections
    .map((s) => s.body.split(/\s+/).filter((w) => w !== "").length)
    .reduce((a, b) => a + b, 0);
}
