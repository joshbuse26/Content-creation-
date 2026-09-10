import { describe, expect, it } from "vitest";
import type { HookCandidate, Outline, TopicCandidate } from "@/lib/types/pipeline";
import {
  currentStep,
  flowReducer,
  GENERATE_ALL_COST,
  initialFlowState,
  restoreFlow,
  serializeFlow,
  STEP_COSTS,
  stepStatus,
  type FlowEvent,
  type StagedFlowState,
} from "../staged-flow";

const topics: TopicCandidate[] = [
  { title: "Topic one", angle: "Angle one", rationale: "Because one" },
  { title: "Topic two", angle: "Angle two", rationale: "Because two" },
];

const outline: Outline = {
  sections: [
    {
      kind: "hook",
      heading: "The opener",
      purpose: "hook them",
      retentionNote: "",
      targetSeconds: 25,
    },
    {
      kind: "chapter",
      heading: "The middle",
      purpose: "teach",
      retentionNote: "re-hook",
      targetSeconds: 120,
    },
    { kind: "outro", heading: "The end", purpose: "close", retentionNote: "", targetSeconds: 30 },
  ],
};

const hooks: HookCandidate[] = [
  { style: "open_loop", body: "What if…", autoPicked: true },
  { style: "bold_claim", body: "Everything you know is wrong.", autoPicked: false },
  { style: "stakes", body: "If this fails, I lose it all.", autoPicked: false },
];

function run(events: FlowEvent[], from: StagedFlowState = initialFlowState()): StagedFlowState {
  return events.reduce(flowReducer, from);
}

describe("step progression", () => {
  it("starts with topics available and everything downstream locked", () => {
    const s = initialFlowState();
    expect(stepStatus(s, "topics")).toBe("available");
    expect(stepStatus(s, "outline")).toBe("locked");
    expect(stepStatus(s, "hooks")).toBe("locked");
    expect(stepStatus(s, "draft")).toBe("locked");
    expect(currentStep(s)).toBe("topics");
    expect(s.creditsSpent).toBe(0);
  });

  it("walks the happy path: topics → outline → hooks → draft with cumulative credits", () => {
    let s = run([{ type: "topics_generated", topics }]);
    expect(s.creditsSpent).toBe(STEP_COSTS.topics);
    expect(stepStatus(s, "outline")).toBe("locked"); // candidates alone don't unlock

    s = run([{ type: "topic_picked", topic: { title: "Topic one", angle: "Angle one" } }], s);
    expect(stepStatus(s, "topics")).toBe("done");
    expect(stepStatus(s, "outline")).toBe("available");
    expect(currentStep(s)).toBe("outline");

    s = run([{ type: "outline_generated", outline }], s);
    expect(s.creditsSpent).toBe(2);
    expect(stepStatus(s, "hooks")).toBe("available");

    s = run([{ type: "hooks_generated", hooks }], s);
    expect(s.creditsSpent).toBe(3);
    expect(stepStatus(s, "draft")).toBe("locked"); // hook not picked yet

    const hook = hooks[1];
    if (hook === undefined) throw new Error("fixture hook missing");
    s = run([{ type: "hook_picked", hook }], s);
    expect(stepStatus(s, "hooks")).toBe("done");
    expect(stepStatus(s, "draft")).toBe("available");

    s = run([{ type: "draft_started" }], s);
    expect(s.creditsSpent).toBe(3 + STEP_COSTS.draft);
  });

  it("sums the composite generate-all cost from the staged costs", () => {
    expect(GENERATE_ALL_COST).toBe(STEP_COSTS.outline + STEP_COSTS.hooks + STEP_COSTS.draft);
    expect(GENERATE_ALL_COST).toBe(6);
  });
});

describe("skip-topic paths (no charge)", () => {
  it("typing your own topic unlocks the outline without charging", () => {
    const s = run([{ type: "custom_topic", title: "  My own topic  " }]);
    expect(s.creditsSpent).toBe(0);
    expect(s.customTopic).toBe(true);
    expect(s.chosenTopic).toEqual({ title: "My own topic", angle: "" });
    expect(stepStatus(s, "topics")).toBe("done");
    expect(stepStatus(s, "outline")).toBe("available");
  });

  it("an empty typed topic is ignored", () => {
    const s = run([{ type: "custom_topic", title: "   " }]);
    expect(s).toEqual(initialFlowState());
  });

  it("skipping to the chosen frame unlocks the outline without charging", () => {
    const s = run([{ type: "skip_topics" }]);
    expect(s.creditsSpent).toBe(0);
    expect(s.topicsSkipped).toBe(true);
    expect(s.chosenTopic).toBeNull();
    expect(stepStatus(s, "outline")).toBe("available");
  });

  it("a typed topic survives a later candidate regeneration; a picked one does not", () => {
    const typed = run([
      { type: "custom_topic", title: "Mine" },
      { type: "topics_generated", topics },
    ]);
    expect(typed.chosenTopic?.title).toBe("Mine");

    const picked = run([
      { type: "topics_generated", topics },
      { type: "topic_picked", topic: { title: "Topic one", angle: "Angle one" } },
      { type: "topics_generated", topics },
    ]);
    expect(picked.chosenTopic).toBeNull();
  });
});

describe("downstream invalidation", () => {
  const readyState = run([
    { type: "custom_topic", title: "Mine" },
    { type: "outline_generated", outline },
    { type: "hooks_generated", hooks },
    { type: "hook_picked", hook: hooks[0] as HookCandidate },
  ]);

  it("picking a new topic clears outline and hooks", () => {
    const s = run([{ type: "topic_picked", topic: { title: "Topic two", angle: "" } }], readyState);
    expect(s.outline).toBeNull();
    expect(s.hooks).toBeNull();
    expect(s.chosenHook).toBeNull();
    expect(s.creditsSpent).toBe(readyState.creditsSpent); // spend is history, not state
  });

  it("regenerating the outline clears hooks but keeps the topic", () => {
    const s = run([{ type: "outline_generated", outline }], readyState);
    expect(s.chosenTopic?.title).toBe("Mine");
    expect(s.hooks).toBeNull();
    expect(s.chosenHook).toBeNull();
    expect(s.creditsSpent).toBe(readyState.creditsSpent + STEP_COSTS.outline);
  });

  it("a style change clears outline + hooks and keeps the topic (free)", () => {
    const s = run([{ type: "style_changed" }], readyState);
    expect(s.chosenTopic?.title).toBe("Mine");
    expect(s.outline).toBeNull();
    expect(s.hooks).toBeNull();
    expect(s.creditsSpent).toBe(readyState.creditsSpent);
  });

  it("inline outline edits are free and keep the picked hook", () => {
    const edited: Outline = {
      sections: outline.sections.map((sec, i) =>
        i === 0 ? { ...sec, heading: "New heading", targetSeconds: 40 } : sec,
      ),
    };
    const s = run([{ type: "outline_edited", outline: edited }], readyState);
    expect(s.outline?.sections[0]?.heading).toBe("New heading");
    expect(s.chosenHook).not.toBeNull();
    expect(s.creditsSpent).toBe(readyState.creditsSpent);
  });

  it("reset returns to the initial state", () => {
    expect(run([{ type: "reset" }], readyState)).toEqual(initialFlowState());
  });
});

describe("refresh resume (serialize/restore round trip)", () => {
  it("round-trips a mid-flow state", () => {
    const s = run([
      { type: "topics_generated", topics },
      { type: "topic_picked", topic: { title: "Topic one", angle: "Angle one" } },
      { type: "outline_generated", outline },
    ]);
    const restored = restoreFlow(serializeFlow(s));
    expect(restored).toEqual(s);
    // The restored state resumes exactly where the flow left off.
    expect(restored !== null && currentStep(restored)).toBe("hooks");
  });

  it("rejects malformed or schema-invalid stored payloads", () => {
    expect(restoreFlow(null)).toBeNull();
    expect(restoreFlow("not json {")).toBeNull();
    expect(restoreFlow(JSON.stringify({ creditsSpent: -3 }))).toBeNull();
    expect(restoreFlow(JSON.stringify({ ...initialFlowState(), creditsSpent: "six" }))).toBeNull();
  });
});
