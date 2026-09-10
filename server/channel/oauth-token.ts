import { z } from "zod";
import { getConfig } from "@/lib/config";
import { logger } from "@/lib/logger";
import type { Providers, YoutubeProvider } from "@/lib/providers/types";
import type { Channel } from "@/lib/types/entities";
import { decryptRefreshToken, TokenDecryptionError } from "./crypto";
import type { ChannelRepo } from "./repo";

/**
 * OAuth-mode YouTube access for background jobs (spec §5.1 mode="oauth").
 *
 * connectOauthChannel stores the (encrypted) refresh token; this module is
 * what finally USES it: a sync run for an oauth channel decrypts the token
 * just-in-time, mints a short-lived access token at Google's token
 * endpoint, and talks to the Data API as the channel owner. Any failure
 * (missing/undecryptable token, revoked grant, network) degrades to the
 * public API-key provider with a warning — a broken grant must not sink
 * the nightly sweep.
 */

const tokenResponseSchema = z.object({ access_token: z.string().min(1) });

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Exchange a (plaintext) refresh token for a short-lived access token. */
export async function mintAccessToken(
  refreshToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const config = getConfig();
  if (config.GOOGLE_CLIENT_ID === undefined || config.GOOGLE_CLIENT_SECRET === undefined) {
    throw new Error("Google OAuth client credentials are not configured");
  }
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: config.GOOGLE_CLIENT_ID,
      client_secret: config.GOOGLE_CLIENT_SECRET,
    }),
  });
  if (!res.ok) {
    throw new Error(`OAuth token refresh failed with status ${res.status}`);
  }
  return tokenResponseSchema.parse(await res.json()).access_token;
}

export interface ChannelYoutubeResolverDeps {
  channelRepo: Pick<ChannelRepo, "getRefreshTokenEnc">;
  providers: Pick<Providers, "youtube">;
  /** Injectable for tests. */
  mint?: (refreshToken: string) => Promise<string>;
  makeAuthedProvider?: (accessToken: string) => Promise<YoutubeProvider>;
}

async function defaultAuthedProvider(accessToken: string): Promise<YoutubeProvider> {
  const { LiveYoutube } = await import("@/lib/providers/live/youtube");
  return new LiveYoutube({ accessToken });
}

/**
 * Per-channel YouTube provider selection for sync runs: oauth channels in
 * live mode get an access-token-authenticated provider built from their
 * stored refresh token; everything else (public channels, fixture mode,
 * or any failure along the way) gets the default provider.
 */
export function makeChannelYoutubeResolver(
  deps: ChannelYoutubeResolverDeps,
): (channel: Channel) => Promise<YoutubeProvider> {
  return async (channel) => {
    if (channel.mode !== "oauth" || getConfig().PROVIDERS !== "live") {
      return deps.providers.youtube;
    }
    try {
      const encrypted = await deps.channelRepo.getRefreshTokenEnc(channel.workspaceId, channel.id);
      if (encrypted === null) {
        logger.warn(
          { channelId: channel.id },
          "oauth channel has no stored refresh token — syncing via public API",
        );
        return deps.providers.youtube;
      }
      const refreshToken = decryptRefreshToken(encrypted);
      const accessToken = await (deps.mint ?? mintAccessToken)(refreshToken);
      return await (deps.makeAuthedProvider ?? defaultAuthedProvider)(accessToken);
    } catch (err) {
      const reason =
        err instanceof TokenDecryptionError
          ? "stored refresh token could not be decrypted"
          : err instanceof Error
            ? err.message
            : String(err);
      logger.warn(
        { channelId: channel.id, reason },
        "oauth sync: falling back to the public YouTube provider",
      );
      return deps.providers.youtube;
    }
  };
}
