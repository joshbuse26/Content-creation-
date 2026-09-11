import { describe, expect, it } from "vitest";
import { FIXTURE_IDS, fixtureCoachContext, fixtureTrainedVoiceProfile } from "@/lib/fixtures";
import { buildCoachContext } from "@/lib/chat/context";
import { buildCoachSystemPrompt, COACH_PERSONA_PREAMBLE } from "@/lib/chat/persona";
import { COACH_NAME } from "@/lib/branding";
import { coachContextSchema } from "@/lib/types/chat";
import { asProjectId, asWorkspaceId } from "@/lib/types/ids";
import { makeStageDeps } from "./c1-helpers";

/**
 * Wave D (D0): buildCoachContext assembly (WAVE-D-PLAN §2b). Read-only, pure
 * over existing data, graceful nulls — the grounding the D1 persona injects.
 */

const workspaceId = asWorkspaceId(FIXTURE_IDS.workspace);

describe("buildCoachContext", () => {
  it("assembles the project's grounding bundle from existing data", async () => {
    const deps = makeStageDeps();
    const ctx = await buildCoachContext(asProjectId(FIXTURE_IDS.project), workspaceId, deps);
    expect(() => coachContextSchema.parse(ctx)).not.toThrow();
    expect(ctx.projectTitle).toBe("Budget espresso setup vs. the $2k rig");
    expect(ctx.channelTitle).toBe("Deep Dive with Casey");
    expect(ctx.nicheKeywords).toContain("home espresso");
    // Legacy (mode-less) project → the channel's voice profile card.
    expect(ctx.style.source).toBe("own_channel");
    expect(ctx.style.card).not.toBeNull();
    // Audience avatar projected in.
    expect(ctx.audience?.sophistication).toBe("intermediate");
    expect(ctx.audience?.topPains.length).toBeGreaterThan(0);
    // Research pack summarized.
    expect(ctx.research.docCount).toBe(1);
    expect(ctx.research.totalWords).toBeGreaterThan(0);
    // Unique angle + duration come from the chosen frame.
    expect(ctx.uniqueAngle).toContain("$2,000");
    expect(ctx.durationMinutes).toBe(12);
  });

  it("returns a valid, mostly-null context for a workspace-level thread", async () => {
    const deps = makeStageDeps();
    const ctx = await buildCoachContext(null, workspaceId, deps);
    expect(() => coachContextSchema.parse(ctx)).not.toThrow();
    expect(ctx.projectId).toBeNull();
    expect(ctx.style.card).toBeNull();
    expect(ctx.audience).toBeNull();
    expect(ctx.research.docCount).toBe(0);
    expect(ctx.uniqueAngle).toBeNull();
  });

  it("degrades gracefully (no throw) for an unknown project", async () => {
    const deps = makeStageDeps();
    const ctx = await buildCoachContext(
      asProjectId("00000000-0000-4000-8000-0000000000ff"),
      workspaceId,
      deps,
    );
    expect(ctx.projectId).toBeNull();
    expect(ctx.style.card).toBeNull();
  });

  it("prefers a trained card when the channel has one (first-class)", async () => {
    const deps = makeStageDeps();
    deps.engine.store.seedVoiceProfile(fixtureTrainedVoiceProfile);
    const ctx = await buildCoachContext(asProjectId(FIXTURE_IDS.project), workspaceId, deps);
    expect(ctx.style.source).toBe("trained");
  });
});

describe("Coach persona", () => {
  it("system prompt is grounded and product-native", () => {
    const prompt = buildCoachSystemPrompt(fixtureCoachContext);
    expect(prompt).toContain(COACH_NAME);
    // Grounded in the context.
    expect(prompt).toContain("Deep Dive with Casey");
    expect(prompt).toContain("$2,000");
  });

  it("NEVER names the underlying model or vendor", () => {
    const strings = [COACH_PERSONA_PREAMBLE, buildCoachSystemPrompt(fixtureCoachContext)];
    for (const s of strings) {
      expect(/grok|xai|anthropic|claude/i.test(s)).toBe(false);
    }
  });
});
