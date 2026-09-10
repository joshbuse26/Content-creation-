import { z } from "zod";
import { getConfig } from "@/lib/config";
import type { SearchProvider, WebSearchResult } from "../types";

/** Live web search — Brave Search API. */

const responseSchema = z.object({
  web: z
    .object({
      results: z
        .array(
          z.object({
            url: z.string(),
            title: z.string(),
            description: z.string().default(""),
          }),
        )
        .default([]),
    })
    .optional(),
});

export class LiveSearch implements SearchProvider {
  async search(query: string, count: number): Promise<WebSearchResult[]> {
    const { SEARCH_API_KEY } = getConfig();
    if (SEARCH_API_KEY === undefined) {
      throw new Error("SEARCH_API_KEY is required for the live search provider");
    }
    const qs = new URLSearchParams({ q: query, count: String(Math.min(count, 20)) });
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${qs.toString()}`, {
      headers: { "X-Subscription-Token": SEARCH_API_KEY, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      throw new Error(`Search API failed with status ${res.status}`);
    }
    const data = responseSchema.parse((await res.json()) as unknown);
    return (data.web?.results ?? []).map((r) => ({
      url: r.url,
      title: r.title,
      snippet: r.description,
    }));
  }
}
