import { describe, expect, it } from "vitest";
import { fixtureProject, fixtureScript, fixtureSections } from "@/lib/fixtures";
import {
  exportDocx,
  exportMarkdown,
  exportPlainText,
  exportScript,
  exportTeleprompter,
  splitSentences,
  wrapForPrompter,
  type ExportScriptInput,
} from "@/server/export";

/** Deterministic input straight from the frozen fixtures. */
const input: ExportScriptInput = {
  title: fixtureProject.title,
  version: fixtureScript.version,
  sections: fixtureSections.map((s) => ({
    kind: s.kind,
    heading: s.heading,
    body: s.body,
    estSeconds: s.estSeconds,
    retentionNote: s.retentionNote,
  })),
};

describe("plain text export", () => {
  it("matches snapshot", () => {
    expect(exportPlainText(input)).toMatchSnapshot();
  });

  it("carries cumulative timestamps and all headings", () => {
    const text = exportPlainText(input);
    expect(text).toContain("[0:00] Hook (hook)");
    expect(text).toContain("[0:22] The rules of the test (intro)");
    expect(text).toContain("[1:07] Building the $200 stack (chapter)");
    expect(text).toContain("[4:07] The blind taste-off (chapter)");
  });
});

describe("markdown export", () => {
  it("matches snapshot", () => {
    expect(exportMarkdown(input)).toMatchSnapshot();
  });

  it("uses heading levels and retention blockquotes", () => {
    const md = exportMarkdown(input);
    expect(md).toContain(`# ${fixtureProject.title}`);
    expect(md).toContain("## 0:00 — Hook");
    expect(md).toContain("> _Retention: Open loop: which shot won stays hidden until 09:40._");
  });
});

describe("teleprompter export", () => {
  it("matches snapshot", () => {
    expect(exportTeleprompter(input)).toMatchSnapshot();
  });

  it("keeps every line inside the large-type width", () => {
    const lines = exportTeleprompter(input).split("\n");
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(38 + ">>>  <<<".length + 60); // markers may exceed body width
    }
    const bodyLines = lines.filter((l) => l !== "" && !l.startsWith(">>>"));
    for (const line of bodyLines) {
      expect(line.length).toBeLessThanOrEqual(38);
    }
  });

  it("marks section breaks loudly", () => {
    const text = exportTeleprompter(input);
    expect(text).toContain(">>> HOOK <<<");
    expect(text).toContain(">>> THE BLIND TASTE-OFF <<<");
    expect(text.trimEnd().endsWith(">>> END OF SCRIPT <<<")).toBe(true);
  });

  it("wraps and splits sentences correctly", () => {
    expect(wrapForPrompter("a b c", 3)).toEqual(["a b", "c"]);
    expect(splitSentences("One. Two! Three? Done.")).toEqual(["One.", "Two!", "Three?", "Done."]);
  });
});

describe("docx export", () => {
  it("produces a valid zip container with the Word document part", async () => {
    const buffer = await exportDocx(input);
    expect(buffer.length).toBeGreaterThan(2_000);
    // Zip magic + the OOXML main part filename appear in the container.
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(buffer.toString("latin1")).toContain("word/document.xml");
  });
});

describe("exportScript dispatcher", () => {
  it("returns the frozen contract shape for every format", async () => {
    const txt = await exportScript(input, "txt");
    expect(txt).toMatchObject({
      filename: "budget-espresso-setup-vs-the-2k-rig-v1.txt",
      mimeType: "text/plain; charset=utf-8",
      encoding: "utf8",
    });

    const md = await exportScript(input, "md");
    expect(md.filename).toBe("budget-espresso-setup-vs-the-2k-rig-v1.md");

    const tele = await exportScript(input, "teleprompter");
    expect(tele.filename).toBe("budget-espresso-setup-vs-the-2k-rig-v1.teleprompter.txt");
    expect(tele.encoding).toBe("utf8");

    const docx = await exportScript(input, "docx");
    expect(docx.filename).toBe("budget-espresso-setup-vs-the-2k-rig-v1.docx");
    expect(docx.mimeType).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(docx.encoding).toBe("base64");
    expect(Buffer.from(docx.content, "base64").subarray(0, 2).toString("latin1")).toBe("PK");
  });
});
