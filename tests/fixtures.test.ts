import { describe, expect, it } from "vitest";
import * as fixtures from "@/lib/fixtures";
import { workspaceIdSchema } from "@/lib/types/ids";

/**
 * The fixtures module parses every fixture through its frozen entity schema
 * at import time — importing it at all is the main assertion. These checks
 * pin a few invariants wave-2 agents rely on.
 */
describe("fixtures", () => {
  it("all fixture entities parsed against their schemas at import", () => {
    expect(fixtures.fixtureWorkspace.plan).toBe("starter");
    expect(fixtures.fixtureSections).toHaveLength(6);
    expect(fixtures.fixtureQualityReport.passed).toBe(true);
  });

  it("fixture IDs are valid UUIDs", () => {
    for (const id of Object.values(fixtures.FIXTURE_IDS)) {
      expect(workspaceIdSchema.safeParse(id).success).toBe(true);
    }
  });

  it("sections are ordered by position, hook first", () => {
    const positions = fixtures.fixtureSections.map((s) => s.position);
    expect(positions).toEqual([0, 1, 2, 3, 4, 5]);
    expect(fixtures.fixtureSections[0]?.kind).toBe("hook");
  });

  it("chapter timestamps are cumulative and start at 0", () => {
    const ts = fixtures.fixtureChapterSet.entries.map((e) => e.tsSeconds);
    expect(ts[0]).toBe(0);
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
  });
});
