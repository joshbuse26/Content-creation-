import { describe, expect, it } from "vitest";
import { fixtureAvatar, fixtureFrame, fixtureVoiceProfile } from "@/lib/fixtures";
import {
  angleKeywords,
  checkUniqueAngle,
  computeStyleGates,
  isBlankAngle,
  SET_UNIQUE_ANGLE_NUDGE,
  type ScannableSection,
} from "@/lib/style-gates";
import { assembleContext } from "@/pipelines/script/context";
import { computeQualityReport } from "@/pipelines/script/quality-gate";
import { renderAudienceAvatar, renderUniqueAngleDirective } from "@/prompts/shared";
import { hookPrompt, outlinePrompt, sectionPrompt } from "@/prompts";
import type { Outline } from "@/lib/types/pipeline";

/**
 * E1: the unique angle as an ENFORCED, non-generic driver (WAVE-D-PLAN §3 D4)
 * — the deterministic uniqueAngleApplied signal, the prompt directive that
 * forces commitment to the angle, and the avatar as a first-class prompt block.
 */

const ANGLE =
  "Blind-test a $200 stack against my $2,000 daily rig — where does the money actually go?";

/** An outline whose headings/intents commit to the angle's specific lens. */
const committed: { heading: string; text: string }[] = [
  { heading: "The blind test, explained", text: "Why a blind test strips away brand bias." },
  { heading: "The $200 stack", text: "Building the cheap stack we actually test." },
  {
    heading: "Where the money goes",
    text: "Tracking where the money actually makes a difference.",
  },
  { heading: "My $2,000 daily rig", text: "The daily rig we measure the stack against." },
  { heading: "The verdict", text: "What the blind test proves about the money." },
];

/** A generic "tips list" that ignores the angle entirely. */
const generic: { heading: string; text: string }[] = [
  { heading: "5 tips for better coffee", text: "An overview for beginners." },
  { heading: "Tip one: the beans", text: "Pick fresh beans." },
  { heading: "Tip two: the water", text: "Use filtered water." },
  { heading: "Conclusion", text: "Thanks for watching." },
];

describe("checkUniqueAngle", () => {
  it("extracts distinctive keywords (length >= 4, non-stopword)", () => {
    const kws = angleKeywords(ANGLE);
    expect(kws).toContain("blind");
    expect(kws).toContain("stack");
    expect(kws).toContain("money");
    expect(kws).not.toContain("the");
    expect(kws).not.toContain("against"); // stopword
  });

  it("passes an angle-committed outline", () => {
    const result = checkUniqueAngle(ANGLE, committed);
    expect(result.applied).toBe(true);
    expect(result.coverage).toBeGreaterThanOrEqual(0.34);
    expect(result.note).toBeNull();
  });

  it("flags a generic outline that ignores the angle", () => {
    const result = checkUniqueAngle(ANGLE, generic);
    expect(result.applied).toBe(false);
    expect(result.note).not.toBeNull();
    expect(result.note).toContain("do not commit");
  });

  it("is not applied for a blank/absent angle (existing projects still work)", () => {
    expect(checkUniqueAngle("", committed).applied).toBeNull();
    expect(checkUniqueAngle(null, committed).applied).toBeNull();
    expect(checkUniqueAngle("   ", committed).applied).toBeNull();
    expect(isBlankAngle("")).toBe(true);
    expect(isBlankAngle("  a real angle  ")).toBe(false);
    expect(SET_UNIQUE_ANGLE_NUDGE.length).toBeGreaterThan(10);
  });
});

describe("uniqueAngleApplied surfaced in the style/quality gate report", () => {
  const card = fixtureVoiceProfile.styleCard;

  function gateSections(texts: { heading: string; text: string }[]): ScannableSection[] {
    const chapters = texts.map((t) => ({
      kind: "chapter",
      heading: t.heading,
      body: `${t.text} ${t.text} ${t.text}`,
      estSeconds: 120,
    }));
    return [
      {
        kind: "hook",
        heading: "Hook",
        body: "Here is the result I could not explain.",
        estSeconds: 20,
      },
      ...chapters,
      { kind: "cta", heading: "CTA", body: "One click helps more than you think.", estSeconds: 10 },
    ];
  }

  it("computeStyleGates reports true for a committed script", () => {
    const report = computeStyleGates(gateSections(committed), card, ANGLE);
    expect(report.uniqueAngleApplied).toBe(true);
  });

  it("computeStyleGates reports false + a note for a generic script", () => {
    const report = computeStyleGates(gateSections(generic), card, ANGLE);
    expect(report.uniqueAngleApplied).toBe(false);
    expect(report.notes.some((n) => n.includes("do not commit"))).toBe(true);
  });

  it("stays null when no angle is supplied", () => {
    const report = computeStyleGates(gateSections(generic), card);
    expect(report.uniqueAngleApplied).toBeNull();
  });

  it("appears on the full quality report without failing the gate on its own", () => {
    const report = computeQualityReport({
      sections: gateSections(committed),
      targetMinutes: 8,
      tone: "playful",
      styleCard: card,
      chosenHookStyle: card.hookPatterns[0]?.technique ?? null,
      angle: ANGLE,
    });
    expect(report.styleGates?.uniqueAngleApplied).toBe(true);
  });
});

describe("renderUniqueAngleDirective", () => {
  it("emits a commit-to-the-angle directive naming the angle", () => {
    const directive = renderUniqueAngleDirective(ANGLE);
    expect(directive).toContain(ANGLE);
    expect(directive).toContain("UNIQUE ANGLE");
    expect(directive.toLowerCase()).toContain("generic");
  });

  it("is empty for a blank angle", () => {
    expect(renderUniqueAngleDirective("")).toBe("");
    expect(renderUniqueAngleDirective("   ")).toBe("");
  });
});

describe("angle + avatar reach the generation prompts", () => {
  const context = assembleContext({
    frame: { ...fixtureFrame, angle: ANGLE },
    researchDocs: [],
    avatar: fixtureAvatar,
    voiceProfile: fixtureVoiceProfile,
  });
  const outline: Outline = {
    sections: [
      { kind: "hook", heading: "Hook", purpose: "hook", retentionNote: "loop", targetSeconds: 20 },
      {
        kind: "chapter",
        heading: "The $200 stack",
        purpose: "build it",
        retentionNote: "stakes",
        targetSeconds: 120,
      },
      { kind: "cta", heading: "CTA", purpose: "ask", retentionNote: "payoff", targetSeconds: 10 },
      {
        kind: "outro",
        heading: "Outro",
        purpose: "land",
        retentionNote: "close",
        targetSeconds: 10,
      },
    ],
  };

  it("the outline prompt injects the angle directive prominently", () => {
    const tpl = outlinePrompt({ context });
    expect(tpl.prompt).toContain("UNIQUE ANGLE");
    expect(tpl.prompt).toContain(ANGLE);
    expect(tpl.system.toLowerCase()).toContain("unique angle");
  });

  it("the hook and section prompts also carry the angle directive", () => {
    const hook = hookPrompt({ context, outline });
    expect(hook.prompt).toContain("UNIQUE ANGLE");
    const section = sectionPrompt({ context, outline, sectionIndex: 1, priorSections: [] });
    expect(section.prompt).toContain("UNIQUE ANGLE");
  });

  it("the avatar is a structured block (pains + evidence), not a flattened one-liner", () => {
    const block = renderAudienceAvatar(fixtureAvatar);
    expect(block).toContain("Pains to speak to");
    expect(block).toContain("What they want");
    // evidence is carried through, not truncated away
    expect(block).toMatch(/evidence:/);
    // multi-line, first-class block
    expect(block.split("\n").length).toBeGreaterThan(3);
  });

  it("the avatar block rides into the outline and section prompts", () => {
    const outlineTpl = outlinePrompt({ context });
    expect(outlineTpl.prompt).toContain("Pains to speak to");
    const sectionTpl = sectionPrompt({ context, outline, sectionIndex: 1, priorSections: [] });
    expect(sectionTpl.prompt).toContain("Pains to speak to");
  });

  it("renders a graceful note when no avatar exists", () => {
    expect(renderAudienceAvatar(null).toLowerCase()).toContain("no audience avatar");
  });
});
