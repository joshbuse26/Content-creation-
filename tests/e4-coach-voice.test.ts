import { describe, expect, it } from "vitest";
import { COACH_PERSONA_PREAMBLE, buildCoachSystemPrompt } from "@/lib/chat/persona";
import { fixtureCoachContext } from "@/lib/fixtures";

/**
 * E4 — the Coach persona references the per-section voice override so chat can
 * steer creators to it. This is additive to the D0 persona and must not leak
 * any model/vendor name (copy-lint covers the vendor ban separately).
 */

describe("Coach persona references section voice availability", () => {
  it("the static preamble mentions the per-section voice override", () => {
    expect(COACH_PERSONA_PREAMBLE.toLowerCase()).toContain("per-section voice");
  });

  it("the assembled system prompt still carries the section-voice guidance", () => {
    const prompt = buildCoachSystemPrompt(fixtureCoachContext);
    expect(prompt.toLowerCase()).toContain("per-section voice");
    // Guardrail: never names the model or vendor.
    expect(prompt).not.toMatch(/grok|xai/i);
  });
});
