import { describe, expect, it } from "vitest";
import {
  analyzeSimilarity,
  buildSourceNgramSet,
  exceedsSimilarity,
  guardSection,
  LicensedSimilarityError,
  ngrams,
  tokenizeWords,
} from "@/lib/similarity-guard";
import {
  effectiveSectionStyleCard,
  licensedGuardProfile,
  licensedSourceCorpus,
} from "@/lib/multi-voice";
import { fixtureVoiceProfile } from "@/lib/fixtures";
import { voiceProfileSchema, type StyleCard, type VoiceProfile } from "@/lib/types/entities";
import { voiceProfileIdSchema } from "@/lib/types/ids";
import { randomUUID } from "node:crypto";

/**
 * Licensed-voice similarity guard (PRODUCT-CONTRACTS §7) — the pure gate math
 * and its auto-rewrite-once / hard-fail orchestration, plus the multi-voice
 * resolution helpers. This is the non-negotiable gate: over-similar text is
 * never returned.
 */

const words = (n: number, seed: string): string =>
  Array.from({ length: n }, (_, i) => `${seed}${i}`).join(" ");

/** A 40-word "licensed passage": 36 distinct 5-grams, none in the filler. */
const SRC = words(40, "lic");

describe("tokenize + ngrams", () => {
  it("lowercases and drops punctuation", () => {
    expect(tokenizeWords("Hello, WORLD! It's 2026.")).toEqual([
      "hello",
      "world",
      "it",
      "s",
      "2026",
    ]);
  });

  it("produces contiguous n-grams; too-short input yields none", () => {
    expect(ngrams(["a", "b", "c", "d", "e", "f"], 5)).toEqual(["a b c d e", "b c d e f"]);
    expect(ngrams(["a", "b", "c"], 5)).toEqual([]);
  });

  it("source set unions per-snippet 5-grams, never across boundaries", () => {
    const set = buildSourceNgramSet(["one two three four five", "six seven eight nine ten"], 5);
    expect(set.has("one two three four five")).toBe(true);
    expect(set.has("six seven eight nine ten")).toBe(true);
    // No cross-snippet gram (…five six seven…).
    expect(set.has("three four five six seven")).toBe(false);
  });
});

describe("analyzeSimilarity", () => {
  it("verbatim text overlaps ~fully", () => {
    const passage = "the crema settles into a tiger stripe pattern across the surface";
    const report = analyzeSimilarity(passage, [passage]);
    expect(report.maxOverlap).toBe(1);
    expect(report.matchedNgrams.length).toBeGreaterThan(0);
  });

  it("disjoint text overlaps 0", () => {
    const report = analyzeSimilarity(words(120, "out"), [words(40, "src")]);
    expect(report.maxOverlap).toBe(0);
  });

  it("a verbatim passage embedded in unique filler pushes a window over the line", () => {
    const output = `${words(30, "z")} ${SRC} ${words(30, "q")}`;
    const report = analyzeSimilarity(output, [SRC]);
    expect(report.maxOverlap).toBeGreaterThan(0.08);
  });

  it("empty source or too-short output cannot fire", () => {
    expect(analyzeSimilarity("some text here at all", []).maxOverlap).toBe(0);
    expect(analyzeSimilarity("one two three four", ["one two three four"]).maxOverlap).toBe(0);
  });

  it("long output is covered by multiple sliding windows", () => {
    const report = analyzeSimilarity(words(500, "w"), [words(10, "s")]);
    expect(report.windowCount).toBeGreaterThan(1);
  });
});

describe("exceedsSimilarity", () => {
  it("is strict: exactly at the threshold does not exceed", () => {
    expect(
      exceedsSimilarity(
        { maxOverlap: 0.08, windowCount: 1, worstWindowStart: 0, matchedNgrams: [] },
        0.08,
      ),
    ).toBe(false);
    expect(
      exceedsSimilarity(
        { maxOverlap: 0.081, windowCount: 1, worstWindowStart: 0, matchedNgrams: [] },
        0.08,
      ),
    ).toBe(true);
  });
});

describe("guardSection orchestration", () => {
  const overSimilar = `${words(30, "a")} ${SRC} ${words(30, "b")}`;

  it("clean: below threshold returns the original body, never rewrites", async () => {
    let rewrites = 0;
    const outcome = await guardSection({
      body: words(120, "unique"),
      sources: [SRC],
      threshold: 0.08,
      rewrite: (b) => {
        rewrites += 1;
        return Promise.resolve(b);
      },
    });
    expect(outcome.status).toBe("clean");
    expect(outcome.after).toBeNull();
    expect(rewrites).toBe(0);
  });

  it("rewrite-then-pass: over threshold, a rewrite that de-dupes passes", async () => {
    const outcome = await guardSection({
      body: overSimilar,
      sources: [SRC],
      threshold: 0.08,
      // A rewrite that removes the borrowed passage entirely.
      rewrite: () => Promise.resolve(words(120, "clean")),
    });
    expect(outcome.status).toBe("rewritten");
    expect(outcome.after?.maxOverlap).toBeLessThanOrEqual(0.08);
  });

  it("hard-fail: a rewrite still over the line throws and never returns text", async () => {
    await expect(
      guardSection({
        body: overSimilar,
        sources: [SRC],
        threshold: 0.08,
        // Identity rewrite — does nothing, so it is still over.
        rewrite: (b) => Promise.resolve(b),
      }),
    ).rejects.toBeInstanceOf(LicensedSimilarityError);
  });
});

// ---------------------------------------------------------------------------
// Multi-voice resolution helpers
// ---------------------------------------------------------------------------

function licensedProfile(snippets: string[]): VoiceProfile {
  const card: StyleCard = {
    ...fixtureVoiceProfile.styleCard,
    exampleSnippets: snippets.slice(0, 4),
  };
  return voiceProfileSchema.parse({
    ...fixtureVoiceProfile,
    id: voiceProfileIdSchema.parse(randomUUID()),
    name: "Licensed source",
    source: "licensed",
    styleCard: card,
    licenseDocUrl: "https://example.com/license.pdf",
    licenseSignedAt: new Date("2026-01-01T00:00:00.000Z"),
  });
}

describe("multi-voice resolution", () => {
  const scriptCard = fixtureVoiceProfile.styleCard;

  it("effective section card: override wins, else script card, else null", () => {
    const override = licensedProfile(["a b c d e f"]);
    expect(effectiveSectionStyleCard(override, scriptCard)).toBe(override.styleCard);
    expect(effectiveSectionStyleCard(null, scriptCard)).toBe(scriptCard);
    expect(effectiveSectionStyleCard(null, null)).toBeNull();
  });

  it("licensed guard profile: a non-licensed override LIFTS the guard for its section", () => {
    const licensed = licensedProfile(["a b c d e f"]);
    const ownChannel: VoiceProfile = { ...fixtureVoiceProfile };
    // script-level licensed, section overridden to a non-licensed voice → no guard.
    expect(licensedGuardProfile(ownChannel, licensed)).toBeNull();
    // section overridden to a licensed voice → guard that section.
    expect(licensedGuardProfile(licensed, ownChannel)).toBe(licensed);
    // script-level licensed, no override → guard.
    expect(licensedGuardProfile(null, licensed)).toBe(licensed);
    // neither licensed → no guard.
    expect(licensedGuardProfile(null, ownChannel)).toBeNull();
  });

  it("licensed source corpus drops blank snippets", () => {
    const p = licensedProfile(["real snippet here", "   ", ""]);
    expect(licensedSourceCorpus(p)).toEqual(["real snippet here"]);
  });
});
