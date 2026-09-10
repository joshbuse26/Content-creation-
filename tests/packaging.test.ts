import { describe, expect, it } from "vitest";
import { createFixtureProviders } from "@/lib/providers/fixture";
import { generatedTagsSchema } from "@/lib/types/pipeline";
import {
  buildThumbnailBrief,
  deterministicTags,
  extractTagArray,
  fillDescriptionTemplate,
  fixturePackagingContext,
  generateDescriptionBody,
  generateTagList,
  normalizeTags,
  TAG_MAX,
  TAG_MIN,
} from "@/pipelines/packaging";

/** The whole packaging pipeline must work with zero env (fixture providers). */
const { llm } = createFixtureProviders();
const ctx = fixturePackagingContext();

describe("tags", () => {
  it("normalizes: trims, lowercases, strips #, dedupes, drops overlong", () => {
    expect(
      normalizeTags(["  Coffee  Gear ", "#espresso", "coffee gear", "x", "a".repeat(61)]),
    ).toEqual(["coffee gear", "espresso"]);
  });

  it("extracts a JSON array from surrounding prose, or null", () => {
    expect(extractTagArray('Here you go: ["a", "b"] hope that helps')).toEqual(["a", "b"]);
    expect(extractTagArray("no json here")).toBeNull();
    expect(extractTagArray("[1, 2]")).toBeNull(); // not strings
  });

  it("fixture mode yields a valid 15-25 tag set deterministically", async () => {
    const first = await generateTagList(llm, ctx);
    const second = await generateTagList(llm, ctx);
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThanOrEqual(TAG_MIN);
    expect(first.length).toBeLessThanOrEqual(TAG_MAX);
    expect(() => generatedTagsSchema.parse({ tags: first })).not.toThrow();
    // Grounded in the frame/niche keywords, not invented from nothing.
    expect(first).toContain("budget espresso");
  });

  it("deterministic fallback tags come from the packaging context", () => {
    const tags = deterministicTags(ctx);
    expect(tags).toContain("home espresso");
    expect(tags.every((t) => t === t.toLowerCase())).toBe(true);
  });
});

describe("descriptions", () => {
  it("generates a non-empty body per mode in fixture mode", async () => {
    for (const mode of ["informative", "narrative", "seo"] as const) {
      const body = await generateDescriptionBody(llm, ctx, mode);
      expect(body.length).toBeGreaterThan(50);
    }
  });

  it("fills known template slots and leaves unknown slots for the user", () => {
    const filled = fillDescriptionTemplate(
      {
        name: "t",
        body: "{{summary}}\n\nChapters:\n{{chapters}}\n\nTitle: {{title}}\n\n{{gear_list}}",
      },
      ctx,
      "THE SUMMARY",
    );
    expect(filled).toContain("THE SUMMARY");
    expect(filled).toContain("0:00 Hook");
    expect(filled).toContain(`Title: ${ctx.projectTitle}`);
    expect(filled).toContain("{{gear_list}}"); // unknown slot preserved
  });
});

describe("thumbnail text briefs (no image generation in v1)", () => {
  it("builds a deterministic brief carrying pattern, subject and constraints", () => {
    const brief = buildThumbnailBrief(ctx, {
      compositionPattern: "split-screen",
      subjectDescription: "Tiny machine vs prosumer rig",
    });
    expect(brief).toContain("Composition pattern: split-screen");
    expect(brief).toContain("Tiny machine vs prosumer rig");
    expect(brief).toContain("1280x720");
    expect(brief).toContain(ctx.projectTitle);
  });

  it("falls back to generic guidance for unknown patterns", () => {
    const brief = buildThumbnailBrief(ctx, {
      compositionPattern: "something-new",
      subjectDescription: "subject",
    });
    expect(brief).toContain("Free composition");
  });
});
