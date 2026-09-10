import { z } from "zod";
import {
  hookCandidateSchema,
  outlineSchema,
  topicCandidateSchema,
  type HookCandidate,
  type Outline,
  type TopicCandidate,
} from "@/lib/types/pipeline";

/**
 * Staged generation flow — pure state machine (wave C2).
 *
 * Four user-facing steps over the frozen staged procedures
 * (PRODUCT-CONTRACTS §4): Topics (1cr) → Outline (1cr) → Hooks (1cr) →
 * Draft (4cr). Rules encoded here, UI-free and fully testable:
 *
 *  - Topics are optional: typing your own topic (or skipping to the chosen
 *    frame) never charges the topics credit.
 *  - Outline unlocks once a topic is chosen, typed, or explicitly skipped.
 *  - Hooks unlock once an outline exists; picking a new topic or
 *    regenerating the outline invalidates hooks downstream.
 *  - Draft unlocks once a hook is picked.
 *  - creditsSpent counts only actual charged runs (each regenerate charges
 *    again); it is a client-side running total for display — the ledger is
 *    authoritative.
 */

export const STEP_ORDER = ["topics", "outline", "hooks", "draft"] as const;
export type StepId = (typeof STEP_ORDER)[number];

export const STEP_COSTS: Record<StepId, number> = {
  topics: 1,
  outline: 1,
  hooks: 1,
  draft: 4,
};

/** Composite orchestrator cost (outline + hooks + draft, §4). */
export const GENERATE_ALL_COST = STEP_COSTS.outline + STEP_COSTS.hooks + STEP_COSTS.draft;

export type ChosenTopic = Pick<TopicCandidate, "title" | "angle">;

const chosenTopicSchema = topicCandidateSchema.pick({ title: true, angle: true });

export const stagedFlowStateSchema = z.object({
  /** Generated candidates (null = topics step not run). */
  topics: z.array(topicCandidateSchema).nullable(),
  chosenTopic: chosenTopicSchema.nullable(),
  /** True when the topic was typed by the user (no charge). */
  customTopic: z.boolean(),
  /** True when the user chose to derive from the chosen frame instead. */
  topicsSkipped: z.boolean(),
  outline: outlineSchema.nullable(),
  hooks: z.array(hookCandidateSchema).nullable(),
  chosenHook: hookCandidateSchema.nullable(),
  /** Client-side running total of charged credits (display only). */
  creditsSpent: z.number().int().nonnegative(),
});
export type StagedFlowState = z.infer<typeof stagedFlowStateSchema>;

export function initialFlowState(): StagedFlowState {
  return {
    topics: null,
    chosenTopic: null,
    customTopic: false,
    topicsSkipped: false,
    outline: null,
    hooks: null,
    chosenHook: null,
    creditsSpent: 0,
  };
}

export type FlowEvent =
  | { type: "topics_generated"; topics: TopicCandidate[] }
  | { type: "topic_picked"; topic: ChosenTopic }
  | { type: "custom_topic"; title: string }
  | { type: "skip_topics" }
  | { type: "outline_generated"; outline: Outline }
  | { type: "outline_edited"; outline: Outline }
  | { type: "hooks_generated"; hooks: HookCandidate[] }
  | { type: "hook_picked"; hook: HookCandidate }
  | { type: "draft_started" }
  | { type: "style_changed" }
  | { type: "reset" };

/** Clear everything downstream of the topic choice (style/topic changed). */
function clearFromOutline(state: StagedFlowState): StagedFlowState {
  return { ...state, outline: null, hooks: null, chosenHook: null };
}

export function flowReducer(state: StagedFlowState, event: FlowEvent): StagedFlowState {
  switch (event.type) {
    case "topics_generated":
      // A fresh candidate list invalidates a previous pick from the old list
      // (a typed topic survives — it never came from candidates).
      return {
        ...clearFromOutline(state),
        topics: event.topics,
        chosenTopic: state.customTopic ? state.chosenTopic : null,
        topicsSkipped: false,
        creditsSpent: state.creditsSpent + STEP_COSTS.topics,
      };
    case "topic_picked":
      return {
        ...clearFromOutline(state),
        chosenTopic: event.topic,
        customTopic: false,
        topicsSkipped: false,
      };
    case "custom_topic": {
      const title = event.title.trim();
      if (title === "") return state;
      // Typing your own topic skips the topics charge entirely.
      return {
        ...clearFromOutline(state),
        chosenTopic: { title, angle: "" },
        customTopic: true,
        topicsSkipped: false,
      };
    }
    case "skip_topics":
      return {
        ...clearFromOutline(state),
        chosenTopic: null,
        customTopic: false,
        topicsSkipped: true,
      };
    case "outline_generated":
      return {
        ...state,
        outline: event.outline,
        hooks: null,
        chosenHook: null,
        creditsSpent: state.creditsSpent + STEP_COSTS.outline,
      };
    case "outline_edited":
      // Inline edits are free and keep hooks: hooks were written for this
      // outline's substance; tweaking a heading/length is not a regeneration.
      return state.outline === null ? state : { ...state, outline: event.outline };
    case "hooks_generated":
      return {
        ...state,
        hooks: event.hooks,
        chosenHook: null,
        creditsSpent: state.creditsSpent + STEP_COSTS.hooks,
      };
    case "hook_picked":
      return { ...state, chosenHook: event.hook };
    case "draft_started":
      return { ...state, creditsSpent: state.creditsSpent + STEP_COSTS.draft };
    case "style_changed":
      // A new style card re-frames outline + hooks; the topic survives.
      return clearFromOutline(state);
    case "reset":
      return initialFlowState();
  }
}

// ---------------------------------------------------------------------------
// Derivations
// ---------------------------------------------------------------------------

export type StepStatus = "locked" | "available" | "done";

/** A step is "done" when its decision is made, "available" when actionable. */
export function stepStatus(state: StagedFlowState, step: StepId): StepStatus {
  switch (step) {
    case "topics":
      return state.chosenTopic !== null || state.topicsSkipped ? "done" : "available";
    case "outline":
      if (state.outline !== null) return "done";
      return stepStatus(state, "topics") === "done" ? "available" : "locked";
    case "hooks":
      if (state.chosenHook !== null) return "done";
      return state.outline !== null ? "available" : "locked";
    case "draft":
      return state.chosenHook !== null && state.outline !== null ? "available" : "locked";
  }
}

/** First non-done step — where the rail focuses. */
export function currentStep(state: StagedFlowState): StepId {
  for (const step of STEP_ORDER) {
    if (stepStatus(state, step) !== "done") return step;
  }
  return "draft";
}

// ---------------------------------------------------------------------------
// Refresh-resume serialization (schema-validated round trip)
// ---------------------------------------------------------------------------

export function serializeFlow(state: StagedFlowState): string {
  return JSON.stringify(state);
}

export function restoreFlow(raw: string | null): StagedFlowState | null {
  if (raw === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = stagedFlowStateSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}
