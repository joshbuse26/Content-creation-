import { describe, expect, it } from "vitest";
import { fixtureIdea } from "@/lib/fixtures";
import { ideaSchema, type Idea } from "@/lib/types/entities";
import {
  applyStatusChange,
  canChangeStatus,
  filterToStatus,
  groupByDay,
  matchesFilter,
  scoreTone,
  youtubeWatchUrl,
} from "@/components/ideas/feed-logic";

function idea(overrides: Partial<Idea>): Idea {
  return ideaSchema.parse({ ...fixtureIdea, id: crypto.randomUUID(), ...overrides });
}

describe("youtubeWatchUrl", () => {
  it("builds a canonical watch URL (metadata + URLs only, never media)", () => {
    expect(youtubeWatchUrl("dQfixture001")).toBe("https://www.youtube.com/watch?v=dQfixture001");
  });

  it("escapes hostile ids", () => {
    expect(youtubeWatchUrl("a&b=c")).toBe("https://www.youtube.com/watch?v=a%26b%3Dc");
  });
});

describe("filterToStatus", () => {
  it("maps tabs to server-side status filters", () => {
    expect(filterToStatus("new")).toBe("new");
    expect(filterToStatus("saved")).toBe("saved");
    expect(filterToStatus("all")).toBeUndefined();
  });
});

describe("applyStatusChange", () => {
  it("flips exactly the targeted idea", () => {
    const a = idea({});
    const b = idea({});
    const next = applyStatusChange([a, b], a.id, "saved");
    expect(next.find((i) => i.id === a.id)?.status).toBe("saved");
    expect(next.find((i) => i.id === b.id)?.status).toBe("new");
  });

  it("is a no-op for unknown ids", () => {
    const a = idea({});
    expect(applyStatusChange([a], "missing", "dismissed")).toEqual([a]);
  });
});

describe("matchesFilter / canChangeStatus", () => {
  it("a dismissed idea leaves the new tab, stays in all", () => {
    expect(matchesFilter("dismissed", "new")).toBe(false);
    expect(matchesFilter("dismissed", "all")).toBe(true);
  });

  it("promoted ideas are terminal", () => {
    expect(canChangeStatus("promoted")).toBe(false);
    expect(canChangeStatus("new")).toBe(true);
    expect(canChangeStatus("saved")).toBe(true);
  });
});

describe("scoreTone", () => {
  it("bands scores for the badge", () => {
    expect(scoreTone(95)).toBe("emerald");
    expect(scoreTone(80)).toBe("emerald");
    expect(scoreTone(79)).toBe("blue");
    expect(scoreTone(59)).toBe("yellow");
    expect(scoreTone(10)).toBe("neutral");
  });
});

describe("groupByDay", () => {
  it("groups by generatedOn, newest day first, preserving in-day order", () => {
    const d1a = idea({ generatedOn: "2026-09-08" });
    const d1b = idea({ generatedOn: "2026-09-08" });
    const d2 = idea({ generatedOn: "2026-09-10" });
    const groups = groupByDay([d1a, d2, d1b]);
    expect(groups.map((g) => g.day)).toEqual(["2026-09-10", "2026-09-08"]);
    expect(groups[1]?.ideas.map((i) => i.id)).toEqual([d1a.id, d1b.id]);
  });

  it("handles the empty feed", () => {
    expect(groupByDay([])).toEqual([]);
  });
});
