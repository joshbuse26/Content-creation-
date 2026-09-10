import { describe, expect, it } from "vitest";
import {
  isDuplicateTitle,
  jaccard,
  normalizeKeywordSet,
  normalizeTitle,
  titleSimilarity,
  trigrams,
  TITLE_SIMILARITY_THRESHOLD,
} from "@/pipelines/ideation/similarity";

describe("normalizeTitle", () => {
  it("lowercases, strips punctuation and collapses whitespace", () => {
    expect(normalizeTitle("  The $200 Espresso—Setup!!  ")).toBe("the 200 espresso setup");
  });

  it("strips accents", () => {
    expect(normalizeTitle("Café Crème")).toBe("cafe creme");
  });
});

describe("normalizeKeywordSet", () => {
  it("dedupes case/order/whitespace variants into one sorted set", () => {
    expect(normalizeKeywordSet(["Coffee  Gear", "home espresso", "coffee gear", " "])).toEqual([
      "coffee gear",
      "home espresso",
    ]);
  });
});

describe("trigram jaccard", () => {
  it("identical strings score 1", () => {
    const grams = trigrams("budget espresso");
    expect(jaccard(grams, grams)).toBe(1);
  });

  it("disjoint strings score 0", () => {
    expect(jaccard(trigrams("aaaa"), trigrams("zzzz"))).toBe(0);
  });

  it("both empty counts as identical", () => {
    expect(jaccard(trigrams(""), trigrams(""))).toBe(1);
  });
});

describe("isDuplicateTitle (spec §5.4 dedup)", () => {
  it("flags near-identical titles at the 0.6 threshold", () => {
    expect(
      isDuplicateTitle("The $200 Espresso Setup That Beats a $2,000 One", [
        "The $200 espresso setup that beats a $2000 one!",
      ]),
    ).toBe(true);
  });

  it("passes clearly different titles", () => {
    expect(
      isDuplicateTitle("Why Your Latte Art Never Works", [
        "The $200 Espresso Setup That Beats a $2,000 One",
      ]),
    ).toBe(false);
  });

  it("uses the documented threshold", () => {
    const a = "Budget espresso grinder review";
    const b = "Budget espresso grinder revisited";
    const sim = titleSimilarity(a, b);
    expect(isDuplicateTitle(a, [b])).toBe(sim >= TITLE_SIMILARITY_THRESHOLD);
  });

  it("is empty-safe", () => {
    expect(isDuplicateTitle("anything", [])).toBe(false);
  });
});
