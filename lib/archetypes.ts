import { z } from "zod";
import { archetypeSchema, type Archetype, type StyleCard } from "@/lib/types/entities";
import type { ArchetypeId } from "@/lib/types/enums";

/**
 * The 12 seeded archetypes (PRODUCT-CONTRACTS §2) — single source of truth
 * for scripts/seed.ts (real rows) AND fixture mode (archetypes.list serves
 * this array keyless). Parsed through the frozen archetypeSchema at module
 * load, so drift from the contract fails the test suite immediately.
 *
 * These are GENERIC archetypes: every style card and preset is original
 * craft describing a content FORMAT, never a real creator. `TODO(seed-copy)`
 * marks copy pending from Josh's content pipeline (pitch text after the
 * marker is working copy, safe to show); exampleSnippets stay placeholders
 * until original seed passages arrive — never paste real creators' words.
 */

const T0 = new Date("2026-09-10T00:00:00.000Z");
const stamps = { createdAt: T0, updatedAt: T0 };

const SNIPPET_PLACEHOLDERS = ["TODO(seed-copy)", "TODO(seed-copy)"];

interface ArchetypeSeedInput {
  id: ArchetypeId;
  displayName: string;
  pitch: string;
  sort: number;
  styleCard: Omit<StyleCard, "exampleSnippets" | "thumbnailPresetId">;
  thumbnailPreset: Omit<Archetype["thumbnailPreset"], "id">;
}

function seed(input: ArchetypeSeedInput): Archetype {
  return archetypeSchema.parse({
    id: input.id,
    displayName: input.displayName,
    pitch: input.pitch,
    sort: input.sort,
    styleCard: {
      ...input.styleCard,
      exampleSnippets: SNIPPET_PLACEHOLDERS,
      // Preset keyed to the same archetype (§1/§5).
      thumbnailPresetId: input.id,
    },
    thumbnailPreset: { id: input.id, ...input.thumbnailPreset },
    ...stamps,
  });
}

export const ARCHETYPE_SEEDS: readonly Archetype[] = [
  seed({
    id: "high-stakes-challenge",
    displayName: "High-Stakes Challenge",
    pitch: "TODO(seed-copy): Big bets, real consequences, and a countdown that never stops.",
    sort: 1,
    styleCard: {
      voice: {
        pov: "First person singular; the creator is the one on the line, viewer addressed as 'you' as a witness.",
        diction: "Plain, urgent, concrete — numbers, deadlines, and stakes named out loud.",
        rhythm: "Short declarative bursts; one-sentence paragraphs at tension peaks.",
      },
      tone: {
        register: "Adrenalized and sincere — the risk is real and acknowledged.",
        never: "Never manufactured panic, never mocking participants, never fake jeopardy.",
      },
      pacing: { wpmTarget: 165, sectionSeconds: 60, rehookSeconds: 45 },
      hookPatterns: [
        {
          technique: "stakes",
          guidance: "State what is won or lost in the first two sentences, with a number.",
        },
        {
          technique: "open_loop",
          guidance: "Tease the final outcome without revealing which way it went.",
        },
      ],
      ctaHabits: {
        placement: "after_payoff",
        placementPct: null,
        phrasingStyle: "Quick and momentum-preserving — one breath, tied to the result just shown.",
        maxPerVideo: 2,
      },
      bannedClaims: ["medical_claims", "financial_promises", "guaranteed_results"],
      readingLevel: { minGrade: 5, maxGrade: 7 },
      energy: 5,
    },
    thumbnailPreset: {
      compositionPatternId: "countdown",
      maxOverlayWords: 4,
      contrastRule: "light_on_dark",
      face: "required",
      paletteTemperature: "warm",
    },
  }),
  seed({
    id: "calm-explainer",
    displayName: "Calm Explainer",
    pitch: "TODO(seed-copy): Complicated things made clear, one unhurried step at a time.",
    sort: 2,
    styleCard: {
      voice: {
        pov: "First person plural where possible ('let's look at') — guide and viewer walk together.",
        diction: "Precise but jargon-free; every technical term defined the first time it appears.",
        rhythm:
          "Even, medium-length sentences; deliberate pauses written in as short standalone lines.",
      },
      tone: {
        register: "Measured, warm, quietly confident.",
        never: "Never alarmist, never condescending, never artificially excited.",
      },
      pacing: { wpmTarget: 135, sectionSeconds: 120, rehookSeconds: 90 },
      hookPatterns: [
        {
          technique: "open_loop",
          guidance:
            "Pose the question the whole video answers; promise the answer is simpler than expected.",
        },
        {
          technique: "bold_claim",
          guidance: "Lead with the counterintuitive conclusion, stated calmly, then earn it.",
        },
      ],
      ctaHabits: {
        placement: "end_only",
        placementPct: null,
        phrasingStyle:
          "Soft invitation framed as continuing the learning, never interrupting an explanation.",
        maxPerVideo: 1,
      },
      bannedClaims: [
        "medical_claims",
        "financial_promises",
        "fear_mongering",
        "absolute_superlatives",
      ],
      readingLevel: { minGrade: 7, maxGrade: 10 },
      energy: 2,
    },
    thumbnailPreset: {
      compositionPatternId: "zoom-detail",
      maxOverlayWords: 5,
      contrastRule: "dark_on_light",
      face: "none",
      paletteTemperature: "cool",
    },
  }),
  seed({
    id: "data-storyteller",
    displayName: "Data Storyteller",
    pitch: "TODO(seed-copy): The numbers have a plot twist — charts that read like stories.",
    sort: 3,
    styleCard: {
      voice: {
        pov: "First person as narrator-analyst; the dataset is the protagonist.",
        diction: "Concrete figures over adjectives; comparisons anchored to everyday scale.",
        rhythm:
          "Builds in threes: set-up, data point, implication — then a short punchline sentence.",
      },
      tone: {
        register: "Curious and rigorous, with earned amazement at genuine outliers.",
        never:
          "Never cherry-picking, never implying causation from correlation, never doom-selling.",
      },
      pacing: { wpmTarget: 145, sectionSeconds: 90, rehookSeconds: 75 },
      hookPatterns: [
        {
          technique: "bold_claim",
          guidance: "Open with the single most surprising number and what it appears to overturn.",
        },
        {
          technique: "open_loop",
          guidance: "Show the anomaly in the chart; withhold the explanation until the midpoint.",
        },
      ],
      ctaHabits: {
        placement: "after_payoff",
        placementPct: null,
        phrasingStyle:
          "Frame as access to the sources and further data, right after a reveal lands.",
        maxPerVideo: 1,
      },
      bannedClaims: ["medical_claims", "financial_promises", "absolute_superlatives"],
      readingLevel: { minGrade: 8, maxGrade: 11 },
      energy: 3,
    },
    thumbnailPreset: {
      compositionPatternId: "progress-timeline",
      maxOverlayWords: 4,
      contrastRule: "complementary",
      face: "optional",
      paletteTemperature: "cool",
    },
  }),
  seed({
    id: "investigative-narrator",
    displayName: "Investigative Narrator",
    pitch: "TODO(seed-copy): Follow the paper trail — patient, sourced, and impossible to pause.",
    sort: 4,
    styleCard: {
      voice: {
        pov: "First person as investigator recounting the trail; sources quoted, steps shown.",
        diction:
          "Careful and specific — dates, places, documents; hedged exactly as much as the evidence requires.",
        rhythm: "Long unspooling sentences broken by abrupt short reveals.",
      },
      tone: {
        register: "Grave, controlled, quietly relentless.",
        never:
          "Never accusatory beyond the evidence, never sensationalized suffering, never speculation stated as fact.",
      },
      pacing: { wpmTarget: 140, sectionSeconds: 110, rehookSeconds: 80 },
      hookPatterns: [
        {
          technique: "in_medias_res",
          guidance: "Start at the most consequential moment of the story, mid-scene, then rewind.",
        },
        {
          technique: "open_loop",
          guidance:
            "Name the unanswered question the investigation closes; do not resolve it early.",
        },
      ],
      ctaHabits: {
        placement: "end_only",
        placementPct: null,
        phrasingStyle: "Reserved, after the conclusion — the story never stops for an ask.",
        maxPerVideo: 1,
      },
      bannedClaims: [
        "medical_claims",
        "financial_promises",
        "absolute_superlatives",
        "fear_mongering",
      ],
      readingLevel: { minGrade: 8, maxGrade: 12 },
      energy: 3,
    },
    thumbnailPreset: {
      compositionPatternId: "hidden-reveal",
      maxOverlayWords: 5,
      contrastRule: "light_on_dark",
      face: "none",
      paletteTemperature: "cool",
    },
  }),
  seed({
    id: "rapid-listicle",
    displayName: "Rapid Listicle",
    pitch: "TODO(seed-copy): Ten things, zero filler — the countdown that respects your time.",
    sort: 5,
    styleCard: {
      voice: {
        pov: "Second person heavy — every item lands on what 'you' get out of it.",
        diction: "Punchy, concrete, verb-first; each item named in five words or fewer.",
        rhythm: "Numbered beats with identical cadence; a one-line zinger closes each item.",
      },
      tone: {
        register: "Brisk, upbeat, decisive.",
        never:
          "Never padded intros, never 'stay till the end' begging, never ranking without a stated criterion.",
      },
      pacing: { wpmTarget: 170, sectionSeconds: 45, rehookSeconds: 40 },
      hookPatterns: [
        {
          technique: "bold_claim",
          guidance: "Promise the payoff of the full list in one line, and name the count.",
        },
        {
          technique: "stakes",
          guidance: "Lead with the cost of picking wrong; the list is the way out.",
        },
      ],
      ctaHabits: {
        placement: "timestamp_pct",
        placementPct: 30,
        phrasingStyle: "One-breath aside between items — never longer than the item transitions.",
        maxPerVideo: 2,
      },
      bannedClaims: ["medical_claims", "financial_promises", "guaranteed_results"],
      readingLevel: { minGrade: 5, maxGrade: 7 },
      energy: 4,
    },
    thumbnailPreset: {
      compositionPatternId: "number-stamp",
      maxOverlayWords: 3,
      contrastRule: "complementary",
      face: "optional",
      paletteTemperature: "warm",
    },
  }),
  seed({
    id: "contrarian-essayist",
    displayName: "Contrarian Essayist",
    pitch: "TODO(seed-copy): The take everyone repeats is wrong — here is the case against it.",
    sort: 6,
    styleCard: {
      voice: {
        pov: "First person essayist; the argument is the spine, the viewer a sparring partner.",
        diction: "Literate but spoken; steelmans the consensus before dismantling it.",
        rhythm: "Thesis stated short; evidence in long paragraphs; periodic one-line concessions.",
      },
      tone: {
        register: "Sharp, dry, intellectually generous to opponents.",
        never:
          "Never strawmanning, never outrage-farming, never contrarian about settled safety facts.",
      },
      pacing: { wpmTarget: 150, sectionSeconds: 100, rehookSeconds: 85 },
      hookPatterns: [
        {
          technique: "bold_claim",
          guidance:
            "State the heresy plainly in the first sentence, then acknowledge how reasonable the consensus sounds.",
        },
        {
          technique: "open_loop",
          guidance: "Promise the one piece of evidence that changed the author's own mind.",
        },
      ],
      ctaHabits: {
        placement: "end_only",
        placementPct: null,
        phrasingStyle:
          "An invitation to disagree in the comments, positioned as continuing the argument.",
        maxPerVideo: 1,
      },
      bannedClaims: ["medical_claims", "financial_promises", "absolute_superlatives"],
      readingLevel: { minGrade: 9, maxGrade: 12 },
      energy: 3,
    },
    thumbnailPreset: {
      compositionPatternId: "crossed-out",
      maxOverlayWords: 5,
      contrastRule: "dark_on_light",
      face: "optional",
      paletteTemperature: "neutral",
    },
  }),
  seed({
    id: "hands-on-builder",
    displayName: "Hands-On Builder",
    pitch: "TODO(seed-copy): Real tools, real mistakes, a finished thing by the end.",
    sort: 7,
    styleCard: {
      voice: {
        pov: "First person at the workbench; narrates decisions while making them.",
        diction:
          "Trade-accurate terms explained by showing, not defining; measurements said out loud.",
        rhythm: "Steady procedural beats with a 'here's where it went wrong' break per act.",
      },
      tone: {
        register: "Practical, patient, honest about failures and costs.",
        never:
          "Never hides mistakes, never pretends the first take worked, never shames beginners.",
      },
      pacing: { wpmTarget: 145, sectionSeconds: 90, rehookSeconds: 75 },
      hookPatterns: [
        {
          technique: "in_medias_res",
          guidance:
            "Open on the finished build or the moment of failure, then jump back to the start.",
        },
        {
          technique: "open_loop",
          guidance:
            "Name the one constraint (budget, time, material) that makes this build interesting.",
        },
      ],
      ctaHabits: {
        placement: "after_payoff",
        placementPct: null,
        phrasingStyle: "Points to plans and parts lists right after the step they belong to.",
        maxPerVideo: 1,
      },
      bannedClaims: ["medical_claims", "financial_promises", "guaranteed_results"],
      readingLevel: { minGrade: 6, maxGrade: 9 },
      energy: 3,
    },
    thumbnailPreset: {
      compositionPatternId: "cutaway",
      maxOverlayWords: 4,
      contrastRule: "complementary",
      face: "optional",
      paletteTemperature: "warm",
    },
  }),
  seed({
    id: "friendly-coach",
    displayName: "Friendly Coach",
    pitch: "TODO(seed-copy): Meet yourself where you are — small wins, every session.",
    sort: 8,
    styleCard: {
      voice: {
        pov: "Second person, present tense — 'you' are mid-practice and the coach is beside you.",
        diction: "Encouraging and specific; corrections framed as adjustments, not errors.",
        rhythm:
          "Instruction, demonstration cue, immediate small win — repeat; recap lists in threes.",
      },
      tone: {
        register: "Warm, energizing, patient.",
        never:
          "Never body-shaming, never no-pain-no-gain machismo, never overnight-transformation promises.",
      },
      pacing: { wpmTarget: 140, sectionSeconds: 80, rehookSeconds: 70 },
      hookPatterns: [
        {
          technique: "open_loop",
          guidance: "Name the plateau this session breaks and hint at the unexpected fix.",
        },
        {
          technique: "bold_claim",
          guidance: "Promise a measurable improvement from one specific change, stated modestly.",
        },
      ],
      ctaHabits: {
        placement: "after_payoff",
        placementPct: null,
        phrasingStyle:
          "Framed as commitment to the next session; celebrates the rep just completed.",
        maxPerVideo: 2,
      },
      bannedClaims: [
        "medical_claims",
        "financial_promises",
        "guaranteed_results",
        "fear_mongering",
      ],
      readingLevel: { minGrade: 5, maxGrade: 8 },
      energy: 3,
    },
    thumbnailPreset: {
      compositionPatternId: "checklist-overlay",
      maxOverlayWords: 5,
      contrastRule: "dark_on_light",
      face: "required",
      paletteTemperature: "warm",
    },
  }),
  seed({
    id: "deadpan-comedian",
    displayName: "Deadpan Comedian",
    pitch: "TODO(seed-copy): Delivered completely straight — the joke is that there is no joke.",
    sort: 9,
    styleCard: {
      voice: {
        pov: "First person, unreasonably matter-of-fact about absurd subject matter.",
        diction: "Formal register applied to trivial things; understatement as the default tool.",
        rhythm: "Flat, even delivery; the punchline is a beat of silence written as a short line.",
      },
      tone: {
        register: "Bone-dry, unbothered, secretly meticulous.",
        never: "Never winks at the camera, never punches down, never explains the joke.",
      },
      pacing: { wpmTarget: 135, sectionSeconds: 70, rehookSeconds: 60 },
      hookPatterns: [
        {
          technique: "bold_claim",
          guidance: "An absurd thesis stated with total sobriety and zero qualification.",
        },
        {
          technique: "in_medias_res",
          guidance: "Begin mid-consequence of a decision no reasonable person would make.",
        },
      ],
      ctaHabits: {
        placement: "end_only",
        placementPct: null,
        phrasingStyle: "Delivered as reluctant contractual obligation — dry, brief, in character.",
        maxPerVideo: 1,
      },
      bannedClaims: ["medical_claims", "financial_promises", "fear_mongering"],
      readingLevel: { minGrade: 6, maxGrade: 9 },
      energy: 2,
    },
    thumbnailPreset: {
      compositionPatternId: "glow-outline",
      maxOverlayWords: 4,
      contrastRule: "light_on_dark",
      face: "required",
      paletteTemperature: "neutral",
    },
  }),
  seed({
    id: "hype-gamer",
    displayName: "Hype Gamer",
    pitch: "TODO(seed-copy): Full-send energy, clutch moments, and zero dead air.",
    sort: 10,
    styleCard: {
      voice: {
        pov: "First person mid-game; the viewer rides along in the moment.",
        diction:
          "Fast, current, community-native slang used naturally — but always parseable by newcomers.",
        rhythm: "Rapid-fire play-by-play spikes into slow-motion emphasis on clutch moments.",
      },
      tone: {
        register: "Electric, celebratory, self-aware about the chaos.",
        never:
          "Never toxic toward other players, never rage-bait, never gambling-adjacent pressure.",
      },
      pacing: { wpmTarget: 175, sectionSeconds: 50, rehookSeconds: 40 },
      hookPatterns: [
        {
          technique: "stakes",
          guidance: "Name the run, the rank, or the record on the line before anything else.",
        },
        {
          technique: "in_medias_res",
          guidance:
            "Drop straight into the wildest moment, cut at the peak, restart from the beginning.",
        },
      ],
      ctaHabits: {
        placement: "timestamp_pct",
        placementPct: 25,
        phrasingStyle: "Shouted-aside energy, over in two seconds, never during a clutch play.",
        maxPerVideo: 2,
      },
      bannedClaims: ["medical_claims", "financial_promises", "guaranteed_results"],
      readingLevel: { minGrade: 4, maxGrade: 7 },
      energy: 5,
    },
    thumbnailPreset: {
      compositionPatternId: "reaction-inset",
      maxOverlayWords: 3,
      contrastRule: "light_on_dark",
      face: "required",
      paletteTemperature: "warm",
    },
  }),
  seed({
    id: "cozy-vlogger",
    displayName: "Cozy Vlogger",
    pitch: "TODO(seed-copy): Slow mornings, small rituals — a quiet corner of the internet.",
    sort: 11,
    styleCard: {
      voice: {
        pov: "First person, diary-like; the viewer is a trusted friend visiting.",
        diction: "Soft, sensory, everyday words; textures and light described more than events.",
        rhythm: "Unhurried run-on warmth broken by gentle single-line observations.",
      },
      tone: {
        register: "Gentle, grateful, softly funny about small failures.",
        never: "Never hustle-culture, never performative perfection, never urgency of any kind.",
      },
      pacing: { wpmTarget: 125, sectionSeconds: 110, rehookSeconds: 90 },
      hookPatterns: [
        {
          technique: "in_medias_res",
          guidance:
            "Open inside the ritual — kettle on, rain outside — before saying what today is.",
        },
        {
          technique: "open_loop",
          guidance:
            "Mention the one small thing that changed this week; return to it near the end.",
        },
      ],
      ctaHabits: {
        placement: "end_only",
        placementPct: null,
        phrasingStyle: "A quiet thank-you and invitation to stay — never a pitch.",
        maxPerVideo: 1,
      },
      bannedClaims: ["medical_claims", "financial_promises", "fear_mongering"],
      readingLevel: { minGrade: 4, maxGrade: 7 },
      energy: 2,
    },
    thumbnailPreset: {
      compositionPatternId: "face+object",
      maxOverlayWords: 4,
      contrastRule: "dark_on_light",
      face: "required",
      paletteTemperature: "warm",
    },
  }),
  seed({
    id: "story-time-confessional",
    displayName: "Story-Time Confessional",
    pitch:
      "TODO(seed-copy): The story they still can't believe happened — told straight to camera.",
    sort: 12,
    styleCard: {
      voice: {
        pov: "First person past tense, straight to camera; asides in present tense break the fourth wall.",
        diction:
          "Conversational and unpolished on purpose; dialogue re-enacted in different voices.",
        rhythm: "Escalating beats with false endings; 'and THEN' pivots as chapter turns.",
      },
      tone: {
        register: "Confiding, self-deprecating, ultimately kind to everyone in the story.",
        never:
          "Never doxxes or identifies private people, never invents events, never trauma-baits.",
      },
      pacing: { wpmTarget: 140, sectionSeconds: 120, rehookSeconds: 80 },
      hookPatterns: [
        {
          technique: "in_medias_res",
          guidance: "Start at the most unbelievable beat, mid-sentence, then 'okay, back up.'",
        },
        {
          technique: "stakes",
          guidance: "Name what the storyteller stood to lose before the story starts.",
        },
      ],
      ctaHabits: {
        placement: "end_only",
        placementPct: null,
        phrasingStyle: "Asks for the viewer's version of the story — engagement as conversation.",
        maxPerVideo: 1,
      },
      bannedClaims: ["medical_claims", "financial_promises", "absolute_superlatives"],
      readingLevel: { minGrade: 5, maxGrade: 8 },
      energy: 3,
    },
    thumbnailPreset: {
      compositionPatternId: "before/after",
      maxOverlayWords: 5,
      contrastRule: "complementary",
      face: "required",
      paletteTemperature: "neutral",
    },
  }),
];

/** Runtime-validated at import: exactly the 12 frozen ids, in sort order. */
z.array(archetypeSchema).length(12).parse(ARCHETYPE_SEEDS);

const byId = new Map<string, Archetype>(ARCHETYPE_SEEDS.map((a) => [a.id, a]));

export function getArchetypeSeed(id: string): Archetype | null {
  return byId.get(id) ?? null;
}
