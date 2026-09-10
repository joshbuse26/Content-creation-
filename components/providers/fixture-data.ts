import { z } from "zod";
import {
  FIXTURE_IDS,
  fixtureAvatar,
  fixtureChannel,
  fixtureChapterSet,
  fixtureDescription,
  fixtureFrame,
  fixtureLedgerEntry,
  fixtureMembership,
  fixturePipelineRun,
  fixtureProject,
  fixtureQualityReport,
  fixtureResearchDoc,
  fixtureRevision,
  fixtureScript,
  fixtureSections,
  fixtureSnapshot,
  fixtureTagSet,
  fixtureThumbnailConcept,
  fixtureTitleSet,
  fixtureUser,
  fixtureWorkspace,
} from "@/lib/fixtures";
import { frameSchema, revisionSchema, titleSetSchema } from "@/lib/types/entities";

/**
 * CLIENT-SIDE FIXTURE FALLBACK — dev/demo affordance, not product code.
 *
 * In fixture mode there is no way to sign in, so every tRPC call over HTTP
 * comes back UNAUTHORIZED and the stub routers' fixtures never reach the
 * screen. Until A0 synthesizes a fixture session in the tRPC context
 * (REQUESTS-A3.md #1), this map mirrors the contract stubs so the whole app
 * renders and is demoable with zero backend. Delete this file (and the link
 * in fixture-link.ts) once the server-side fixture session lands.
 *
 * Where the stub returns a single row, this returns a slightly richer set
 * (4 frame proposals, 3 pending revisions, 25 title options) so the screens
 * show their real information density.
 */

const queued = { pipelineRunIds: [FIXTURE_IDS.pipelineRun as string], status: "queued" as const };

// ---- richer demo rows (schema-validated so they can't drift) --------------

const frameStamp = { createdAt: fixtureFrame.createdAt, updatedAt: fixtureFrame.updatedAt };

export const demoFrames = z.array(frameSchema).parse([
  fixtureFrame,
  {
    ...fixtureFrame,
    id: "00000000-0000-4000-8000-0000000000f2",
    chosen: false,
    angle: "Every dollar audited: I price out exactly where a $2,000 espresso rig loses to $200",
    format: "essay",
    outcome: "subs",
    tone: "analytical, wry",
    targetMinutes: 10,
    keywords: ["espresso value", "coffee gear audit"],
    ...frameStamp,
  },
  {
    ...fixtureFrame,
    id: "00000000-0000-4000-8000-0000000000f3",
    chosen: false,
    angle: "Beginner build-along: assembling the $200 stack live, first shot to dialed-in",
    format: "tutorial",
    outcome: "watch_time",
    audienceSegment: "First espresso machine buyers",
    tone: "warm, step-by-step",
    targetMinutes: 15,
    keywords: ["first espresso machine", "budget setup guide"],
    ...frameStamp,
  },
  {
    ...fixtureFrame,
    id: "00000000-0000-4000-8000-0000000000f4",
    chosen: false,
    angle: "Reacting to the internet's worst 'budget espresso' advice — and testing it on camera",
    format: "reaction",
    outcome: "conversion",
    audienceSegment: "Viewers burned by bad gear advice",
    tone: "playful, myth-busting",
    targetMinutes: 12,
    keywords: ["espresso myths", "bad coffee advice"],
    ...frameStamp,
  },
]);

export const demoRevisions = z.array(revisionSchema).parse([
  fixtureRevision,
  {
    ...fixtureRevision,
    id: "00000000-0000-4000-8000-000000000051",
    sectionId: FIXTURE_IDS.sectionChapter1,
    suggestion: "Name the grinder budget split up front so the 60% claim lands harder.",
    diff: [
      {
        lineStart: 1,
        lineEnd: 1,
        replacement:
          "The machine is the boring part — $80 of this build. The grinder gets $120, and that's the whole thesis: grind consistency explains more of your shot quality than anything else once you're past the bottom shelf. Let's dial it in.",
      },
    ],
    rationale: "Concrete dollar amounts outperform percentages for retention in this niche.",
  },
  {
    ...fixtureRevision,
    id: "00000000-0000-4000-8000-000000000052",
    sectionId: FIXTURE_IDS.sectionCta,
    suggestion: "Cut the double CTA — keep the parts list, drop the subscribe joke.",
    diff: [
      {
        lineStart: 1,
        lineEnd: 1,
        replacement:
          "The full parts list with current prices is in the description — grab it before the sale prices rotate.",
      },
    ],
    rationale:
      "Two asks in one breath halves conversion on both; the parts list is the stronger pull.",
  },
]);

const titleFamilies: [string, string[]][] = [
  [
    "versus",
    [
      "$200 Espresso vs My $2,000 Rig (Blind Test)",
      "Budget Stack vs Dream Machine: Blind Espresso Showdown",
      "Cheap Grinder vs $900 Grinder — Same Beans, Blind Judges",
      "The $200 Setup vs Everything I Own",
      "David vs Goliath: Espresso Edition",
    ],
  ],
  [
    "curiosity_gap",
    [
      "The Cheap Espresso Setup That Fooled Everyone",
      "Nobody Could Tell Which Shot Cost 10x More",
      "What Actually Happens Below $250 in Espresso",
      "The Part of Your Espresso Budget That Does Nothing",
      "Three Blind Judges. One Awkward Result.",
    ],
  ],
  [
    "stakes",
    [
      "I Blind-Tested Budget Espresso. It Got Awkward.",
      "I Put My $2,000 Rig on the Line Against a Starter Kit",
      "If the Cheap Setup Wins, I'm Selling Everything",
      "My Most Expensive Mistake Was Winning This Test",
      "This Test Nearly Ended My Gear Addiction",
    ],
  ],
  [
    "negative_command",
    [
      "Stop Overspending on Espresso — Test Results Inside",
      "Don't Buy an Espresso Machine Until You See This Test",
      "Never Spend More Than $200 on Espresso Before Watching This",
      "Stop Blaming Your Machine. It's the Grinder.",
      "Don't Upgrade Yet: The Blind Test Says Otherwise",
    ],
  ],
  [
    "explainer",
    [
      "Where Your Espresso Money Actually Goes",
      "The Real Price of a Good Shot, Tested Blind",
      "How Much Espresso Quality Can $200 Buy?",
      "The Economics of Home Espresso, Measured",
      "Why Grinders Beat Machines: A Blind-Test Breakdown",
    ],
  ],
];

export const demoTitleSet = titleSetSchema.parse({
  ...fixtureTitleSet,
  options: titleFamilies.flatMap(([family, texts], fi) =>
    texts.map((text, ti) => ({
      text,
      patternFamily: family,
      score: Math.max(40, 95 - fi * 4 - ti * 6),
    })),
  ),
});

// ---- path -> response ------------------------------------------------------

type In = Record<string, unknown>;

function obj(input: unknown): In {
  return typeof input === "object" && input !== null ? (input as In) : {};
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function sectionById(input: unknown) {
  const id = obj(input).sectionId;
  return fixtureSections.find((s) => (s.id as string) === id) ?? fixtureSections[0];
}

const resolvers: Record<string, (input: unknown) => unknown> = {
  "workspace.list": () => [{ ...fixtureWorkspace, role: "owner" as const }],
  "workspace.get": () => fixtureWorkspace,
  "workspace.create": (i) => ({
    ...fixtureWorkspace,
    name: str(obj(i).name, fixtureWorkspace.name),
  }),
  "workspace.update": (i) => ({
    ...fixtureWorkspace,
    name: str(obj(i).name, fixtureWorkspace.name),
  }),
  "workspace.members": () => [{ ...fixtureMembership, user: fixtureUser }],
  "workspace.invite": (i) => ({ ...fixtureMembership, role: obj(i).role ?? "writer" }),
  "workspace.setRole": (i) => ({ ...fixtureMembership, role: obj(i).role ?? "writer" }),
  "workspace.removeMember": () => ({ removed: true }),

  "channel.list": () => [fixtureChannel],
  "channel.get": () => ({ ...fixtureChannel, latestSnapshot: fixtureSnapshot }),
  "channel.connectPublic": (i) => ({
    ...fixtureChannel,
    nicheKeywords: (obj(i).nicheKeywords as string[] | undefined) ?? fixtureChannel.nicheKeywords,
  }),
  "channel.sync": () => queued,
  "channel.updateNiche": (i) => ({
    ...fixtureChannel,
    nicheKeywords: (obj(i).nicheKeywords as string[] | undefined) ?? fixtureChannel.nicheKeywords,
  }),
  "channel.disconnect": () => ({ removed: true }),

  "avatar.get": () => fixtureAvatar,
  "avatar.update": (i) => {
    const fields = obj(obj(i).fields);
    return { ...fixtureAvatar, ...fields, lastEditedBy: fixtureUser.id };
  },
  "avatar.regenerate": () => queued,

  "project.list": () => [fixtureProject],
  "project.get": () => fixtureProject,
  "project.create": (i) => ({ ...fixtureProject, title: str(obj(i).title, fixtureProject.title) }),
  "project.update": (i) => {
    const { title, status } = obj(i);
    return {
      ...fixtureProject,
      ...(typeof title === "string" ? { title } : {}),
      ...(typeof status === "string" ? { status } : {}),
    };
  },
  "project.archive": () => ({ archived: true }),

  "research.list": () => {
    const { content: _content, ...meta } = fixtureResearchDoc;
    return [meta];
  },
  "research.get": () => fixtureResearchDoc,
  "research.search": () => queued,
  "research.importTranscript": (i) => ({
    ...fixtureResearchDoc,
    kind: "transcript" as const,
    sourceUrl: str(obj(i).youtubeVideoUrl, "https://example.com"),
    title: "Transcript import",
  }),
  "research.upload": (i) => ({
    ...fixtureResearchDoc,
    kind: "upload" as const,
    sourceUrl: null,
    title: str(obj(i).filename, "upload"),
  }),
  "research.remove": () => ({ removed: true }),

  "frame.list": () => demoFrames,
  "frame.propose": () => queued,
  "frame.choose": (i) => ({
    ...(demoFrames.find((f) => (f.id as string) === obj(i).frameId) ?? fixtureFrame),
    chosen: true,
  }),
  "frame.update": (i) => ({
    ...(demoFrames.find((f) => (f.id as string) === obj(i).frameId) ?? fixtureFrame),
    ...obj(obj(i).fields),
  }),

  "script.generate": () => ({ ...queued, scriptId: fixtureScript.id }),
  "script.get": () => ({
    script: fixtureScript,
    sections: fixtureSections,
    qualityReport: fixtureQualityReport,
  }),
  "script.listVersions": () => [fixtureScript],
  "script.updateSection": (i) => {
    const section = sectionById(i);
    const { heading, body } = obj(i);
    return {
      ...section,
      ...(typeof heading === "string" ? { heading } : {}),
      ...(typeof body === "string" ? { body } : {}),
    };
  },
  "script.regenerateSection": () => queued,
  "script.setSectionLock": (i) => ({ ...sectionById(i), locked: obj(i).locked === true }),
  "script.export": (i) => ({
    filename: `script-v${fixtureScript.version}.${obj(i).format === "teleprompter" ? "txt" : str(obj(i).format, "txt")}`,
    mimeType: "text/plain",
    content: fixtureSections.map((s) => `${s.heading}\n\n${s.body}`).join("\n\n---\n\n"),
    encoding: "utf8" as const,
  }),

  "revision.run": () => queued,
  "revision.list": () => demoRevisions,
  "revision.accept": (i) => {
    const rev =
      demoRevisions.find((r) => (r.id as string) === obj(i).revisionId) ?? fixtureRevision;
    const section = fixtureSections.find((s) => s.id === rev.sectionId) ?? fixtureSections[0];
    return { revision: { ...rev, status: "accepted" as const }, section };
  },
  "revision.reject": (i) => ({
    ...(demoRevisions.find((r) => (r.id as string) === obj(i).revisionId) ?? fixtureRevision),
    status: "rejected" as const,
  }),

  "titles.generate": () => queued,
  "titles.latest": () => demoTitleSet,

  "thumbnails.generate": () => queued,
  "thumbnails.list": () => [fixtureThumbnailConcept],
  "thumbnails.choose": () => ({ ...fixtureThumbnailConcept, status: "chosen" as const }),

  "description.generate": (i) => ({ ...fixtureDescription, mode: obj(i).mode ?? "informative" }),
  "description.list": () => [fixtureDescription],
  "description.update": (i) => ({ ...fixtureDescription, body: str(obj(i).body, "") }),

  "tags.generate": () => fixtureTagSet,
  "tags.latest": () => fixtureTagSet,
  "tags.update": (i) => ({ ...fixtureTagSet, tags: (obj(i).tags as string[] | undefined) ?? [] }),

  "chapters.derive": () => fixtureChapterSet,
  "chapters.latest": () => fixtureChapterSet,
  "chapters.update": (i) => ({
    ...fixtureChapterSet,
    entries: (obj(i).entries as typeof fixtureChapterSet.entries | undefined) ?? [],
  }),

  "dashboard.overview": () => ({
    creditBalance: fixtureWorkspace.creditBalance,
    projectCounts: { scripting: 1 },
    recentProjects: [fixtureProject],
    recentRuns: [fixturePipelineRun],
  }),

  "billing.summary": () => ({
    plan: fixtureWorkspace.plan,
    creditBalance: fixtureWorkspace.creditBalance,
    billingCycleAnchor: fixtureWorkspace.billingCycleAnchor,
    ledger: [fixtureLedgerEntry],
  }),
  "billing.checkout": (i) => ({
    checkoutUrl: `https://checkout.stripe.com/c/pay/fixture_${str(obj(i).plan, "starter")}`,
  }),
};

export function resolveFixtureResponse(
  path: string,
  input: unknown,
): { hit: true; data: unknown } | { hit: false } {
  const resolver = resolvers[path];
  if (resolver === undefined) return { hit: false };
  return { hit: true, data: resolver(input) };
}
