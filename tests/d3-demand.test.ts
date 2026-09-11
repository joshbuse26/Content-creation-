import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SearchProvider, WebSearchResult } from "@/lib/providers/types";
import { fixtureIdea, fixtureNicheVideo } from "@/lib/fixtures";
import { nicheVideoSchema, type Idea, type NicheVideo } from "@/lib/types/entities";
import { computeTopicDemand, demandLevel, scoreFromResults } from "@/pipelines/ideation/demand";
import { setIdeationDepsForTests } from "@/pipelines/ideation/deps";
import {
  demandByTopic,
  demandLabel,
  demandTone,
  demandTopics,
  ideaMatchesNiche,
  ideaOutlierRatio,
  indexOutliers,
  ratioLabel,
} from "@/components/discovery/discovery-logic";
import { makeIdeationDeps, type B1Deps } from "./b1-helpers";

let deps: B1Deps;

beforeEach(() => {
  deps = makeIdeationDeps();
  setIdeationDepsForTests(deps);
});

afterEach(() => {
  setIdeationDepsForTests(undefined);
});

describe("scoreFromResults (pure)", () => {
  it("scores 0 for an empty result set (no demand signal)", () => {
    expect(scoreFromResults([])).toBe(0);
  });

  it("is deterministic and clamped to 1..100", () => {
    const a = scoreFromResults([{ url: "https://x/1" }, { url: "https://x/2" }]);
    const b = scoreFromResults([{ url: "https://x/1" }, { url: "https://x/2" }]);
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(1);
    expect(a).toBeLessThanOrEqual(100);
  });
});

describe("demandLevel (pure buckets)", () => {
  it("buckets by score", () => {
    expect(demandLevel(0)).toBe("low");
    expect(demandLevel(32)).toBe("low");
    expect(demandLevel(33)).toBe("moderate");
    expect(demandLevel(65)).toBe("moderate");
    expect(demandLevel(66)).toBe("high");
    expect(demandLevel(100)).toBe("high");
  });
});

describe("computeTopicDemand", () => {
  it("returns deterministic, keyless fixture signals for each topic", async () => {
    const topics = ["home espresso", "budget grinder showdown"];
    const first = await computeTopicDemand(deps, topics);
    expect(first).toHaveLength(2);
    for (const signal of first) {
      expect(signal.provider).toBe("web_search");
      expect(signal.score).toBeGreaterThanOrEqual(0);
      expect(signal.score).toBeLessThanOrEqual(100);
      expect(["low", "moderate", "high"]).toContain(signal.level);
      expect(signal.level).toBe(demandLevel(signal.score));
    }

    // Same input on a fresh, zero-env deps ⇒ identical output (deterministic).
    const freshDeps = makeIdeationDeps();
    const second = await computeTopicDemand(freshDeps, topics);
    expect(second).toEqual(first);
  });

  it("dedupes topics by normalized form", async () => {
    const signals = await computeTopicDemand(deps, ["Home Espresso", "home espresso!!"]);
    expect(signals).toHaveLength(1);
  });

  it("degrades a failing provider read to a zero signal (surface stays up)", async () => {
    const flaky: SearchProvider = {
      search(): Promise<WebSearchResult[]> {
        return Promise.reject(new Error("provider down"));
      },
    };
    const flakyDeps = makeIdeationDeps({ search: flaky });
    const signals = await computeTopicDemand(flakyDeps, ["anything"]);
    expect(signals).toEqual([
      { topic: "anything", score: 0, level: "low", sampleCount: 0, provider: "web_search" },
    ]);
  });

  it("caches per normalized topic (a repeat read costs no provider call)", async () => {
    let calls = 0;
    const counting: SearchProvider = {
      search(query, count): Promise<WebSearchResult[]> {
        calls += 1;
        return Promise.resolve(
          Array.from({ length: Math.min(count, 8) }, (_, i) => ({
            url: `https://ex/${query}/${i}`,
            title: `${query} ${i}`,
            snippet: "s",
          })),
        );
      },
    };
    const countingDeps = makeIdeationDeps({ search: counting });
    await computeTopicDemand(countingDeps, ["topic-a"]);
    await computeTopicDemand(countingDeps, ["topic-a"]);
    expect(calls).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Discovery surface pure logic
// ---------------------------------------------------------------------------

function outlier(overrides: Partial<NicheVideo>): NicheVideo {
  return nicheVideoSchema.parse({ ...fixtureNicheVideo, ...overrides });
}

function idea(overrides: Partial<Idea>): Idea {
  return { ...fixtureIdea, ...overrides };
}

describe("discovery-logic", () => {
  it("enriches an idea with its strongest evidence outlier ratio", () => {
    const outliers = [
      outlier({ youtubeVideoId: "v1", outlierRatio: 4.2, nicheKeywords: ["coffee gear"] }),
      outlier({ youtubeVideoId: "v2", outlierRatio: 9.9, nicheKeywords: ["home espresso"] }),
    ];
    const index = indexOutliers(outliers);
    expect(ideaOutlierRatio(idea({ evidenceVideoIds: ["v1", "v2"] }), index)).toBe(9.9);
    expect(ideaOutlierRatio(idea({ evidenceVideoIds: ["unknown"] }), index)).toBeNull();
  });

  it("filters ideas by niche via their evidence outliers", () => {
    const index = indexOutliers([
      outlier({ youtubeVideoId: "v1", nicheKeywords: ["coffee gear"] }),
    ]);
    const withEvidence = idea({ evidenceVideoIds: ["v1"] });
    expect(ideaMatchesNiche(withEvidence, null, index)).toBe(true);
    expect(ideaMatchesNiche(withEvidence, "coffee gear", index)).toBe(true);
    expect(ideaMatchesNiche(withEvidence, "latte art", index)).toBe(false);
  });

  it("dedupes demand topics and maps signals by topic", () => {
    const topics = demandTopics([idea({ title: "A" }), idea({ title: "A" }), idea({ title: "B" })]);
    expect(topics).toEqual(["A", "B"]);
    const map = demandByTopic([
      { topic: "A", score: 80, level: "high", sampleCount: 8, provider: "web_search" },
    ]);
    expect(map.get("A")?.score).toBe(80);
    expect(map.get("B")).toBeUndefined();
  });

  it("labels and tones present without throwing", () => {
    expect(ratioLabel(10.84)).toContain("×");
    expect(demandLabel("high")).toMatch(/demand/i);
    expect(demandTone("low")).toBe("neutral");
    expect(demandTone("high")).toBe("emerald");
  });
});
