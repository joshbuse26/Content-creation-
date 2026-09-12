import { inflateSync } from "node:zlib";
import type { EngineMode } from "@/pipelines/script/llm-json";

/**
 * Server-side PDF text extraction behind a small seam (OPEN-ITEMS "pdf-parse"
 * open item / WAVE-D-PLAN §3 D4).
 *
 * Two extractors sit behind one entry point so the pipeline, fixture mode and
 * the test suite never depend on the native binary:
 *   - `naivePdfText` — a dependency-free extractor (Node's zlib only) that
 *     decodes FlateDecode content streams and pulls text-showing operators.
 *     Deterministic; the fixture/no-dep fallback the spec requires.
 *   - `pdfParseText` — the live path, a lazy dynamic import of `pdf-parse`
 *     (pdfjs-dist under the hood). Never imported at module load, so a build
 *     or a keyless test never pays for it; falls back to the naive extractor
 *     if the dependency is unavailable.
 *
 * Every extraction is guarded: the bytes must actually be a PDF (magic
 * number), the payload is size-capped BEFORE parsing, and the parse races a
 * hard timeout so a pathological document can never hang the request.
 */

/** 20 MB hard cap on an uploaded PDF — rejected before any parsing. */
export const PDF_MAX_BYTES = 20 * 1024 * 1024;
/** Parsing must finish within this window or the upload is rejected. */
export const PDF_PARSE_TIMEOUT_MS = 20_000;

export class PdfError extends Error {
  constructor(
    message: string,
    public readonly code: "not_pdf" | "too_large" | "timeout" | "empty" | "parse_failed",
  ) {
    super(message);
    this.name = "PdfError";
  }
}

/** True when the payload begins with the `%PDF-` signature (allowing a small
 *  leading preamble, as lenient readers do). */
export function isPdf(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 1024);
  // "%PDF-" = 0x25 0x50 0x44 0x46 0x2d
  const sig = [0x25, 0x50, 0x44, 0x46, 0x2d];
  for (let start = 0; start + sig.length <= head.length; start++) {
    let hit = true;
    for (let i = 0; i < sig.length; i++) {
      if (head[start + i] !== sig[i]) {
        hit = false;
        break;
      }
    }
    if (hit) return true;
  }
  return false;
}

/** A pluggable extractor seam (tests inject a fake; the pipeline picks one by mode). */
export type PdfExtractor = (bytes: Uint8Array) => Promise<string>;

// ---------------------------------------------------------------------------
// Naive, dependency-free extractor (fixture / fallback)
// ---------------------------------------------------------------------------

/** Decode a PDF literal string body (between parens): handle \n \r \t \( \) \\ and \ddd octal. */
function decodePdfLiteral(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === undefined) break;
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = raw[i + 1];
    if (next === undefined) break;
    if (next === "n") {
      out += "\n";
      i++;
    } else if (next === "r") {
      out += "\r";
      i++;
    } else if (next === "t") {
      out += "\t";
      i++;
    } else if (next === "b" || next === "f") {
      out += " ";
      i++;
    } else if (next === "(" || next === ")" || next === "\\") {
      out += next;
      i++;
    } else if (next >= "0" && next <= "7") {
      let oct = "";
      let j = i + 1;
      for (; j < raw.length && oct.length < 3; j++) {
        const d = raw[j];
        if (d === undefined || d < "0" || d > "7") break;
        oct += d;
      }
      out += String.fromCharCode(parseInt(oct, 8));
      i = j - 1;
    } else {
      out += next;
      i++;
    }
  }
  return out;
}

/** Pull the visible text out of one decoded content stream. */
function textFromContentStream(content: string): string {
  const parts: string[] = [];
  // Match text-showing operators: (..)Tj, (..)' , (..)" , and [ .. ]TJ arrays.
  // We simply collect every string literal that is an argument to a show op,
  // plus a newline whenever a line-positioning op (Td/TD/T*/') appears.
  const tokenRe =
    /\((?:\\.|[^\\()])*\)|\[(?:\\.|[^\]\\]|\\.)*\]|\bTd\b|\bTD\b|\bT\*\b|\bTj\b|\bTJ\b|'/g;
  let match: RegExpExecArray | null;
  let pending = "";
  while ((match = tokenRe.exec(content)) !== null) {
    const tok = match[0];
    if (tok === "Td" || tok === "TD" || tok === "T*" || tok === "'") {
      if (pending !== "") {
        parts.push(pending);
        pending = "";
      }
      parts.push("\n");
    } else if (tok === "Tj" || tok === "TJ") {
      if (pending !== "") {
        parts.push(pending);
        pending = "";
      }
    } else if (tok.startsWith("(")) {
      pending += decodePdfLiteral(tok.slice(1, -1));
    } else if (tok.startsWith("[")) {
      // TJ array: concatenate its inner literals (numeric kerning = spacing).
      const inner = tok.slice(1, -1);
      const litRe = /\((?:\\.|[^\\()])*\)/g;
      let lit: RegExpExecArray | null;
      while ((lit = litRe.exec(inner)) !== null) {
        pending += decodePdfLiteral(lit[0].slice(1, -1));
      }
    }
  }
  if (pending !== "") parts.push(pending);
  return parts.join("");
}

/**
 * Dependency-free PDF text extraction. Decodes FlateDecode streams with zlib,
 * reads uncompressed streams directly, and pulls text-show operators from
 * each. Deterministic — handles the uncompressed/flate PDFs generators emit;
 * scanned/image-only PDFs yield little text (the caller then rejects empty).
 */
export function naivePdfText(bytes: Uint8Array): string {
  const latin1 = Buffer.from(bytes).toString("latin1");
  const chunks: string[] = [];
  // Walk every `stream ... endstream` block.
  const streamRe = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = streamRe.exec(latin1)) !== null) {
    const start = m.index + m[0].length;
    const end = latin1.indexOf("endstream", start);
    if (end === -1) break;
    let bodyEnd = end;
    // Trim a trailing EOL before `endstream`.
    if (latin1[bodyEnd - 1] === "\n") bodyEnd--;
    if (latin1[bodyEnd - 1] === "\r") bodyEnd--;
    const dictStart = latin1.lastIndexOf("<<", m.index);
    const dict = dictStart === -1 ? "" : latin1.slice(dictStart, m.index);
    const rawBody = bytes.subarray(start, bodyEnd);
    let content: string | null = null;
    if (/\/FlateDecode\b/.test(dict)) {
      try {
        content = inflateSync(Buffer.from(rawBody)).toString("latin1");
      } catch {
        content = null;
      }
    } else if (!/\/(?:DCTDecode|JPXDecode|CCITTFaxDecode|JBIG2Decode|Image)\b/.test(dict)) {
      content = Buffer.from(rawBody).toString("latin1");
    }
    if (content !== null && /\b(?:Tj|TJ)\b/.test(content)) {
      chunks.push(textFromContentStream(content));
    }
    streamRe.lastIndex = end + "endstream".length;
  }
  return chunks
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Live extractor (lazy pdf-parse)
// ---------------------------------------------------------------------------

/**
 * Live extraction via `pdf-parse` (lazy import). Falls back to the naive
 * extractor if the dependency can't be loaded, so a missing/broken binary
 * degrades rather than failing the upload.
 */
export async function pdfParseText(bytes: Uint8Array): Promise<string> {
  try {
    const mod = (await import("pdf-parse")) as {
      PDFParse: new (opts: { data: Uint8Array }) => { getText(): Promise<{ text: string }> };
    };
    const parser = new mod.PDFParse({ data: bytes });
    const result = await parser.getText();
    const text = result.text.trim();
    return text !== "" ? text : naivePdfText(bytes);
  } catch {
    return naivePdfText(bytes);
  }
}

// ---------------------------------------------------------------------------
// Guarded entry point
// ---------------------------------------------------------------------------

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new PdfError("PDF parse timed out", "timeout"));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

export interface ExtractPdfOptions {
  mode?: EngineMode;
  maxBytes?: number;
  timeoutMs?: number;
  /** Test/override seam — bypasses the mode-based extractor selection. */
  extractor?: PdfExtractor;
}

/**
 * Validate + extract text from PDF bytes. Throws a typed {@link PdfError} for
 * a non-PDF payload, an over-cap payload, a parse timeout, or empty output —
 * never hangs, never returns binary. Word caps by plan are applied downstream
 * by `saveUpload`.
 */
export async function extractPdfText(
  bytes: Uint8Array,
  options: ExtractPdfOptions = {},
): Promise<{ text: string }> {
  const maxBytes = options.maxBytes ?? PDF_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? PDF_PARSE_TIMEOUT_MS;
  if (bytes.byteLength > maxBytes) {
    throw new PdfError(`PDF is ${bytes.byteLength} bytes; the cap is ${maxBytes}`, "too_large");
  }
  if (!isPdf(bytes)) {
    throw new PdfError("uploaded file is not a PDF", "not_pdf");
  }
  const extractor: PdfExtractor =
    options.extractor ??
    (options.mode === "live" ? pdfParseText : (b) => Promise.resolve(naivePdfText(b)));

  let text: string;
  try {
    text = await withTimeout(Promise.resolve(extractor(bytes)), timeoutMs);
  } catch (err) {
    if (err instanceof PdfError) throw err;
    throw new PdfError(
      `PDF parse failed: ${err instanceof Error ? err.message : String(err)}`,
      "parse_failed",
    );
  }
  const cleaned = text.trim();
  if (cleaned === "") {
    throw new PdfError("no extractable text in the PDF (scanned or image-only?)", "empty");
  }
  return { text: cleaned };
}
