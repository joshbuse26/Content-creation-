import type { StyleCard } from "@/lib/types/entities";
import type { HookStyle } from "@/lib/types/enums";
import type {
  Outline,
  PlannedQueries,
  ProposedFrame,
  ResearchBrief,
  ScriptContext,
  TopicCandidate,
} from "@/lib/types/pipeline";
import { TITLE_PATTERN_FAMILIES } from "@/prompts";
import { countWords } from "./readability";

/**
 * Deterministic content synthesizers — what the pipelines produce when
 * PROVIDERS=fixture (zero keys, zero network, reproducible). Same inputs →
 * same script. The output is deliberately shaped to pass the quality gate
 * so the whole product is demonstrable end-to-end without an API key.
 */

export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(arr: readonly T[], rand: () => number): T {
  const item = arr[Math.floor(rand() * arr.length)];
  if (item === undefined) throw new Error("pick from empty array");
  return item;
}

function keywordOf(context: ScriptContext, rand: () => number): string {
  const kws = context.frame.keywords;
  if (kws.length === 0) return "this topic";
  const kw = kws[Math.floor(rand() * kws.length)];
  return kw ?? "this topic";
}

// ---------------------------------------------------------------------------
// Spoken-prose sentence engine (short words, short sentences — Flesch ≥ 60)
// ---------------------------------------------------------------------------

const SENTENCE_TEMPLATES: readonly string[] = [
  "Here is the part most people miss about {kw}.",
  "I ran this test three times to be sure.",
  "The gap was smaller than I thought, and it shows up fast.",
  "You can check this at home in about ten minutes.",
  "The first result made me stop and re-run the whole thing.",
  "Most advice on {kw} skips the one step that matters.",
  "So I wrote down every number as I went.",
  "That one change moved the result more than all the rest combined.",
  "Keep that number in mind, because it comes back later.",
  "The cheap option held its own longer than it had any right to.",
  "This is where the money question gets a real answer.",
  "Watch what happens when we push it past the easy case.",
  "I expected a clear winner here, and I did not get one.",
  "The difference you can feel is not the one you pay for.",
  "Nobody selling you {kw} will say this part out loud.",
  "Half the fixes online make this worse, not better.",
  "There is a simple reason for that, and it is not the obvious one.",
  "Once you see it, you cannot unsee it.",
  "The test setup stays the same the whole way through.",
  "If you only take one thing from this, take this next bit.",
];

function synthParagraph(rand: () => number, context: ScriptContext, targetWords: number): string {
  const sentences: string[] = [];
  let words = 0;
  while (words < targetWords) {
    const template = pick(SENTENCE_TEMPLATES, rand);
    const sentence = template.replace("{kw}", keywordOf(context, rand));
    sentences.push(sentence);
    words += countWords(sentence);
  }
  return sentences.join(" ");
}

/** First sentence of a research excerpt — used as an in-script cited fact. */
function factSentenceFrom(excerpt: string): string | null {
  const match = /[^.!?\n]{20,240}[.!?]/.exec(excerpt.replace(/^#+ .*$/gm, "").trim());
  if (match === null) return null;
  return match[0].trim().replace(/^[-*\s]+/, "");
}

// ---------------------------------------------------------------------------
// Stage synthesizers
// ---------------------------------------------------------------------------

export function synthOutline(context: ScriptContext): Outline {
  const rand = mulberry32(fnv1a(`outline|${context.frame.angle}|${context.frame.targetMinutes}`));
  const total = context.frame.targetMinutes * 60;
  const hookSeconds = 22;
  const ctaSeconds = 20;
  const outroSeconds = 16;
  const introSeconds = Math.min(45, Math.max(30, Math.round(total * 0.06)));
  const chapterBudget = total - hookSeconds - ctaSeconds - outroSeconds - introSeconds;
  // Wave C: a style card's pacing.sectionSeconds is the chapter-length norm
  // (PRODUCT-CONTRACTS §1) — the outline honors it; 150s is the card-less
  // legacy default. Clamped so the outline stays inside the frozen 30-section
  // cap (24 chapters + hook/intro/cta/outro).
  const sectionNorm = context.styleCard?.pacing.sectionSeconds ?? 150;
  const maxChapters = context.styleCard === null ? 8 : 24;
  const chapterCount = Math.max(2, Math.min(maxChapters, Math.round(chapterBudget / sectionNorm)));
  const per = Math.floor(chapterBudget / chapterCount);
  const chapterHeadings = [
    "The setup, and the rules",
    "What the numbers actually say",
    "The part everyone gets wrong",
    "The head-to-head",
    "Where it breaks down",
    "The verdict, with receipts",
    "What I would do differently",
    "The cost question",
  ];
  const sections: Outline["sections"] = [
    {
      kind: "hook",
      heading: "Hook",
      purpose: "Earn the next 60 seconds with a concrete open question.",
      retentionNote: "Open loop: the final result stays hidden until two-thirds in.",
      targetSeconds: hookSeconds,
    },
    {
      kind: "intro",
      heading: "The stakes",
      purpose: "Set the rules of the test and what the viewer gets by the end.",
      retentionNote: "Stakes named in the first two sentences; re-hook before first chapter.",
      targetSeconds: introSeconds,
    },
  ];
  for (let i = 0; i < chapterCount; i++) {
    const isLast = i === chapterCount - 1;
    const seconds = isLast ? chapterBudget - per * (chapterCount - 1) : per;
    sections.push({
      kind: "chapter",
      heading: chapterHeadings[i % chapterHeadings.length] ?? `Chapter ${i + 1}`,
      purpose: `Deliver one concrete finding about ${keywordOf(context, rand)}.`,
      retentionNote:
        i === chapterCount - 2
          ? "Payoff lands here — close the hook's open loop."
          : "Re-hook: tease the next finding before this one fully lands.",
      targetSeconds: seconds,
    });
  }
  // CTA placement follows the card's ctaHabits (PRODUCT-CONTRACTS §1/§6):
  // `timestamp_pct` cards get the CTA inserted at the section boundary
  // closest to placementPct of total runtime (still directly after a
  // chapter, so `after_payoff` semantics hold too); `end_only`/`after_payoff`
  // and card-less scripts keep the legacy end position (last chapter → CTA →
  // outro satisfies both).
  const ctaSection: Outline["sections"][number] = {
    kind: "cta",
    heading: "One ask",
    purpose: "Convert the value just delivered into a subscribe.",
    retentionNote: "Single ask tied to the result the viewer just saw.",
    targetSeconds: ctaSeconds,
  };
  const habits = context.styleCard?.ctaHabits ?? null;
  if (habits !== null && habits.placement === "timestamp_pct" && habits.placementPct !== null) {
    const targetBefore = (habits.placementPct / 100) * total;
    let best = sections.length;
    let bestDelta = Number.POSITIVE_INFINITY;
    let cumulative = 0;
    for (let i = 0; i < sections.length; i++) {
      cumulative += sections[i]?.targetSeconds ?? 0;
      // Only boundaries directly after a chapter — the CTA must follow a
      // payoff beat, never interrupt hook/intro.
      if (sections[i]?.kind !== "chapter") continue;
      const delta = Math.abs(cumulative - targetBefore);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = i + 1;
      }
    }
    sections.splice(best, 0, ctaSection);
  } else {
    sections.push(ctaSection);
  }
  sections.push({
    kind: "outro",
    heading: "Wrap",
    purpose: "Land the takeaway and bridge to the next video.",
    retentionNote: "Bridge to a named follow-up question.",
    targetSeconds: outroSeconds,
  });
  return { sections };
}

export interface SynthHook {
  style: "open_loop" | "bold_claim" | "stakes" | "in_medias_res";
  body: string;
}

/** Two deterministic body variants per technique, so a card that allows
 *  fewer than three techniques still yields three DISTINCT candidates. */
function hookBodyVariants(angle: string): Record<HookStyle, [string, string]> {
  return {
    open_loop: [
      `There is one result in this test I still cannot fully explain. ${angle} — that was the plan, anyway. By the time we hit the third round, the plan fell apart, and the reason why changes how you should think about every choice like this one.`,
      `One number in this test refused to behave, and it is the one everything else depends on. ${angle}. I am going to show you exactly where it broke, but not until you have seen what led up to it — because the order matters.`,
    ],
    bold_claim: [
      `Most of what you have heard about this is wrong, and I can show you where. ${angle}. I put that idea through a real test, wrote down every number, and the winner is not the one the internet keeps telling you to buy.`,
      `The popular advice on this fails a basic measurement, and nobody checks. ${angle}. I checked. The gap between what gets recommended and what actually performs is wider than I expected, and it points the other way.`,
    ],
    stakes: [
      `The wrong call here costs you real money, and most people make it in the first five minutes. ${angle}. Before you spend another dollar, watch what happened when I actually measured it — because one of these choices is quietly wasting your cash.`,
      `Get this one wrong and you pay for it twice — once at checkout, and again every day you use it. ${angle}. Here is the test that would have saved me from exactly that mistake.`,
    ],
    in_medias_res: [
      `Round three. The cheap one is still standing, the expensive one is smoking, and I am staring at my notes wondering what I got wrong. ${angle} — that is how this started, three days and one ruined afternoon ago.`,
      `The timer hits zero, the result is on the screen, and it is not the one I predicted on camera an hour earlier. ${angle}. Let me back up and show you how we got here.`,
    ],
  };
}

/**
 * Three tagged hook candidates. With `allowed` (a style card's hookPatterns
 * techniques, in preference order) the candidates CYCLE the allowed
 * techniques — repeats take the second body variant so all three bodies
 * stay distinct. Without it, the legacy trio (open_loop/bold_claim/stakes)
 * is unchanged.
 */
export function synthHookCandidates(
  context: ScriptContext,
  allowed?: readonly HookStyle[] | null,
): SynthHook[] {
  const angle = context.frame.angle.replace(/[.?!]+$/, "");
  const variants = hookBodyVariants(angle);
  const techniques: readonly HookStyle[] =
    allowed !== undefined && allowed !== null && allowed.length > 0
      ? allowed
      : ["open_loop", "bold_claim", "stakes"];
  return [0, 1, 2].map((i) => {
    const style = techniques[i % techniques.length] ?? "open_loop";
    const variant = Math.floor(i / techniques.length) % 2;
    const [first, second] = variants[style];
    return { style, body: variant === 0 ? first : second };
  });
}

export function synthSectionBody(
  context: ScriptContext,
  section: Outline["sections"][number],
  sectionIndex: number,
): string {
  const rand = mulberry32(
    fnv1a(`section|${context.frame.angle}|${sectionIndex}|${section.heading}`),
  );
  const targetWords = Math.round(section.targetSeconds * 2.5);
  if (section.kind === "cta") {
    return "If this test just saved you from an expensive mistake, the subscribe button is the cheapest thanks there is. One click, and you get the next test the day it lands.";
  }
  if (section.kind === "outro") {
    return "So that is the honest answer: measure first, spend second. Next time I am taking the same test one step further, and the early numbers already look strange. See you there.";
  }
  const parts: string[] = [];
  if (section.kind === "chapter") {
    // Weave one cited research fact into chapters so the fact-check stage
    // has real claims to match against research docs.
    const doc =
      context.research[
        (sectionIndex + context.research.length) % Math.max(1, context.research.length)
      ];
    if (doc !== undefined) {
      const fact = factSentenceFrom(doc.excerpt);
      if (fact !== null) {
        parts.push(`Here is what the research actually shows. ${fact}`);
      }
    }
  }
  parts.push(synthParagraph(rand, context, targetWords - countWords(parts.join(" "))));
  return parts.join(" ");
}

export function synthRetentionNote(kind: string, index: number): string | null {
  if (kind === "hook") return "Open loop planted: result withheld until the payoff chapter.";
  if (kind === "chapter")
    return index % 2 === 0
      ? "Re-hook: next finding teased before this one lands."
      : "Payoff beat: a planted question closes here.";
  if (kind === "intro") return "Stakes stated early; forward pull into first chapter.";
  return null;
}

/** Retention pass, fixture mode: add a re-hook line to long chapters. */
export function synthRetentionRewrite(body: string, kind: string, estSeconds: number): string {
  if (kind !== "chapter" || estSeconds < 90) return body;
  if (body.includes("Hold that thought")) return body;
  return `${body} Hold that thought, because the next part is where it gets weird.`;
}

/** Voice pass, fixture mode: apply one energy-keyed connector once, so the
 *  pass visibly ran. Deterministic; never quotes example snippets. */
export function synthVoiceRewrite(
  body: string,
  kind: string,
  styleCard: StyleCard | null,
  used: { catchphrase: boolean },
): string {
  if (styleCard === null) return body;
  if (kind === "chapter" && !used.catchphrase) {
    used.catchphrase = true;
    const connector =
      styleCard.energy >= 4
        ? "Here is where it gets good"
        : styleCard.energy <= 2
          ? "Take a second with this one"
          : "Here is the part that matters";
    return `${connector} — ${body.charAt(0).toLowerCase()}${body.slice(1)}`;
  }
  return body;
}

/**
 * Licensed-voice de-duplication rewrite, fixture mode. Deterministically
 * breaks every 5-word run by inserting a filler token after each 4 words, so
 * no original 5-gram survives — the similarity guard's overlap drops to ~0
 * without any live model. Fixture-only; live mode uses dedupeRewritePrompt.
 */
export function synthDedupeRewrite(body: string): string {
  const words = body.split(/\s+/).filter((w) => w.length > 0);
  if (words.length < 5) return body;
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    out.push(words[i] ?? "");
    if ((i + 1) % 4 === 0 && i + 1 < words.length) out.push("basically");
  }
  return out.join(" ");
}

// ---------------------------------------------------------------------------
// Topic candidates (staged `script.topics`, PRODUCT-CONTRACTS §4)
// ---------------------------------------------------------------------------

export interface SynthTopicsInput {
  /** Deterministic seed — channel id + generation-mode key. */
  seed: string;
  /** The channel's niche keywords (may be empty). */
  nicheKeywords: readonly string[];
  /** Titles of fresh niche outliers, best ratio first (may be empty). */
  outlierTitles: readonly string[];
  /** 1–5 energy from the resolved style card, 3 when no card. */
  energy: number;
  count: number;
}

const TOPIC_TEMPLATES: readonly { title: string; angle: string }[] = [
  {
    title: "The {kw} upgrade everyone buys first (and why it should be last)",
    angle: "Reorder the standard {kw} buying advice using measured results, not habit.",
  },
  {
    title: "I tracked 30 days of {kw} — here is what actually moved the needle",
    angle: "A month of honest measurement, ranked by effect size.",
  },
  {
    title: "Five beginner {kw} mistakes that quietly cost the most",
    angle: "Rank the common mistakes by real cost, with the fix for each.",
  },
  {
    title: "Cheap vs expensive {kw} — blind comparison",
    angle: "Same task, both price points, judged blind.",
  },
  {
    title: "What nobody tells you before your first year of {kw}",
    angle: "The unglamorous fundamentals, told through one concrete story.",
  },
  {
    title: "One week of {kw} using only the basics",
    angle: "A constraint experiment that questions the upgrade treadmill.",
  },
  {
    title: "The {kw} setting almost everyone gets wrong",
    angle: "One high-leverage adjustment, demonstrated before/after.",
  },
  {
    title: "Auditing my own first {kw} attempt",
    angle: "Revisit early work with today's standards and extract the lessons.",
  },
  {
    title: "The 80/20 of {kw} — what to practice first",
    angle: "The minimum set of skills that produces most of the results.",
  },
  {
    title: "Every {kw} buy I would repeat (and three I regret)",
    angle: "A no-affiliate honesty pass over a year of purchases.",
  },
];

/** Deterministic topic candidates bound to the channel's niche + outliers. */
export function synthTopicCandidates(input: SynthTopicsInput): TopicCandidate[] {
  const keywords = input.nicheKeywords.length > 0 ? input.nicheKeywords : ["this niche"];
  const offset = fnv1a(`topics|${input.seed}|${keywords.join(",")}`) % TOPIC_TEMPLATES.length;
  const out: TopicCandidate[] = [];
  for (let i = 0; i < input.count; i++) {
    const template = TOPIC_TEMPLATES[(offset + i) % TOPIC_TEMPLATES.length];
    if (template === undefined) continue;
    const kw = keywords[i % keywords.length] ?? "this niche";
    const outlier = input.outlierTitles[i % Math.max(1, input.outlierTitles.length)];
    const energyNote =
      input.energy >= 4
        ? "High-energy fit: the format sustains fast pacing."
        : input.energy <= 2
          ? "Low-key fit: the format rewards an unhurried read."
          : "Neutral-energy fit for this voice.";
    out.push({
      title: template.title.replace("{kw}", kw).slice(0, 120),
      angle: template.angle.replace("{kw}", kw).slice(0, 500),
      rationale: (outlier !== undefined
        ? `"${outlier}" is outperforming its channel median in this niche; this adapts that demand. ${energyNote}`
        : `Maps onto the channel's "${kw}" niche with a proven format. ${energyNote}`
      ).slice(0, 1000),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Research / frames / titles / revision synthesizers
// ---------------------------------------------------------------------------

export function synthQueries(query: string): PlannedQueries {
  const base = query.trim().replace(/[.?!]+$/, "");
  return {
    queries: [
      base,
      `${base} data and benchmarks`,
      `${base} expert criticism`,
      `${base} what changed this year`,
    ],
  };
}

export function synthArticleText(url: string, title: string): string {
  const rand = mulberry32(fnv1a(`article|${url}`));
  const n1 = 12 + Math.floor(rand() * 80);
  const n2 = 2 + Math.floor(rand() * 8);
  const pct = 55 + Math.floor(rand() * 40);
  return [
    `${title}.`,
    `We tested this across ${n1} products over ${n2} weeks under matched conditions.`,
    `In blind scoring, ${pct} percent of panelists could not tell the top pick from the budget pick.`,
    `The measured spread between the best and worst unit was ${n2}.${Math.floor(rand() * 9)} points on our scale.`,
    "Method notes: identical inputs, randomized order, three raters per round.",
    "The popular recommendation underperformed its price tier in two of three rounds.",
  ].join(" ");
}

export function synthBrief(
  query: string,
  sources: { url: string; title: string; text: string }[],
): ResearchBrief {
  const facts = sources.slice(0, 6).map((s) => {
    const sentence = factSentenceFrom(s.text) ?? `${s.title} reports measured results on ${query}.`;
    return { claim: sentence, sourceUrl: s.url };
  });
  const content = [
    `## Research brief: ${query}`,
    "",
    "### Key findings",
    ...facts.map((f) => `- ${f.claim} (source: ${f.sourceUrl})`),
    "",
    "### Tensions",
    "- Sources disagree on how much the top tier is worth paying for; the measured gaps are consistently smaller than the marketing claims.",
  ].join("\n");
  return { title: `Research brief: ${query}`, content, facts };
}

export function synthFrames(input: { projectTitle: string; keywords: string[] }): ProposedFrame[] {
  const kw = input.keywords.slice(0, 6);
  const title = input.projectTitle.replace(/[.?!]+$/, "");
  return [
    {
      angle: `${title}: I tested it under real conditions, and the winner is not the obvious one`,
      format: "challenge",
      outcome: "watch_time",
      audienceSegment: "Viewers deciding whether to spend money on this",
      tone: "playful-rigorous",
      targetMinutes: 12,
      keywords: kw,
    },
    {
      angle: `Everything most people believe about ${title.toLowerCase()} traces back to one bad assumption`,
      format: "essay",
      outcome: "subs",
      audienceSegment: "Enthusiasts who want the deeper mechanics",
      tone: "calm, quietly contrarian",
      targetMinutes: 10,
      keywords: kw,
    },
    {
      angle: `The complete beginner's path through ${title.toLowerCase()}, with the traps marked`,
      format: "tutorial",
      outcome: "conversion",
      audienceSegment: "Newcomers about to make their first purchase",
      tone: "warm, step-by-step, zero jargon",
      targetMinutes: 9,
      keywords: kw,
    },
    {
      angle: `Seven claims about ${title.toLowerCase()}, ranked from busted to confirmed`,
      format: "listicle",
      outcome: "watch_time",
      audienceSegment: "Skeptics who enjoy myth-testing",
      tone: "brisk, evidence-first",
      targetMinutes: 11,
      keywords: kw,
    },
  ];
}

export function synthTitles(input: {
  projectTitle: string;
  frameAngle: string;
}): { text: string; patternFamily: string }[] {
  const topic = input.projectTitle.replace(/[.?!]+$/, "").slice(0, 40);
  const seeds: [string, string][] = [
    [`The Truth About ${topic}`, "curiosity_gap"],
    [`What Nobody Measures About ${topic}`, "curiosity_gap"],
    [`The ${topic} Result I Can't Explain`, "curiosity_gap"],
    [`${topic}: Cheap vs Expensive, Tested`, "versus"],
    [`Budget ${topic} vs the Premium Pick`, "versus"],
    [`$100 vs $1,000: ${topic} Edition`, "versus"],
    [`Stop Overpaying for ${topic}`, "negative_command"],
    [`Don't Buy ${topic} Until You See This`, "negative_command"],
    [`Never Trust a ${topic} Review Again`, "negative_command"],
    [`Get Better ${topic} Results for Half the Price`, "outcome_promise"],
    [`The Exact ${topic} Setup That Works`, "outcome_promise"],
    [`How I Fixed My ${topic} in One Weekend`, "outcome_promise"],
    [`I Was Wrong About ${topic}`, "confession"],
    [`I Tested ${topic} So You Don't Have To`, "confession"],
    [`My ${topic} Mistake Cost Me $400`, "confession"],
    [`7 ${topic} Myths, Tested`, "listicle"],
    [`5 Things ${topic} Reviews Never Tell You`, "listicle"],
    [`3 ${topic} Upgrades That Actually Matter`, "listicle"],
    [`${topic} on a $200 Budget: Full Test`, "challenge"],
    [`One Week, One Rule: ${topic} Only`, "challenge"],
    [`Blind Testing ${topic} With Real Judges`, "challenge"],
    [`Expensive ${topic} Is a Scam (Sort Of)`, "contrarian"],
    [`The Popular ${topic} Advice Is Backwards`, "contrarian"],
    [`Why the Worst ${topic} Pick Won`, "contrarian"],
    [`The ${topic} Test Everyone Refuses to Run`, "curiosity_gap"],
  ];
  return seeds.map(([text, patternFamily]) => ({ text: text.slice(0, 100), patternFamily }));
}

export function synthTitleScores(titles: { text: string }[]): number[] {
  return titles.map((t) => {
    const seed = fnv1a(`score|${t.text}`);
    const lengthBonus = t.text.length <= 55 ? 8 : 0;
    return Math.min(95, 40 + (seed % 45) + lengthBonus);
  });
}

/** Valid families guard used when validating live output too. */
export function isKnownPatternFamily(family: string): boolean {
  return (TITLE_PATTERN_FAMILIES as readonly string[]).includes(family);
}

export interface SynthRevisionSuggestion {
  sectionIndex: number;
  lineStart: number;
  lineEnd: number;
  replacement: string;
  suggestion: string;
  rationale: string;
}

export function synthRevisionSuggestions(
  sections: { kind: string; body: string }[],
): SynthRevisionSuggestion[] {
  const out: SynthRevisionSuggestion[] = [];
  sections.forEach((section, index) => {
    if (out.length >= 3) return;
    if (section.kind !== "chapter" && section.kind !== "intro") return;
    const lines = section.body.split("\n");
    const first = lines[0];
    if (first === undefined || first.trim() === "") return;
    const sentences = first.split(". ");
    const head = sentences[0] ?? first;
    out.push({
      sectionIndex: index,
      lineStart: 1,
      lineEnd: 1,
      replacement:
        `${head.trim().replace(/\.$/, "")} — and this part is measurable. ${sentences.slice(1).join(". ")}`.trim(),
      suggestion: "Sharpen the opening line with a concrete promise.",
      rationale: "First line carries the section; a measurable promise beats a general one.",
    });
  });
  return out;
}
