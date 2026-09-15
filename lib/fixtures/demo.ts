import type { AvatarFieldsPatch } from "@/server/channel/repo";
import type { UpsertNicheVideo } from "@/pipelines/ideation/store";
import type { Sophistication } from "@/lib/types/enums";

/**
 * Demo-channel seed data (channel.connectDemo) — a rich, realistic, entirely
 * SYNTHETIC YouTube channel a playtester can connect with ONE click, no real
 * channel and no Google/OAuth/GOOGLE_API_KEY required. It is seeded static
 * data, NOT a provider/API call, so it works identically in fixture and
 * live/production mode.
 *
 * ORIGINALITY: every string here is original, generic craft — no real
 * creator's name, handle, video id, or wording (seed-lint scans this file;
 * see tests/c3-seed-lint.test.ts). The handle is an obviously-fake
 * "@demo-creator" and all ids carry a "demo"/"dmo" marker.
 */

/** Stable identity for the demo channel (find-or-create is keyed on this id). */
export const DEMO_CHANNEL = {
  youtubeChannelId: "UCdemo0000000000000000001",
  title: "Demo Creator",
  handle: "@demo-creator",
  /** Generic, broadly-relatable niche (tech explainer) — lowercase keywords. */
  nicheKeywords: ["tech explainers", "gadget reviews", "how it works"],
} as const;

/** Snapshot stats for the demo channel (subs / lifetime views / 90-day median). */
export const DEMO_SNAPSHOT = {
  subs: 62_800,
  totalViews: 8_140_000,
  medianViews90d: 24_500,
} as const;

/**
 * A populated audience avatar so the avatar panel and avatar-in-context both
 * render richly. Sentence-case throughout to stay clear of the seed-lint
 * proper-name heuristic.
 */
export const DEMO_AVATAR_FIELDS: AvatarFieldsPatch = {
  ageRange: "22-38",
  genderSplit: "65% male / 35% female",
  geo: ["US", "UK", "CA", "IN", "AU"],
  sophistication: "intermediate" satisfies Sophistication,
  pains: [
    {
      pain: "overwhelmed by spec sheets and marketing hype when picking a laptop or phone",
      evidence: "recurring comment theme: 'which one should i actually buy'",
    },
    {
      pain: "burned before by an upgrade that felt no faster than the old device",
      evidence: "top questions ask whether a new model is 'worth it' at all",
    },
    {
      pain: "wants to understand how a gadget works, not just be told to buy it",
      evidence: "high retention on the 'here is what is actually happening' segments",
    },
  ],
  motivations: [
    {
      motivation: "make one confident purchase and stop second-guessing it",
      evidence: "saves and rewatches on the final-verdict chapters",
    },
    {
      motivation: "sound informed when friends ask for a recommendation",
      evidence: "long comments relaying the video's takeaways to other people",
    },
  ],
  vocabularyNotes:
    "comfortable with 'benchmark', 'refresh rate', 'throttling'; define 'thermal envelope' and 'ppi' on first use.",
};

/**
 * The niche outlier index (competitor + demo hits in the same niche) — 10
 * videos with varied outlier ratios, publish dates (recent, for velocity /
 * recency badges), view counts, and format tags so Discovery + enrichment
 * render richly. `nicheKeywords` overlap the demo channel's keywords so the
 * channel-scoped outlier query returns them. All obviously-fake ids/handles.
 *
 * `NOW_MS` is the seed reference "today" (2026-09-15); dates are computed
 * back from it so the recency bands are stable regardless of clock at import.
 */
const NOW_MS = Date.UTC(2026, 8, 15);
const daysAgo = (n: number): Date => new Date(NOW_MS - n * 86_400_000);
const REFRESHED = daysAgo(1);

interface DemoOutlierSeed {
  youtubeVideoId: string;
  channelYtid: string;
  title: string;
  publishedDaysAgo: number;
  viewCount: number;
  channelMedianViews: number;
  outlierRatio: number;
  formatTags: string[];
}

const DEMO_OUTLIER_SEEDS: DemoOutlierSeed[] = [
  {
    youtubeVideoId: "dmo_out_001",
    channelYtid: "UCdemoRival000000000000a1",
    title: "the cheap phone that quietly beats the flagships",
    publishedDaysAgo: 5,
    viewCount: 1_240_000,
    channelMedianViews: 96_000,
    outlierRatio: 12.9,
    formatTags: ["versus", "review"],
  },
  {
    youtubeVideoId: "dmo_out_002",
    channelYtid: "UCdemoRival000000000000a2",
    title: "why your laptop gets slower every year (and the fix)",
    publishedDaysAgo: 9,
    viewCount: 880_000,
    channelMedianViews: 110_000,
    outlierRatio: 8.0,
    formatTags: ["explainer"],
  },
  {
    youtubeVideoId: "dmo_out_003",
    channelYtid: "UCdemoRival000000000000a3",
    title: "i tested 8 budget earbuds so you don't have to",
    publishedDaysAgo: 14,
    viewCount: 1_610_000,
    channelMedianViews: 132_000,
    outlierRatio: 12.2,
    formatTags: ["listicle", "test"],
  },
  {
    youtubeVideoId: "dmo_out_004",
    channelYtid: "UCdemoRival000000000000a4",
    title: "the upgrade nobody tells you to make first",
    publishedDaysAgo: 21,
    viewCount: 540_000,
    channelMedianViews: 88_000,
    outlierRatio: 6.1,
    formatTags: ["explainer"],
  },
  {
    youtubeVideoId: "dmo_out_005",
    channelYtid: "UCdemoRival000000000000a5",
    title: "how a screen actually shows a billion colors",
    publishedDaysAgo: 28,
    viewCount: 2_050_000,
    channelMedianViews: 120_000,
    outlierRatio: 17.1,
    formatTags: ["explainer", "deep-dive"],
  },
  {
    youtubeVideoId: "dmo_out_006",
    channelYtid: "UCdemoRival000000000000a6",
    title: "spending more on a charger was a mistake",
    publishedDaysAgo: 34,
    viewCount: 410_000,
    channelMedianViews: 92_000,
    outlierRatio: 4.5,
    formatTags: ["story"],
  },
  {
    youtubeVideoId: "dmo_out_007",
    channelYtid: "UCdemoRival000000000000a7",
    title: "the settings menu that doubles your battery life",
    publishedDaysAgo: 41,
    viewCount: 1_320_000,
    channelMedianViews: 104_000,
    outlierRatio: 12.7,
    formatTags: ["tips", "explainer"],
  },
  {
    youtubeVideoId: "dmo_out_008",
    channelYtid: "UCdemoRival000000000000a8",
    title: "why fast charging is not as scary as you heard",
    publishedDaysAgo: 52,
    viewCount: 690_000,
    channelMedianViews: 98_000,
    outlierRatio: 7.0,
    formatTags: ["myth-busting"],
  },
  {
    youtubeVideoId: "dmo_out_009",
    channelYtid: "UCdemoRival000000000000a9",
    title: "i rebuilt my desk setup on a strict budget",
    publishedDaysAgo: 63,
    viewCount: 300_000,
    channelMedianViews: 90_000,
    outlierRatio: 3.3,
    formatTags: ["vlog", "build"],
  },
  {
    youtubeVideoId: "dmo_out_010",
    channelYtid: "UCdemoRival00000000000a10",
    title: "the one benchmark that finally made sense to me",
    publishedDaysAgo: 74,
    viewCount: 1_180_000,
    channelMedianViews: 112_000,
    outlierRatio: 10.5,
    formatTags: ["explainer", "story"],
  },
];

export const DEMO_NICHE_VIDEOS: UpsertNicheVideo[] = DEMO_OUTLIER_SEEDS.map((seed) => ({
  youtubeVideoId: seed.youtubeVideoId,
  channelYtid: seed.channelYtid,
  title: seed.title,
  thumbnailUrl: `https://i.ytimg.com/vi/${seed.youtubeVideoId}/hqdefault.jpg`,
  publishedAt: daysAgo(seed.publishedDaysAgo),
  viewCount: seed.viewCount,
  channelMedianViews: seed.channelMedianViews,
  outlierRatio: seed.outlierRatio,
  formatTags: seed.formatTags,
  nicheKeywords: [...DEMO_CHANNEL.nicheKeywords],
  lastRefreshedAt: REFRESHED,
}));

/**
 * The demo channel's OWN uploads, with transcripts, so `train_on_my_channel`
 * can derive a StyleCard from the demo channel — including in live mode, where
 * the real transcript provider cannot serve these synthetic ids. The train
 * path falls back to these seeded transcripts for a demo channel ONLY (see
 * server/voice/train.ts); real channels are never affected.
 *
 * Sentence-case, original narration in a consistent, teachable voice so the
 * derived StyleCard is coherent (calm explainer, plain-spoken, one payoff per
 * beat). Each transcript is short and original — never a pasted passage.
 */
interface DemoOwnVideo {
  youtubeVideoId: string;
  transcript: string;
}

export const DEMO_OWN_VIDEOS: DemoOwnVideo[] = [
  {
    youtubeVideoId: "dmo_own_001",
    transcript:
      "here is the thing nobody says out loud about upgrading your phone. most of the speed you feel is not the chip, it is the software getting out of its own way. so today i want to show you what is actually happening when a device feels fast, and where your money really goes. same test, same apps, i run every one of them myself. and honestly, the first result already surprised me.",
  },
  {
    youtubeVideoId: "dmo_own_002",
    transcript:
      "let me save you a bad purchase. the spec that gets the most marketing is almost never the one you notice day to day. i learned that the expensive way. so we are going to line these two up, keep everything else equal, and just watch what changes. no hype, no sponsor, just the numbers and my honest reaction when they came in.",
  },
  {
    youtubeVideoId: "dmo_own_003",
    transcript:
      "quick one today, but it might be the most useful thing i show you all month. there is a single setting buried three menus deep that quietly doubles how long your battery lasts. i will explain why it works, not just tell you to flip it, because once you understand the reason you will never forget it.",
  },
  {
    youtubeVideoId: "dmo_own_004",
    transcript:
      "everyone told me to spend more here, so i did, and it was a mistake. today i want to walk you through why, because the story is more interesting than the price tag. we will start with the claim everyone repeats, then i will show you the test that quietly proves it backwards.",
  },
  {
    youtubeVideoId: "dmo_own_005",
    transcript:
      "so you asked for this one a lot. how does a screen actually show a billion colors when it only has three. the short answer is clever math and your own eyes doing half the work. the long answer is way more fun, so grab a coffee, and let me show you the part that finally made it click for me.",
  },
  {
    youtubeVideoId: "dmo_own_006",
    transcript:
      "budget builds live or die on one decision, and it is not the one the ads point at. i rebuilt my whole desk setup under a strict limit, and the thing that mattered most cost the least. let me show you where to spend, where to save, and the one corner you should never cut.",
  },
];

/** Video ids of the demo channel's own uploads (train sampling order). */
export const DEMO_OWN_VIDEO_IDS: string[] = DEMO_OWN_VIDEOS.map((v) => v.youtubeVideoId);

/**
 * Seeded transcripts for the demo channel's own uploads, keyed by video id.
 * Used by the demo train fallback so training works with zero keys, in both
 * fixture and live mode. Optionally filtered to a caller-supplied subset.
 */
export function demoOwnTranscripts(onlyVideoIds?: readonly string[] | null): {
  videoIds: string[];
  texts: string[];
} {
  const wanted =
    onlyVideoIds != null && onlyVideoIds.length > 0
      ? DEMO_OWN_VIDEOS.filter((v) => onlyVideoIds.includes(v.youtubeVideoId))
      : DEMO_OWN_VIDEOS;
  const source = wanted.length > 0 ? wanted : DEMO_OWN_VIDEOS;
  return {
    videoIds: source.map((v) => v.youtubeVideoId),
    texts: source.map((v) => v.transcript),
  };
}
