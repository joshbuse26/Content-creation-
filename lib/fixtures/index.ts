import { z } from "zod";
import {
  apiKeySchema,
  audienceAvatarSchema,
  channelSchema,
  channelStatsSnapshotSchema,
  chapterSetSchema,
  chatMessageSchema,
  chatThreadSchema,
  creditLedgerEntrySchema,
  descriptionSchema,
  descriptionTemplateSchema,
  frameSchema,
  ideaSchema,
  membershipSchema,
  nicheVideoSchema,
  pipelineRunSchema,
  projectSchema,
  researchDocSchema,
  revisionSchema,
  scriptSchema,
  scriptSectionSchema,
  sectionCommentSchema,
  tagSetSchema,
  thumbnailConceptSchema,
  titleSetSchema,
  trainStyleCardResultSchema,
  userSchema,
  voiceProfileSchema,
  workspaceSchema,
  type ChatMessage,
  type ScriptSection,
} from "@/lib/types/entities";
import { coachContextSchema } from "@/lib/types/chat";
import { CHAT_TOOL_NAMES } from "@/lib/types/enums";
import { contentTemplateSchema, qualityGateReportSchema } from "@/lib/types/pipeline";

/**
 * Deterministic fixtures — the data every stub router and fixture provider
 * returns. All objects are parsed through the frozen entity schemas at module
 * load, so a fixture that drifts from the contract fails tests immediately.
 *
 * IDs are stable UUIDs so wave-2 UI work and tests can reference them.
 */

export const FIXTURE_IDS = {
  workspace: "00000000-0000-4000-8000-000000000001",
  user: "00000000-0000-4000-8000-000000000002",
  membership: "00000000-0000-4000-8000-000000000003",
  channel: "00000000-0000-4000-8000-000000000010",
  snapshot: "00000000-0000-4000-8000-000000000011",
  avatar: "00000000-0000-4000-8000-000000000012",
  voiceProfile: "00000000-0000-4000-8000-000000000013",
  nicheVideo: "00000000-0000-4000-8000-000000000014",
  idea: "00000000-0000-4000-8000-000000000020",
  project: "00000000-0000-4000-8000-000000000030",
  researchDoc: "00000000-0000-4000-8000-000000000031",
  frame: "00000000-0000-4000-8000-000000000032",
  script: "00000000-0000-4000-8000-000000000040",
  sectionHook: "00000000-0000-4000-8000-000000000041",
  sectionIntro: "00000000-0000-4000-8000-000000000042",
  sectionChapter1: "00000000-0000-4000-8000-000000000043",
  sectionChapter2: "00000000-0000-4000-8000-000000000044",
  sectionCta: "00000000-0000-4000-8000-000000000045",
  sectionOutro: "00000000-0000-4000-8000-000000000046",
  revision: "00000000-0000-4000-8000-000000000050",
  titleSet: "00000000-0000-4000-8000-000000000060",
  thumbnailConcept: "00000000-0000-4000-8000-000000000061",
  description: "00000000-0000-4000-8000-000000000062",
  descriptionTemplate: "00000000-0000-4000-8000-000000000063",
  tagSet: "00000000-0000-4000-8000-000000000064",
  chapterSet: "00000000-0000-4000-8000-000000000065",
  pipelineRun: "00000000-0000-4000-8000-000000000070",
  ledgerEntry: "00000000-0000-4000-8000-000000000071",
  apiKey: "00000000-0000-4000-8000-000000000080",
  // Wave C: reserved for the partnered_named stub (no partner fixture row
  // exists while FEATURE_PARTNERED_NAMED is off; tests use this id).
  partner: "00000000-0000-4000-8000-000000000090",
  // A second workspace that the fixture user is NOT a member of — used by
  // cross-tenant denial tests.
  otherWorkspace: "00000000-0000-4000-8000-000000000099",
  // Wave D: chat + trained-voice fixtures (WAVE-D-PLAN §2a/§2c).
  voiceProfileTrained: "00000000-0000-4000-8000-0000000000a0",
  chatThread: "00000000-0000-4000-8000-0000000000b0",
  chatThreadWorkspace: "00000000-0000-4000-8000-0000000000b1",
  chatMessageUser: "00000000-0000-4000-8000-0000000000b2",
  chatMessageAssistant: "00000000-0000-4000-8000-0000000000b3",
  chatMessageTool: "00000000-0000-4000-8000-0000000000b4",
  // Wave E (E4): section comments + reusable content packs.
  sectionComment: "00000000-0000-4000-8000-0000000000c0",
  contentPackOutline: "00000000-0000-4000-8000-0000000000c1",
  contentPackHook: "00000000-0000-4000-8000-0000000000c2",
} as const;

const T0 = new Date("2026-09-01T12:00:00.000Z");
const T1 = new Date("2026-09-08T09:30:00.000Z");

const stamps = { createdAt: T0, updatedAt: T1 };

export const fixtureWorkspace = workspaceSchema.parse({
  id: FIXTURE_IDS.workspace,
  name: "Deep Dive Media",
  plan: "starter",
  creditBalance: 54,
  billingCycleAnchor: T0,
  ...stamps,
});

export const fixtureUser = userSchema.parse({
  id: FIXTURE_IDS.user,
  email: "casey@deepdivemedia.test",
  name: "Casey Rivera",
  image: null,
  ...stamps,
});

export const fixtureMembership = membershipSchema.parse({
  id: FIXTURE_IDS.membership,
  workspaceId: FIXTURE_IDS.workspace,
  userId: FIXTURE_IDS.user,
  role: "owner",
  ...stamps,
});

export const fixtureChannel = channelSchema.parse({
  id: FIXTURE_IDS.channel,
  workspaceId: FIXTURE_IDS.workspace,
  mode: "public",
  youtubeChannelId: "UCfixture0000000000000001",
  title: "Deep Dive with Casey",
  handle: "@deepdivecasey",
  nicheKeywords: ["home espresso", "coffee gear", "latte art"],
  syncStatus: "synced",
  lastSyncedAt: T1,
  ...stamps,
});

export const fixtureSnapshot = channelStatsSnapshotSchema.parse({
  id: FIXTURE_IDS.snapshot,
  workspaceId: FIXTURE_IDS.workspace,
  channelId: FIXTURE_IDS.channel,
  capturedAt: T1,
  subs: 48_200,
  totalViews: 6_490_000,
  medianViews90d: 21_400,
});

export const fixtureAvatar = audienceAvatarSchema.parse({
  id: FIXTURE_IDS.avatar,
  workspaceId: FIXTURE_IDS.workspace,
  channelId: FIXTURE_IDS.channel,
  ageRange: "25-40",
  genderSplit: "70% male / 30% female",
  geo: ["US", "UK", "CA", "AU"],
  sophistication: "intermediate",
  pains: [
    {
      pain: "Spent $700+ on an espresso setup and still pulls sour shots",
      evidence: "Recurring comment theme on dial-in videos",
    },
    {
      pain: "Overwhelmed by conflicting grinder advice",
      evidence: "Top search queries mention 'grinder worth it'",
    },
  ],
  motivations: [
    {
      motivation: "Cafe-quality drinks at home to justify the investment",
      evidence: "High retention on cost-per-cup segments",
    },
    {
      motivation: "Mastery and ritual — coffee as a craft hobby",
      evidence: "Long comments describing personal routines",
    },
  ],
  vocabularyNotes:
    "Comfortable with 'extraction', 'puck prep', 'RDT'; explain 'preinfusion' and pressure profiling on first use.",
  editableByUser: true,
  aiGeneratedAt: T0,
  lastEditedBy: null,
  ...stamps,
});

export const fixtureVoiceProfile = voiceProfileSchema.parse({
  id: FIXTURE_IDS.voiceProfile,
  workspaceId: FIXTURE_IDS.workspace,
  channelId: FIXTURE_IDS.channel,
  name: "Casey — default",
  source: "own_channel",
  // StyleCard v2 (PRODUCT-CONTRACTS §1) — a channel-learned card.
  styleCard: {
    voice: {
      pov: "First person singular, addresses viewer as 'you'.",
      diction: "Casual expert — first-name basis, zero jargon gatekeeping.",
      rhythm: "Short punchy sentences, then one long payoff sentence per beat.",
    },
    tone: {
      register: "Dry, self-deprecating; jokes land in asides, never in explanations.",
      never: "clickbait superlatives; trash-talking other creators",
    },
    pacing: { wpmTarget: 150, sectionSeconds: 90, rehookSeconds: 75 },
    hookPatterns: [
      {
        technique: "open_loop",
        guidance: "Tease the test result without revealing which way it went.",
      },
      {
        technique: "stakes",
        guidance: "Name the dollar amount on the line in the first two sentences.",
      },
    ],
    ctaHabits: {
      placement: "after_payoff",
      placementPct: null,
      phrasingStyle: "One dry, self-aware ask tied to the money just saved.",
      maxPerVideo: 1,
    },
    bannedClaims: ["guaranteed_results", "medical_claims"],
    readingLevel: { minGrade: 6, maxGrade: 9 },
    energy: 3,
    exampleSnippets: ["here's the thing", "let's dial it in"],
    thumbnailPresetId: null,
  },
  licenseDocUrl: null,
  licenseSignedAt: null,
  ...stamps,
});

export const fixtureNicheVideo = nicheVideoSchema.parse({
  id: FIXTURE_IDS.nicheVideo,
  youtubeVideoId: "dQfixture001",
  channelYtid: "UCother00000000000000001",
  title: "I Tested 12 Budget Grinders So You Don't Have To",
  thumbnailUrl: "https://i.ytimg.com/vi/dQfixture001/hqdefault.jpg",
  publishedAt: new Date("2026-08-20T15:00:00.000Z"),
  viewCount: 412_000,
  channelMedianViews: 38_000,
  outlierRatio: 10.84,
  formatTags: ["listicle", "test"],
  nicheKeywords: ["coffee gear"],
  lastRefreshedAt: T1,
});

export const fixtureIdea = ideaSchema.parse({
  id: FIXTURE_IDS.idea,
  workspaceId: FIXTURE_IDS.workspace,
  channelId: FIXTURE_IDS.channel,
  title: "The $200 Espresso Setup That Beats a $2,000 One",
  angle: "Cost-optimized gear stack validated by blind taste test",
  rationale:
    "Budget-stack videos are outperforming in the niche (3 outliers in 30 days); avatar pain is over-spending regret.",
  evidenceVideoIds: ["dQfixture001", "dQfixture002"],
  score: 87.5,
  status: "new",
  generatedOn: "2026-09-08",
  ...stamps,
});

export const fixtureProject = projectSchema.parse({
  id: FIXTURE_IDS.project,
  workspaceId: FIXTURE_IDS.workspace,
  channelId: FIXTURE_IDS.channel,
  title: "Budget espresso setup vs. the $2k rig",
  status: "scripting",
  ideaId: FIXTURE_IDS.idea,
  targetPublishDate: "2026-09-20",
  publishedVideoId: null,
  // Legacy (pre-mode) project: generation mode fields are null.
  generationMode: null,
  archetypeId: null,
  crossover: null,
  partnerId: null,
  ...stamps,
});

export const fixtureResearchDoc = researchDocSchema.parse({
  id: FIXTURE_IDS.researchDoc,
  workspaceId: FIXTURE_IDS.workspace,
  projectId: FIXTURE_IDS.project,
  kind: "web",
  sourceUrl: "https://example.com/espresso-extraction-science",
  title: "Research brief: budget espresso performance",
  content:
    "## Key findings\n\n- Entry-level machines with PID control hold brew temperature within ±1°C, closing most of the gap to prosumer machines (source: https://example.com/espresso-extraction-science).\n- Grind consistency explains more shot-quality variance than machine price above the $150 machine tier (source: https://example.com/grinder-particle-study).\n- Blind panels (n=24) could not distinguish shots from a $200 vs $1,800 setup when the same grinder was used (source: https://example.com/blind-taste-panel).\n",
  wordCount: 68,
  fetchedAt: T1,
  ...stamps,
});

export const fixtureFrame = frameSchema.parse({
  id: FIXTURE_IDS.frame,
  workspaceId: FIXTURE_IDS.workspace,
  projectId: FIXTURE_IDS.project,
  chosen: true,
  angle: "Blind-test a $200 stack against my $2,000 daily rig — where does the money actually go?",
  format: "challenge",
  outcome: "watch_time",
  audienceSegment: "Budget-conscious enthusiasts who already own basic gear",
  tone: "playful-rigorous",
  targetMinutes: 12,
  keywords: ["budget espresso", "espresso setup", "blind taste test"],
  ...stamps,
});

export const fixtureScript = scriptSchema.parse({
  id: FIXTURE_IDS.script,
  workspaceId: FIXTURE_IDS.workspace,
  projectId: FIXTURE_IDS.project,
  version: 1,
  voiceProfileId: FIXTURE_IDS.voiceProfile,
  status: "drafting",
  stats: { words: 1840, estRuntimeS: 736, readability: 68.4 },
  generationMode: null,
  archetypeId: null,
  crossover: null,
  partnerId: null,
  ...stamps,
});

const sectionBase = {
  workspaceId: FIXTURE_IDS.workspace,
  scriptId: FIXTURE_IDS.script,
  voiceProfileId: null,
  locked: false,
  ...stamps,
};

export const fixtureSections: ScriptSection[] = z.array(scriptSectionSchema).parse([
  {
    ...sectionBase,
    id: FIXTURE_IDS.sectionHook,
    position: 0,
    kind: "hook",
    heading: "Hook",
    body: "This espresso setup costs less than one month of your cafe habit — and in a blind test, it beat my two-thousand-dollar rig. I'm as annoyed about it as you are.",
    estSeconds: 22,
    retentionNote: "Open loop: which shot won stays hidden until 09:40.",
    factRefs: [
      {
        claim: "Blind panels could not distinguish $200 vs $1,800 setups with the same grinder",
        researchDocId: FIXTURE_IDS.researchDoc,
      },
    ],
  },
  {
    ...sectionBase,
    id: FIXTURE_IDS.sectionIntro,
    position: 1,
    kind: "intro",
    heading: "The rules of the test",
    body: "Here's the thing: same beans, same water, same barista — me. The only variable is the gear. Two stacks, five drinks each, scored blind by three people who drink way too much coffee.",
    estSeconds: 45,
    retentionNote: "Establish stakes fast; re-hook at 01:00.",
    factRefs: [],
  },
  {
    ...sectionBase,
    id: FIXTURE_IDS.sectionChapter1,
    position: 2,
    kind: "chapter",
    heading: "Building the $200 stack",
    body: "The machine is the boring part. The grinder is where every budget build lives or dies — grind consistency explains more of your shot quality than anything else once you're past the bottom shelf. So we're spending 60% of the budget there. Let's dial it in.",
    estSeconds: 180,
    retentionNote: "Re-hook at 03:00: tease the taste-off scoreboard.",
    factRefs: [
      {
        claim: "Grind consistency explains more shot-quality variance than machine price",
        researchDocId: FIXTURE_IDS.researchDoc,
      },
    ],
  },
  {
    ...sectionBase,
    id: FIXTURE_IDS.sectionChapter2,
    position: 3,
    kind: "chapter",
    heading: "The blind taste-off",
    body: "Five rounds. Straight shots, milk drinks, and one curveball — an iced americano, because that's what half of you actually order. The scorecards stay face-down until the end.",
    estSeconds: 300,
    retentionNote: "Payoff moved here from outro per retention pass.",
    factRefs: [],
  },
  {
    ...sectionBase,
    id: FIXTURE_IDS.sectionCta,
    position: 4,
    kind: "cta",
    heading: "CTA",
    body: "If you want the full parts list with current prices, it's in the description — and if this saved you from a four-figure mistake, the subscribe button is cheaper than a grinder.",
    estSeconds: 20,
    retentionNote: null,
    factRefs: [],
  },
  {
    ...sectionBase,
    id: FIXTURE_IDS.sectionOutro,
    position: 5,
    kind: "outro",
    heading: "Outro",
    body: "Next week I'm doing the same test with milk alternatives, and early results are genuinely weird. See you then.",
    estSeconds: 15,
    retentionNote: "Bridge to next video; end-screen 8s.",
    factRefs: [],
  },
]);

/** Wave C: the 12 seeded archetypes double as fixture rows — archetypes.list
 *  serves them keyless, and scripts/seed.ts inserts the same objects. */
export { ARCHETYPE_SEEDS as fixtureArchetypes } from "@/lib/archetypes";

export const fixtureQualityReport = qualityGateReportSchema.parse({
  passed: true,
  wordCount: 1840,
  targetWordCount: 1800,
  wordCountWithinTolerance: true,
  fleschReadingEase: 68.4,
  readabilityOk: true,
  estRuntimeSeconds: 736,
  hookSeconds: 22,
  hookOk: true,
  warnings: [],
  autoFixAttempted: false,
  /** Pre-wave-C report: no style card was in play. */
  styleGates: null,
});

export const fixtureRevision = revisionSchema.parse({
  id: FIXTURE_IDS.revision,
  workspaceId: FIXTURE_IDS.workspace,
  scriptId: FIXTURE_IDS.script,
  sectionId: FIXTURE_IDS.sectionIntro,
  suggestion: "Tighten the rules beat — move the scorer intro one sentence earlier.",
  diff: [
    {
      lineStart: 1,
      lineEnd: 1,
      replacement:
        "Same beans, same water, same barista — me. Three ruthless friends score everything blind.",
    },
  ],
  status: "pending",
  rationale:
    "The current order buries the credibility signal; scorers should appear before the format.",
  ...stamps,
});

export const fixtureTitleSet = titleSetSchema.parse({
  id: FIXTURE_IDS.titleSet,
  workspaceId: FIXTURE_IDS.workspace,
  projectId: FIXTURE_IDS.project,
  options: [
    { text: "$200 Espresso vs My $2,000 Rig (Blind Test)", patternFamily: "versus", score: 91 },
    {
      text: "The Cheap Espresso Setup That Fooled Everyone",
      patternFamily: "curiosity_gap",
      score: 88,
    },
    { text: "I Blind-Tested Budget Espresso. It Got Awkward.", patternFamily: "stakes", score: 84 },
    {
      text: "Stop Overspending on Espresso — Test Results Inside",
      patternFamily: "negative_command",
      score: 79,
    },
    { text: "Where Your Espresso Money Actually Goes", patternFamily: "explainer", score: 74 },
  ],
  ...stamps,
});

export const fixtureThumbnailConcept = thumbnailConceptSchema.parse({
  id: FIXTURE_IDS.thumbnailConcept,
  workspaceId: FIXTURE_IDS.workspace,
  projectId: FIXTURE_IDS.project,
  promptUsed:
    "Split-screen: shocked creator holding tiny espresso machine left, luxury machine right, bold '$200 vs $2000' text",
  compositionPattern: "split-screen",
  imageKey: null,
  status: "candidate",
  ...stamps,
});

export const fixtureDescription = descriptionSchema.parse({
  id: FIXTURE_IDS.description,
  workspaceId: FIXTURE_IDS.workspace,
  projectId: FIXTURE_IDS.project,
  mode: "informative",
  body: "I blind-tested a $200 espresso stack against my $2,000 daily setup — same beans, same water, three blind judges. Full parts list and current prices below.\n\n☕ The budget stack\n… \n\n⏱ Chapters below.",
  templateId: null,
  ...stamps,
});

export const fixtureDescriptionTemplate = descriptionTemplateSchema.parse({
  id: FIXTURE_IDS.descriptionTemplate,
  workspaceId: FIXTURE_IDS.workspace,
  name: "Gear video default",
  body: "{{summary}}\n\n🛠 Gear in this video:\n{{gear_list}}\n\n⏱ Chapters:\n{{chapters}}\n\n{{cta}}",
  ...stamps,
});

/**
 * A seeded section comment (E4) so the editor's comment thread and the
 * comments router render keyless. Authored by the fixture user on the hook
 * section, unresolved.
 */
export const fixtureSectionComment = sectionCommentSchema.parse({
  id: FIXTURE_IDS.sectionComment,
  workspaceId: FIXTURE_IDS.workspace,
  projectId: FIXTURE_IDS.project,
  scriptId: FIXTURE_IDS.script,
  sectionId: FIXTURE_IDS.sectionHook,
  authorUserId: FIXTURE_IDS.user,
  body: "Can we lead with the price reveal here? The hook buries it.",
  resolved: false,
  ...stamps,
});

/**
 * Seeded reusable content packs (E4): one outline pack + one hook pack, both
 * tagged to the fixture channel, so the "apply a pack" flow works keyless.
 */
export const fixtureContentPackOutline = contentTemplateSchema.parse({
  id: FIXTURE_IDS.contentPackOutline,
  workspaceId: FIXTURE_IDS.workspace,
  channelId: FIXTURE_IDS.channel,
  kind: "outline",
  name: "Gear review — proven shape",
  payload: {
    kind: "outline",
    outline: {
      sections: [
        {
          kind: "hook",
          heading: "The claim",
          purpose: "Open a loop on the core comparison",
          retentionNote: "Promise a surprising verdict",
          targetSeconds: 20,
        },
        {
          kind: "intro",
          heading: "What we're testing",
          purpose: "Set the stakes and the method",
          retentionNote: "Name the two contenders",
          targetSeconds: 40,
        },
        {
          kind: "chapter",
          heading: "Round one",
          purpose: "First head-to-head test",
          retentionNote: "Tease the gap widening",
          targetSeconds: 120,
        },
        {
          kind: "outro",
          heading: "The verdict",
          purpose: "Deliver the payoff and the takeaway",
          retentionNote: "Bridge to the next video",
          targetSeconds: 30,
        },
      ],
    },
  },
  ...stamps,
});

export const fixtureContentPackHook = contentTemplateSchema.parse({
  id: FIXTURE_IDS.contentPackHook,
  workspaceId: FIXTURE_IDS.workspace,
  channelId: FIXTURE_IDS.channel,
  kind: "hook_pack",
  name: "Comparison hooks that land",
  payload: {
    kind: "hook_pack",
    hooks: [
      { style: "bold_claim", body: "The cheap one won. I did not expect that.", autoPicked: true },
      {
        style: "open_loop",
        body: "One of these costs ten times more. You can't tell which from the cup.",
        autoPicked: false,
      },
      {
        style: "stakes",
        body: "I spent two grand so you don't have to. Here's where it actually matters.",
        autoPicked: false,
      },
    ],
  },
  ...stamps,
});

export const fixtureTagSet = tagSetSchema.parse({
  id: FIXTURE_IDS.tagSet,
  workspaceId: FIXTURE_IDS.workspace,
  projectId: FIXTURE_IDS.project,
  tags: [
    "budget espresso",
    "espresso setup",
    "home espresso",
    "coffee gear",
    "espresso machine review",
    "blind taste test",
    "cheap espresso machine",
    "coffee at home",
    "latte art",
    "espresso grinder",
    "barista basics",
    "coffee science",
    "espresso comparison",
    "best budget grinder",
    "home barista",
  ],
  ...stamps,
});

export const fixtureChapterSet = chapterSetSchema.parse({
  id: FIXTURE_IDS.chapterSet,
  workspaceId: FIXTURE_IDS.workspace,
  projectId: FIXTURE_IDS.project,
  entries: [
    { tsSeconds: 0, label: "The bet" },
    { tsSeconds: 22, label: "The rules of the test" },
    { tsSeconds: 67, label: "Building the $200 stack" },
    { tsSeconds: 247, label: "The blind taste-off" },
    { tsSeconds: 547, label: "Verdict + parts list" },
  ],
  ...stamps,
});

export const fixturePipelineRun = pipelineRunSchema.parse({
  id: FIXTURE_IDS.pipelineRun,
  workspaceId: FIXTURE_IDS.workspace,
  projectId: FIXTURE_IDS.project,
  kind: "script",
  stage: "draft_sections",
  status: "done",
  attempt: 1,
  inputHash: "f1x7ur3hash0000000000000000000000",
  error: null,
  creditsCharged: 6,
  startedAt: T1,
  finishedAt: new Date(T1.getTime() + 92_000),
  ...stamps,
});

export const fixtureLedgerEntry = creditLedgerEntrySchema.parse({
  id: FIXTURE_IDS.ledgerEntry,
  workspaceId: FIXTURE_IDS.workspace,
  delta: -6,
  reason: "script_generation",
  actorUserId: FIXTURE_IDS.user,
  projectId: FIXTURE_IDS.project,
  pipelineRunId: FIXTURE_IDS.pipelineRun,
  createdAt: T1,
});

export const fixtureApiKey = apiKeySchema.parse({
  id: FIXTURE_IDS.apiKey,
  workspaceId: FIXTURE_IDS.workspace,
  scopes: ["get_channel_stats", "get_idea_feed", "get_script"],
  channelIds: [FIXTURE_IDS.channel],
  lastUsedAt: T1,
  revokedAt: null,
  createdAt: T0,
});

// ---------------------------------------------------------------------------
// Wave D — trained voice + chat fixtures (WAVE-D-PLAN §2a/§2c)
// ---------------------------------------------------------------------------

/**
 * A source="trained" voice profile — first-class alongside the archetype
 * cards. The `voice.trainFromChannel` stub returns a card of this shape; D2
 * replaces the stub with the real transcript→LLM derivation.
 */
export const fixtureTrainedVoiceProfile = voiceProfileSchema.parse({
  id: FIXTURE_IDS.voiceProfileTrained,
  workspaceId: FIXTURE_IDS.workspace,
  channelId: FIXTURE_IDS.channel,
  name: "Casey — trained from channel",
  source: "trained",
  styleCard: {
    voice: {
      pov: "First person, talks to one viewer like a friend across the counter.",
      diction: "Plain-spoken expert; defines a term once, then uses it freely.",
      rhythm: "Mostly short sentences; one longer build before each payoff.",
    },
    tone: {
      register: "Warm, curious, quietly confident; jokes in the asides.",
      never: "condescending; hype without evidence",
    },
    pacing: { wpmTarget: 148, sectionSeconds: 85, rehookSeconds: 70 },
    hookPatterns: [
      { technique: "open_loop", guidance: "Pose the tension the video resolves; hold the answer." },
      { technique: "stakes", guidance: "Name what it costs the viewer to get this wrong." },
    ],
    ctaHabits: {
      placement: "after_payoff",
      placementPct: null,
      phrasingStyle: "One low-pressure ask tied to the value just delivered.",
      maxPerVideo: 1,
    },
    bannedClaims: ["guaranteed_results", "medical_claims"],
    readingLevel: { minGrade: 6, maxGrade: 9 },
    energy: 3,
    exampleSnippets: [],
    thumbnailPresetId: null,
  },
  licenseDocUrl: null,
  licenseSignedAt: null,
  trainedFromChannelId: FIXTURE_IDS.channel,
  trainedAt: T1,
  ...stamps,
});

/** Result shape returned by the `voice.trainFromChannel` stub. */
export const fixtureTrainStyleCardResult = trainStyleCardResultSchema.parse({
  voiceProfile: fixtureTrainedVoiceProfile,
  remix: false,
  sampledVideoIds: ["dQfixture001", "dQfixture002", "dQfixture003"],
});

/** Project-scoped chat thread (the common case: coaching one video). */
export const fixtureChatThread = chatThreadSchema.parse({
  id: FIXTURE_IDS.chatThread,
  workspaceId: FIXTURE_IDS.workspace,
  projectId: FIXTURE_IDS.project,
  title: "Budget espresso video — planning",
  ...stamps,
});

/** Workspace-level coach thread (projectId null). */
export const fixtureChatThreadWorkspace = chatThreadSchema.parse({
  id: FIXTURE_IDS.chatThreadWorkspace,
  workspaceId: FIXTURE_IDS.workspace,
  projectId: null,
  title: "Channel coach",
  ...stamps,
});

/**
 * An ordered message page for fixtureChatThread: a user ask, the assistant's
 * reply proposing a credit-costing tool, and the tool result after confirm.
 */
export const fixtureChatMessages: ChatMessage[] = z.array(chatMessageSchema).parse([
  {
    id: FIXTURE_IDS.chatMessageUser,
    threadId: FIXTURE_IDS.chatThread,
    workspaceId: FIXTURE_IDS.workspace,
    role: "user",
    content: "Give me some topic ideas for the budget espresso video.",
    toolCalls: null,
    toolCallId: null,
    creditsCharged: 0,
    seq: 0,
    createdAt: T0,
  },
  {
    id: FIXTURE_IDS.chatMessageAssistant,
    threadId: FIXTURE_IDS.chatThread,
    workspaceId: FIXTURE_IDS.workspace,
    role: "assistant",
    content:
      "Happy to. I can pull fresh topic candidates grounded in your niche and recent " +
      "outliers — that runs the topics tool (1 credit). Want me to?",
    toolCalls: [
      {
        toolCallId: "call_topics_1",
        name: "list_topics",
        args: { channelId: FIXTURE_IDS.channel, count: 5 },
        estimatedCredits: 1,
      },
    ],
    toolCallId: null,
    creditsCharged: 0,
    seq: 1,
    createdAt: new Date(T0.getTime() + 4_000),
  },
  {
    id: FIXTURE_IDS.chatMessageTool,
    threadId: FIXTURE_IDS.chatThread,
    workspaceId: FIXTURE_IDS.workspace,
    role: "tool",
    content: "Generated 5 topic candidates grounded in the channel niche.",
    toolCalls: null,
    toolCallId: "call_topics_1",
    creditsCharged: 1,
    seq: 2,
    createdAt: new Date(T0.getTime() + 9_000),
  },
]);

/**
 * A representative assembled CoachContext (the grounding buildCoachContext
 * returns for the fixture project). Self-validating via coachContextSchema.
 */
export const fixtureCoachContext = coachContextSchema.parse({
  workspaceId: FIXTURE_IDS.workspace,
  projectId: FIXTURE_IDS.project,
  projectTitle: "Budget espresso setup vs. the $2k rig",
  channelTitle: "Deep Dive with Casey",
  nicheKeywords: ["home espresso", "coffee gear", "latte art"],
  style: {
    source: "own_channel",
    archetypeId: null,
    card: fixtureVoiceProfile.styleCard,
  },
  audience: {
    sophistication: "intermediate",
    topPains: [
      "Spent $700+ on an espresso setup and still pulls sour shots",
      "Overwhelmed by conflicting grinder advice",
    ],
    topMotivations: [
      "Cafe-quality drinks at home to justify the investment",
      "Mastery and ritual — coffee as a craft hobby",
    ],
    vocabularyNotes:
      "Comfortable with 'extraction', 'puck prep', 'RDT'; explain 'preinfusion' on first use.",
  },
  research: {
    docCount: 1,
    totalWords: 68,
    titles: ["Research brief: budget espresso performance"],
  },
  uniqueAngle:
    "Blind-test a $200 stack against my $2,000 daily rig — where does the money actually go?",
  durationMinutes: 12,
});

/**
 * Expected per-tool credit estimates (WAVE-D-PLAN §2b). A static, keyless
 * fixture kept decoupled from lib/chat/tools.ts (which imports server code);
 * the D0 tools test cross-checks it against estimateToolCredits so the two
 * can never silently diverge.
 */
export const fixtureChatToolEstimates: Record<string, number> = z
  .record(z.enum(CHAT_TOOL_NAMES), z.number().int().nonnegative())
  .parse({
    list_topics: 1,
    make_outline: 1,
    make_hooks: 1,
    draft_script: 4,
    revise_section: 2,
    make_titles: 1,
    thumbnail_brief: 0,
    fetch_research: 1,
  });
