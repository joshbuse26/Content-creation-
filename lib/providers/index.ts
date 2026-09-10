import { getConfig } from "@/lib/config";
import { createFixtureProviders } from "./fixture";
import type { Providers } from "./types";

export type * from "./types";

let cached: Providers | undefined;

/**
 * Provider selection — `PROVIDERS=fixture` (default, zero keys) or
 * `PROVIDERS=live` (real APIs; config fails fast if keys are missing).
 *
 * Live classes are imported lazily so fixture mode never evaluates SDK code.
 */
export async function getProviders(): Promise<Providers> {
  if (cached !== undefined) return cached;
  const { PROVIDERS } = getConfig();
  if (PROVIDERS === "fixture") {
    cached = createFixtureProviders();
    return cached;
  }
  const { LLM_BACKEND } = getConfig();
  const [llm, { LiveYoutube }, { LiveTranscript }, { LiveSearch }, { LiveImage }] =
    await Promise.all([
      LLM_BACKEND === "grok"
        ? import("./live/grok").then(({ GrokLlm }) => new GrokLlm())
        : import("./live/llm").then(({ AnthropicLlm }) => new AnthropicLlm()),
      import("./live/youtube"),
      import("./live/transcript"),
      import("./live/search"),
      import("./live/image"),
    ]);
  cached = {
    llm,
    youtube: new LiveYoutube(),
    transcript: new LiveTranscript(),
    search: new LiveSearch(),
    image: new LiveImage(),
  };
  return cached;
}

/** Test hook: clear the memoized provider set. */
export function resetProvidersForTests(): void {
  cached = undefined;
}
