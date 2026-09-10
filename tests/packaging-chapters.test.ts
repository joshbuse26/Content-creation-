import { describe, expect, it } from "vitest";
import {
  deriveChapters,
  formatTimestamp,
  renderChapterList,
  type ChapterSourceSection,
} from "@/pipelines/packaging/chapters";

const section = (
  heading: string,
  estSeconds: number,
  kind: ChapterSourceSection["kind"] = "chapter",
): ChapterSourceSection => ({ kind, heading, estSeconds });

describe("formatTimestamp", () => {
  it("renders mm:ss under an hour", () => {
    expect(formatTimestamp(0)).toBe("0:00");
    expect(formatTimestamp(7)).toBe("0:07");
    expect(formatTimestamp(65)).toBe("1:05");
    expect(formatTimestamp(600)).toBe("10:00");
    expect(formatTimestamp(3599)).toBe("59:59");
  });

  it("renders h:mm:ss at an hour and beyond", () => {
    expect(formatTimestamp(3600)).toBe("1:00:00");
    expect(formatTimestamp(3661)).toBe("1:01:01");
    expect(formatTimestamp(7325)).toBe("2:02:05");
  });

  it("clamps negatives and floors fractions", () => {
    expect(formatTimestamp(-5)).toBe("0:00");
    expect(formatTimestamp(61.9)).toBe("1:01");
  });
});

describe("deriveChapters", () => {
  it("cumulates est_seconds: each chapter starts where the previous ended", () => {
    const entries = deriveChapters([
      section("Hook", 22, "hook"),
      section("Rules", 45, "intro"),
      section("Build", 180),
      section("Taste-off", 300),
    ]);
    expect(entries).toEqual([
      { tsSeconds: 0, label: "Hook" },
      { tsSeconds: 22, label: "Rules" },
      { tsSeconds: 67, label: "Build" },
      { tsSeconds: 247, label: "Taste-off" },
    ]);
  });

  it("always emits the first entry at 0:00 regardless of kind or length", () => {
    const entries = deriveChapters([section("Tiny hook", 3, "hook"), section("Main", 120)]);
    expect(entries[0]).toEqual({ tsSeconds: 0, label: "Tiny hook" });
  });

  it("folds sections shorter than the minimum into the preceding chapter", () => {
    const entries = deriveChapters([
      section("Intro", 60, "intro"),
      section("Bumper", 5),
      section("Main", 300),
    ]);
    // "Bumper" gets no entry but its 5s still advance the clock.
    expect(entries).toEqual([
      { tsSeconds: 0, label: "Intro" },
      { tsSeconds: 65, label: "Main" },
    ]);
  });

  it("respects excludeKinds while keeping the timeline intact", () => {
    const entries = deriveChapters(
      [
        section("Hook", 20, "hook"),
        section("Main", 200),
        section("CTA", 25, "cta"),
        section("Outro", 15, "outro"),
      ],
      { excludeKinds: ["cta", "outro"] },
    );
    expect(entries).toEqual([
      { tsSeconds: 0, label: "Hook" },
      { tsSeconds: 20, label: "Main" },
    ]);
  });

  it("handles empty input and zero-length sections", () => {
    expect(deriveChapters([])).toEqual([]);
    const entries = deriveChapters([section("A", 0), section("B", 90)]);
    expect(entries).toEqual([
      { tsSeconds: 0, label: "A" },
      { tsSeconds: 0, label: "B" },
    ]);
  });

  it("falls back to the kind when a heading is blank", () => {
    const entries = deriveChapters([section("   ", 30, "intro")]);
    expect(entries).toEqual([{ tsSeconds: 0, label: "intro" }]);
  });
});

describe("renderChapterList", () => {
  it("renders the copy-pastable YouTube block", () => {
    const text = renderChapterList([
      { tsSeconds: 0, label: "The bet" },
      { tsSeconds: 67, label: "Building the $200 stack" },
      { tsSeconds: 3672, label: "Bonus hour" },
    ]);
    expect(text).toBe("0:00 The bet\n1:07 Building the $200 stack\n1:01:12 Bonus hour");
  });
});
