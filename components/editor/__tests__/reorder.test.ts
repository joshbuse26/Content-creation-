import { describe, expect, it } from "vitest";
import { moveSection, reorderSections } from "../logic/reorder";

const sections = [
  { id: "hook", position: 0 },
  { id: "intro", position: 1 },
  { id: "ch1", position: 2 },
  { id: "outro", position: 3 },
];

const order = (list: readonly { id: string; position: number }[]) =>
  [...list].sort((a, b) => a.position - b.position).map((s) => s.id);

describe("moveSection", () => {
  it("moves a section down one step and reindexes positions contiguously", () => {
    const next = moveSection(sections, "intro", 1);
    expect(order(next)).toEqual(["hook", "ch1", "intro", "outro"]);
    expect([...next].sort((a, b) => a.position - b.position).map((s) => s.position)).toEqual([
      0, 1, 2, 3,
    ]);
  });

  it("moves a section up one step", () => {
    const next = moveSection(sections, "ch1", -1);
    expect(order(next)).toEqual(["hook", "ch1", "intro", "outro"]);
  });

  it("no-ops at the edges (first up, last down) returning the same reference", () => {
    expect(moveSection(sections, "hook", -1)).toBe(sections);
    expect(moveSection(sections, "outro", 1)).toBe(sections);
  });

  it("no-ops for an unknown id", () => {
    expect(moveSection(sections, "missing", 1)).toBe(sections);
  });

  it("does not mutate the input array", () => {
    const copy = sections.map((s) => ({ ...s }));
    moveSection(sections, "intro", 1);
    expect(sections).toEqual(copy);
  });

  it("handles non-contiguous input positions", () => {
    const sparse = [
      { id: "a", position: 0 },
      { id: "b", position: 5 },
      { id: "c", position: 9 },
    ];
    const next = moveSection(sparse, "c", -1);
    expect(order(next)).toEqual(["a", "c", "b"]);
    expect([...next].sort((x, y) => x.position - y.position).map((s) => s.position)).toEqual([
      0, 1, 2,
    ]);
  });
});

describe("reorderSections", () => {
  it("moves a section from one index to another", () => {
    const next = reorderSections(sections, 0, 2);
    expect(order(next)).toEqual(["intro", "ch1", "hook", "outro"]);
  });

  it("no-ops for out-of-range or identical indices", () => {
    expect(reorderSections(sections, 1, 1)).toBe(sections);
    expect(reorderSections(sections, -1, 2)).toBe(sections);
    expect(reorderSections(sections, 0, 99)).toBe(sections);
  });
});
