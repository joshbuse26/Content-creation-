import { describe, expect, it } from "vitest";
import {
  fixtureFrame,
  fixtureProject,
  fixtureResearchDoc,
  fixtureVoiceProfile,
} from "@/lib/fixtures";
import {
  extractPdfText,
  isPdf,
  naivePdfText,
  PDF_MAX_BYTES,
  type PdfError,
} from "@/lib/research/pdf";
import { runScriptPipeline } from "@/pipelines/script/pipeline";
import { savePdfUpload, UploadCapError } from "@/pipelines/research/upload";
import { workspaceIdSchema } from "@/lib/types/ids";
import { fixtureCtx, makeDeps } from "./a2-helpers";

// NOTE: the POST /api/research-upload route's auth + tenancy (session →
// assertAccess research:create → project row-level 404) mirror the trusted
// thumbnail-image route verbatim; the route is typechecked and built but not
// imported here (importing a next-auth-backed route breaks vitest's node ESM
// resolver, same as every other session-backed route in this suite).
// Tenancy/validation are covered below at the savePdfUpload + store layer.

/**
 * E1: binary PDF research upload (WAVE-D-PLAN §3 D4). Deterministic, keyless:
 * a no-dep PDF builder + the naive extractor exercise the whole path without
 * the pdf-parse binary, and citations from a PDF-sourced doc survive into a
 * drafted script exactly like paste/url research.
 */

/** Build a minimal, valid, UNCOMPRESSED PDF whose content stream shows `lines`. */
function buildTextPdf(lines: string[]): Uint8Array {
  const showOps = lines
    .map((l, i) => `${i === 0 ? "72 720 Td" : "0 -16 Td"}\n(${l.replace(/([()\\])/g, "\\$1")}) Tj`)
    .join("\n");
  const content = `BT\n/F1 12 Tf\n${showOps}\nET\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  objects.forEach((o, i) => {
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  body += "trailer << /Root 1 0 R /Size 6 >>\n%%EOF";
  return new Uint8Array(Buffer.from(body, "latin1"));
}

describe("PDF extraction seam (no-dep / fixture path)", () => {
  it("recognizes the %PDF- magic number", () => {
    expect(isPdf(buildTextPdf(["hello"]))).toBe(true);
    expect(isPdf(new Uint8Array(Buffer.from("just some text", "utf8")))).toBe(false);
    expect(isPdf(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false); // PNG
  });

  it("deterministically extracts text from an uncompressed PDF", async () => {
    const pdf = buildTextPdf(["The cheap grinder held its own.", "Numbers barely moved."]);
    const first = await extractPdfText(pdf, { mode: "fixture" });
    const second = await extractPdfText(pdf, { mode: "fixture" });
    expect(first.text).toContain("The cheap grinder held its own.");
    expect(first.text).toContain("Numbers barely moved.");
    expect(first.text).toEqual(second.text); // deterministic
    // naivePdfText agrees with the guarded entry point.
    expect(naivePdfText(pdf)).toContain("The cheap grinder held its own.");
  });

  it("rejects a non-PDF payload (magic-number guard)", async () => {
    const notPdf = new Uint8Array(Buffer.from("# Markdown notes, not a PDF", "utf8"));
    await expect(extractPdfText(notPdf, { mode: "fixture" })).rejects.toMatchObject({
      name: "PdfError",
      code: "not_pdf",
    });
  });

  it("enforces the size cap before parsing", async () => {
    const pdf = buildTextPdf(["x"]);
    await expect(extractPdfText(pdf, { mode: "fixture", maxBytes: 10 })).rejects.toMatchObject({
      code: "too_large",
    });
    expect(PDF_MAX_BYTES).toBeGreaterThan(0);
  });

  it("rejects a PDF with no extractable text (scanned/image-only)", async () => {
    // Valid %PDF- header but no text-show operators.
    const imageOnly = new Uint8Array(
      Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF", "latin1"),
    );
    await expect(extractPdfText(imageOnly, { mode: "fixture" })).rejects.toMatchObject({
      code: "empty",
    });
  });

  it("never hangs: a pathological extractor is cut off by the timeout", async () => {
    const pdf = buildTextPdf(["hi"]);
    const hung = await extractPdfText(pdf, {
      timeoutMs: 20,
      extractor: () => new Promise<string>(() => {}), // never resolves
    }).then(
      () => "resolved",
      (err: unknown) => (err as PdfError).code,
    );
    expect(hung).toBe("timeout");
  });
});

describe("savePdfUpload — same storage, caps and attribution as paste/url", () => {
  it("stores extracted text as a kind:upload doc attributed to the filename", async () => {
    const deps = makeDeps();
    const pdf = buildTextPdf([
      "Lab tests measured the $200 grinder keeping 94 percent of flavor clarity.",
    ]);
    const doc = await savePdfUpload(deps, {
      workspaceId: fixtureCtx.workspaceId,
      projectId: fixtureProject.id,
      filename: "bench-notes.pdf",
      bytes: pdf,
    });
    expect(doc.kind).toBe("upload");
    expect(doc.title).toBe("bench-notes.pdf"); // per-fact source attribution
    expect(doc.sourceUrl).toBeNull();
    expect(doc.content).toContain("94 percent");
    expect(doc.wordCount).toBeGreaterThan(5);
    // No credit charged — identical to the text-upload path.
    expect(deps.store.creditEntries).toEqual([]);
  });

  it("enforces the per-plan word cap", async () => {
    const deps = makeDeps();
    deps.store.setPlan(fixtureCtx.workspaceId, "free");
    const bigLine = Array.from({ length: 5_100 }, (_, i) => `word${i}`).join(" ");
    await expect(
      savePdfUpload(deps, {
        workspaceId: fixtureCtx.workspaceId,
        projectId: fixtureProject.id,
        filename: "huge.pdf",
        bytes: buildTextPdf([bigLine]),
      }),
    ).rejects.toThrow(UploadCapError);
  });

  it("is tenancy-isolated: the doc lives only in its own workspace", async () => {
    const deps = makeDeps();
    const doc = await savePdfUpload(deps, {
      workspaceId: fixtureCtx.workspaceId,
      projectId: fixtureProject.id,
      filename: "private.pdf",
      bytes: buildTextPdf(["private workspace research"]),
    });
    const mine = await deps.store.listResearchDocs(fixtureCtx.workspaceId, fixtureProject.id);
    expect(mine.some((d) => d.id === doc.id)).toBe(true);
    // A foreign workspace cannot read the doc back (row-level scoping) — this
    // is exactly what the upload route's project row-check enforces (→ 404).
    const foreignWorkspace = workspaceIdSchema.parse("00000000-0000-4000-8000-0000000000ff");
    expect(await deps.store.getResearchDoc(foreignWorkspace, doc.id)).toBeNull();
  });
});

describe("PDF citations survive into a drafted script", () => {
  it("a PDF-sourced doc is cited in the final script's factRefs", async () => {
    const deps = makeDeps();
    // Attach a PDF research doc whose lead sentence is a citeable claim.
    const pdf = buildTextPdf([
      "Independent lab tests measured the $200 grinder retaining 94 percent of the flavor clarity of the $2,000 setup.",
    ]);
    const pdfDoc = await savePdfUpload(deps, {
      workspaceId: fixtureCtx.workspaceId,
      projectId: fixtureProject.id,
      filename: "blind-test-lab-notes.pdf",
      bytes: pdf,
    });

    const script = await deps.store.createScript({
      workspaceId: fixtureCtx.workspaceId,
      projectId: fixtureProject.id,
      voiceProfileId: fixtureVoiceProfile.id,
    });
    const result = await runScriptPipeline(deps, {
      input: {
        workspaceId: fixtureCtx.workspaceId,
        projectId: fixtureProject.id,
        frameId: fixtureFrame.id,
        voiceProfileId: fixtureVoiceProfile.id,
        generation: null,
      },
      scriptId: script.id,
      actorUserId: fixtureCtx.userId,
    });
    expect(result.status).toBe("done");

    const sections = await deps.store.listSections(fixtureCtx.workspaceId, script.id);
    const refs = sections.flatMap((s) => s.factRefs);
    // The PDF doc participates in fact-check exactly like the seeded web doc.
    const citedIds = new Set(refs.map((r) => r.researchDocId));
    expect(citedIds.has(pdfDoc.id) || citedIds.has(fixtureResearchDoc.id)).toBe(true);
    expect(refs.some((r) => r.researchDocId === pdfDoc.id)).toBe(true);
  });
});
