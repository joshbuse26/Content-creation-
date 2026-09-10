import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { formatTimestamp } from "@/pipelines/packaging/chapters";
import { totalSeconds, wordCount, type ExportScriptInput } from "./types";

/** .docx export via the `docx` package — returns the file as a Buffer. */
export async function exportDocx(input: ExportScriptInput): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: input.title })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `Version ${input.version} · ${wordCount(input)} words · est. runtime ${formatTimestamp(totalSeconds(input))}`,
          italics: true,
          size: 20,
        }),
      ],
    }),
    new Paragraph({ children: [] }),
  ];

  let cursor = 0;
  for (const section of input.sections) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: `${formatTimestamp(cursor)} — ${section.heading}` })],
      }),
    );
    if (section.retentionNote != null && section.retentionNote !== "") {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `Retention: ${section.retentionNote}`,
              italics: true,
              color: "666666",
              size: 18,
            }),
          ],
        }),
      );
    }
    for (const paragraph of section.body.split(/\n{2,}/)) {
      const text = paragraph.trim();
      if (text === "") continue;
      children.push(
        new Paragraph({
          spacing: { after: 200 },
          children: [new TextRun({ text, size: 24 })],
        }),
      );
    }
    cursor += Math.max(0, section.estSeconds);
  }

  const doc = new Document({
    creator: "Gin Rummy",
    title: input.title,
    sections: [{ children }],
  });

  return Packer.toBuffer(doc);
}
