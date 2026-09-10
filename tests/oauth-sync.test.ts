import { beforeEach, describe, expect, it, vi } from "vitest";
import type { YoutubeProvider } from "@/lib/providers/types";

/**
 * Regression tests for the oauth sync path: channels connected in oauth
 * mode sync using their stored (encrypted) refresh token — decrypted
 * just-in-time, exchanged for an access token, and used through an authed
 * YouTube provider — with graceful fallback to the public provider.
 */

const fakeConfig = vi.hoisted(() => ({
  NODE_ENV: "test",
  PROVIDERS: "live",
  LOG_LEVEL: "info",
  AUTH_SECRET: "test-secret-for-oauth-sync",
  CHANNEL_TOKEN_SECRET: undefined as string | undefined,
  GOOGLE_CLIENT_ID: "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret",
}));

vi.mock("@/lib/config", async (importOriginal) => {
  const actual: Record<string, unknown> = await importOriginal();
  return { ...actual, getConfig: () => fakeConfig };
});

import { asWorkspaceId } from "@/lib/types/ids";
import { encryptRefreshToken } from "@/server/channel/crypto";
import { makeChannelYoutubeResolver, mintAccessToken } from "@/server/channel/oauth-token";
import { InMemoryChannelStore } from "@/server/channel/repo";

const workspaceId = asWorkspaceId("00000000-0000-4000-8000-000000000001");

const publicProvider = { marker: "public" } as unknown as YoutubeProvider;
const authedProvider = { marker: "authed" } as unknown as YoutubeProvider;

async function seed(
  store: InMemoryChannelStore,
  mode: "public" | "oauth",
  tokenEnc: string | null,
) {
  return store.create({
    workspaceId,
    mode,
    youtubeChannelId: "UCoauthsync000000000000001",
    title: "OAuth Sync",
    handle: "@oauthsync",
    nicheKeywords: [],
    oauthRefreshTokenEnc: tokenEnc,
  });
}

describe("makeChannelYoutubeResolver", () => {
  beforeEach(() => {
    fakeConfig.PROVIDERS = "live";
  });

  it("uses the stored refresh token for oauth channels in live mode", async () => {
    const store = new InMemoryChannelStore();
    const channel = await seed(store, "oauth", encryptRefreshToken("rt-secret-123"));
    const minted: string[] = [];
    const resolver = makeChannelYoutubeResolver({
      channelRepo: store,
      providers: { youtube: publicProvider },
      mint: (refreshToken) => {
        minted.push(refreshToken);
        return Promise.resolve("at-456");
      },
      makeAuthedProvider: (accessToken) => {
        expect(accessToken).toBe("at-456");
        return Promise.resolve(authedProvider);
      },
    });
    await expect(resolver(channel)).resolves.toBe(authedProvider);
    // The stored ciphertext was decrypted back to the original token.
    expect(minted).toEqual(["rt-secret-123"]);
  });

  it("uses the public provider for public-mode channels", async () => {
    const store = new InMemoryChannelStore();
    const channel = await seed(store, "public", null);
    const resolver = makeChannelYoutubeResolver({
      channelRepo: store,
      providers: { youtube: publicProvider },
      mint: () => Promise.reject(new Error("must not mint")),
    });
    await expect(resolver(channel)).resolves.toBe(publicProvider);
  });

  it("never mints in fixture mode", async () => {
    fakeConfig.PROVIDERS = "fixture";
    const store = new InMemoryChannelStore();
    const channel = await seed(store, "oauth", encryptRefreshToken("rt"));
    const resolver = makeChannelYoutubeResolver({
      channelRepo: store,
      providers: { youtube: publicProvider },
      mint: () => Promise.reject(new Error("must not mint")),
    });
    await expect(resolver(channel)).resolves.toBe(publicProvider);
  });

  it("falls back to the public provider when the token is missing or undecryptable", async () => {
    const store = new InMemoryChannelStore();
    const missing = await seed(store, "oauth", null);
    const resolver = makeChannelYoutubeResolver({
      channelRepo: store,
      providers: { youtube: publicProvider },
      mint: () => Promise.resolve("at"),
      makeAuthedProvider: () => Promise.resolve(authedProvider),
    });
    await expect(resolver(missing)).resolves.toBe(publicProvider);

    const store2 = new InMemoryChannelStore();
    const garbage = await seed(store2, "oauth", "v1.not.a.token");
    const resolver2 = makeChannelYoutubeResolver({
      channelRepo: store2,
      providers: { youtube: publicProvider },
      mint: () => Promise.resolve("at"),
      makeAuthedProvider: () => Promise.resolve(authedProvider),
    });
    await expect(resolver2(garbage)).resolves.toBe(publicProvider);
  });

  it("falls back when minting fails (revoked grant)", async () => {
    const store = new InMemoryChannelStore();
    const channel = await seed(store, "oauth", encryptRefreshToken("rt"));
    const resolver = makeChannelYoutubeResolver({
      channelRepo: store,
      providers: { youtube: publicProvider },
      mint: () => Promise.reject(new Error("invalid_grant")),
      makeAuthedProvider: () => Promise.resolve(authedProvider),
    });
    await expect(resolver(channel)).resolves.toBe(publicProvider);
  });
});

describe("mintAccessToken", () => {
  it("exchanges the refresh token at Google's token endpoint", async () => {
    const calls: { url: string; body: string }[] = [];
    const fetchImpl = (url: string, init: RequestInit) => {
      calls.push({ url, body: (init.body as URLSearchParams).toString() });
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: "at-999" }), { status: 200 }),
      );
    };
    await expect(mintAccessToken("rt-1", fetchImpl)).resolves.toBe("at-999");
    expect(calls[0]?.url).toBe("https://oauth2.googleapis.com/token");
    expect(calls[0]?.body).toContain("grant_type=refresh_token");
    expect(calls[0]?.body).toContain("refresh_token=rt-1");
  });

  it("throws on a non-OK token response", async () => {
    const fetchImpl = () => Promise.resolve(new Response("nope", { status: 400 }));
    await expect(mintAccessToken("rt-1", fetchImpl)).rejects.toThrow(/status 400/);
  });
});
