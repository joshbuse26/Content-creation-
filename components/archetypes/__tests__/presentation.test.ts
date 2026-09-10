import { describe, expect, it } from "vitest";
import { ARCHETYPE_SEEDS } from "@/lib/archetypes";
import { displayCopy, isPlaceholderCopy, PLACEHOLDER_COPY, paceLabel } from "../presentation";

describe("displayCopy (seed-copy markers)", () => {
  it("strips the TODO(seed-copy) prefix from working copy", () => {
    expect(displayCopy("TODO(seed-copy): Big bets, real consequences.")).toBe(
      "Big bets, real consequences.",
    );
  });

  it("renders a bare marker as generic placeholder copy — never the marker", () => {
    expect(displayCopy("TODO(seed-copy)")).toBe(PLACEHOLDER_COPY);
    expect(displayCopy("TODO(seed-copy):  ")).toBe(PLACEHOLDER_COPY);
    expect(isPlaceholderCopy("TODO(seed-copy)")).toBe(true);
  });

  it("leaves final copy untouched", () => {
    expect(displayCopy("Complicated things made clear.")).toBe("Complicated things made clear.");
  });

  it("never leaks the marker for any seeded archetype's pitch or snippets", () => {
    for (const a of ARCHETYPE_SEEDS) {
      expect(displayCopy(a.pitch)).not.toContain("TODO(seed-copy)");
      for (const snippet of a.styleCard.exampleSnippets) {
        expect(displayCopy(snippet)).not.toContain("TODO(seed-copy)");
      }
    }
  });
});

describe("paceLabel", () => {
  it("buckets words-per-minute targets", () => {
    expect(paceLabel(110)).toBe("Unhurried");
    expect(paceLabel(140)).toBe("Steady");
    expect(paceLabel(165)).toBe("Brisk");
    expect(paceLabel(200)).toBe("Rapid-fire");
  });
});
