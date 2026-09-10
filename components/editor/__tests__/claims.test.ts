import { describe, expect, it } from "vitest";
import { researchDocIdSchema } from "@/lib/types/ids";
import { highlightClaims } from "../logic/claims";

const docId = researchDocIdSchema.parse("00000000-0000-4000-8000-000000000031");

describe("highlightClaims", () => {
  it("returns one plain segment when there are no unsupported claims", () => {
    const res = highlightClaims("All good here.", [{ claim: "All good", researchDocId: docId }]);
    expect(res.segments).toEqual([{ text: "All good here.", unsupported: false }]);
    expect(res.unmatchedUnsupported).toEqual([]);
  });

  it("marks the unsupported claim's span, case-insensitively", () => {
    const body = "Espresso boils at exactly 91 degrees, which is why crema forms.";
    const res = highlightClaims(body, [
      { claim: "espresso boils at exactly 91 degrees", researchDocId: null },
    ]);
    expect(res.segments.map((s) => [s.text, s.unsupported])).toEqual([
      ["Espresso boils at exactly 91 degrees", true],
      [", which is why crema forms.", false],
    ]);
  });

  it("reports unsupported claims that don't appear verbatim as unmatched", () => {
    const res = highlightClaims("Totally different text.", [
      { claim: "grinders outperform machines", researchDocId: null },
    ]);
    expect(res.segments).toEqual([{ text: "Totally different text.", unsupported: false }]);
    expect(res.unmatchedUnsupported).toEqual(["grinders outperform machines"]);
  });

  it("merges overlapping unsupported spans", () => {
    const body = "the cheap grinder wins every test";
    const res = highlightClaims(body, [
      { claim: "cheap grinder wins", researchDocId: null },
      { claim: "grinder wins every test", researchDocId: null },
    ]);
    const marked = res.segments.filter((s) => s.unsupported);
    expect(marked).toHaveLength(1);
    expect(marked[0]?.text).toBe("cheap grinder wins every test");
  });
});
