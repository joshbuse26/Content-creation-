import type {
  GeneratedImage,
  ImageProvider,
  ImageRequest,
  LlmProvider,
  LlmRequest,
  LlmResponse,
  Providers,
  SearchProvider,
  Transcript,
  TranscriptProvider,
  WebSearchResult,
  YoutubeProvider,
  YtChannel,
  YtSearchResult,
  YtVideoStats,
} from "./types";

/**
 * Fixture providers — deterministic, realistic, ZERO keys, zero network.
 * Same input → same output (seeded by an FNV-1a hash of the input), so
 * pipeline tests and UI work are reproducible.
 */

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

const pick = <T>(arr: readonly T[], seed: number): T => {
  const item = arr[seed % arr.length];
  if (item === undefined) throw new Error("pick from empty array");
  return item;
};

// ---------------------------------------------------------------------------
// LLM
// ---------------------------------------------------------------------------

const CANNED_COMPLETIONS = [
  "Here's the thing about this topic: the conventional wisdom is mostly backwards, and the data shows why. Let's break it down step by step, starting with the claim everyone repeats and nobody tests.",
  "Three things matter here, and only one of them costs money. First, consistency beats intensity. Second, the tooling gap is smaller than the marketing implies. Third — and this is the part nobody tells you — the skill ceiling is where the real difference lives.",
  "The short answer is yes, with one important caveat. The long answer involves a test I ran for two weeks, a spreadsheet I regret starting, and a result that genuinely surprised me.",
] as const;

class FixtureLlm implements LlmProvider {
  complete(req: LlmRequest): Promise<LlmResponse> {
    const seed = fnv1a(`${req.model}|${req.system ?? ""}|${req.prompt}`);
    const text = pick(CANNED_COMPLETIONS, seed);
    return Promise.resolve({
      text,
      inputTokens: Math.ceil(req.prompt.length / 4),
      outputTokens: Math.ceil(text.length / 4),
      stopReason: "end_turn",
    });
  }

  async *stream(req: LlmRequest): AsyncIterable<string> {
    const { text } = await this.complete(req);
    const words = text.split(" ");
    for (let i = 0; i < words.length; i += 8) {
      yield words.slice(i, i + 8).join(" ") + (i + 8 < words.length ? " " : "");
    }
  }
}

// ---------------------------------------------------------------------------
// YouTube
// ---------------------------------------------------------------------------

const FIXTURE_YT_CHANNEL: YtChannel = {
  youtubeChannelId: "UCfixture0000000000000001",
  title: "Deep Dive with Casey",
  handle: "@deepdivecasey",
  subs: 48_200,
  totalViews: 6_490_000,
  videoCount: 214,
  uploadsPlaylistId: "UUfixture0000000000000001",
};

const VIDEO_TITLES = [
  "I Tested 12 Budget Grinders So You Don't Have To",
  "The $200 Espresso Setup That Beats a $2,000 One",
  "Why Your Shots Taste Sour (It's Not the Beans)",
  "Latte Art in 30 Days: Honest Progress",
  "The Grinder Upgrade Nobody Talks About",
  "Cafe Owner Reacts to My Home Setup",
  "5 Espresso Myths That Cost You Money",
  "How I Dial In a New Bag in 3 Shots",
] as const;

class FixtureYoutube implements YoutubeProvider {
  getChannel(idOrHandle: string): Promise<YtChannel> {
    const seed = fnv1a(idOrHandle);
    return Promise.resolve({
      ...FIXTURE_YT_CHANNEL,
      subs: 10_000 + (seed % 90_000),
      totalViews: 1_000_000 + (seed % 9_000_000),
    });
  }

  listRecentVideoIds(uploadsPlaylistId: string, max: number): Promise<string[]> {
    const seed = fnv1a(uploadsPlaylistId);
    const n = Math.min(max, 50);
    return Promise.resolve(
      Array.from({ length: n }, (_, i) => `fx${((seed + i * 7919) >>> 0).toString(36).padStart(9, "0")}`),
    );
  }

  getVideoStats(videoIds: string[]): Promise<YtVideoStats[]> {
    return Promise.resolve(
      videoIds.map((id) => {
        const seed = fnv1a(id);
        const daysAgo = seed % 365;
        return {
          youtubeVideoId: id,
          title: pick(VIDEO_TITLES, seed),
          publishedAt: new Date(Date.UTC(2026, 8, 9) - daysAgo * 86_400_000).toISOString(),
          viewCount: 1_000 + (seed % 500_000),
          likeCount: 100 + (seed % 20_000),
          commentCount: 10 + (seed % 2_000),
          durationSeconds: 300 + (seed % 900),
          thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
          channelYtid: FIXTURE_YT_CHANNEL.youtubeChannelId,
        };
      }),
    );
  }

  searchVideos(query: string, _publishedAfterIso?: string): Promise<YtSearchResult[]> {
    const seed = fnv1a(query);
    return Promise.resolve(
      Array.from({ length: 8 }, (_, i) => {
        const s = (seed + i * 104_729) >>> 0;
        const id = `sr${s.toString(36).padStart(9, "0")}`;
        return {
          youtubeVideoId: id,
          channelYtid: `UCsearch${(s % 1_000_000).toString().padStart(16, "0")}`,
          title: `${pick(VIDEO_TITLES, s)} (${query})`,
          publishedAt: new Date(Date.UTC(2026, 8, 9) - (s % 90) * 86_400_000).toISOString(),
          thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        };
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Transcripts
// ---------------------------------------------------------------------------

const TRANSCRIPT_LINES = [
  "so today we're finally doing the test you've all been asking for",
  "the rules are simple same beans same water and I pull every shot myself",
  "and honestly the first result already surprised me",
  "the grinder matters more than the machine and here's the data to prove it",
  "if you're on a budget this is the one place you should not cut corners",
  "let me show you what happened when I ran this five more times",
] as const;

class FixtureTranscript implements TranscriptProvider {
  getTranscript(youtubeVideoId: string): Promise<Transcript> {
    const seed = fnv1a(youtubeVideoId);
    const segments = Array.from({ length: 6 }, (_, i) => ({
      startSeconds: i * 12,
      text: pick(TRANSCRIPT_LINES, seed + i),
    }));
    return Promise.resolve({
      youtubeVideoId,
      language: "en",
      segments,
      fullText: segments.map((s) => s.text).join(" "),
    });
  }
}

// ---------------------------------------------------------------------------
// Web search
// ---------------------------------------------------------------------------

const SEARCH_DOMAINS = [
  "https://coffeechronicle.example.com",
  "https://extractionlab.example.org",
  "https://homebarista.example.net",
  "https://gearbench.example.com",
] as const;

class FixtureSearch implements SearchProvider {
  search(query: string, count: number): Promise<WebSearchResult[]> {
    const seed = fnv1a(query);
    const slug = query
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 60);
    return Promise.resolve(
      Array.from({ length: Math.min(count, 8) }, (_, i) => ({
        url: `${pick(SEARCH_DOMAINS, seed + i)}/articles/${slug}-${i + 1}`,
        title: `${query} — field notes ${i + 1}`,
        snippet: `An in-depth look at ${query}: methodology, measured results, and where the popular advice breaks down.`,
      })),
    );
  }
}

// ---------------------------------------------------------------------------
// Image generation
// ---------------------------------------------------------------------------

/** 1x1 opaque PNG — a valid, deterministic placeholder. */
const ONE_PX_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

class FixtureImage implements ImageProvider {
  generate(req: ImageRequest): Promise<GeneratedImage[]> {
    return Promise.resolve(
      Array.from(
        { length: req.count },
        (): GeneratedImage => ({ url: null, base64Png: ONE_PX_PNG }),
      ),
    );
  }
}

export function createFixtureProviders(): Providers {
  return {
    llm: new FixtureLlm(),
    youtube: new FixtureYoutube(),
    transcript: new FixtureTranscript(),
    search: new FixtureSearch(),
    image: new FixtureImage(),
  };
}
