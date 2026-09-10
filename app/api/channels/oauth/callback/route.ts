import { NextResponse } from "next/server";
import { z } from "zod";
import { assertAccess } from "@/lib/authz";
import { getConfig } from "@/lib/config";
import { logger } from "@/lib/logger";
import { asUserId, workspaceIdSchema } from "@/lib/types/ids";
import { getChannelDomainDeps } from "@/server/channel/deps";
import { getDefaultSyncEnqueuer } from "@/server/channel/jobs";
import { checkChannelLimit, getBillingStore } from "@/server/billing";
import { connectOauthChannel } from "@/server/channel/oauth";
import { verifyOauthState } from "@/server/channel/oauth-state";
import { getRoleResolver } from "@/server/membership";
import { clientIpFromRequest, enforceRateLimitHttp } from "@/server/ratelimit";
import { getSessionWithFixtureFallback } from "@/server/session";

/**
 * GET /api/channels/oauth/callback — completes the YouTube connect flow
 * (REQUESTS-A1 #4): exchanges the code, discovers the user's own channel id
 * (channels.list mine=true), and hands the plaintext refresh token to A1's
 * connectOauthChannel(), which encrypts + stores it and queues the first
 * sync + avatar generation. Redirects back to /channels either way; errors
 * land as a query flag the screen can surface.
 */

export const dynamic = "force-dynamic";

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
});

const channelsResponseSchema = z.object({
  items: z
    .array(z.object({ id: z.string().min(1) }))
    .min(1)
    .optional(),
});

function redirectToChannels(appUrl: string, error?: string): Response {
  const url = new URL("/channels", appUrl);
  if (error !== undefined) url.searchParams.set("connectError", error);
  return NextResponse.redirect(url);
}

export async function GET(req: Request): Promise<Response> {
  const denied = await enforceRateLimitHttp("auth", `ip:${clientIpFromRequest(req)}`);
  if (denied !== null) return denied;
  const config = getConfig();
  const session = await getSessionWithFixtureFallback();
  const sessionUserId = session?.user.id ?? "";
  if (sessionUserId === "") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (code === null || state === null) {
    return redirectToChannels(config.APP_URL, "missing_code");
  }
  // Verified against the signature, a 10-minute expiry, and the initiating
  // user — a state minted for someone else's session is rejected.
  const rawWorkspaceId = verifyOauthState(state, sessionUserId);
  const parsedWorkspace = workspaceIdSchema.safeParse(rawWorkspaceId);
  if (rawWorkspaceId === null || !parsedWorkspace.success) {
    return redirectToChannels(config.APP_URL, "bad_state");
  }
  const workspaceId = parsedWorkspace.data;

  try {
    await assertAccess(
      asUserId(sessionUserId),
      workspaceId,
      "channel",
      "create",
      getRoleResolver(),
    );
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (config.GOOGLE_CLIENT_ID === undefined || config.GOOGLE_CLIENT_SECRET === undefined) {
    return redirectToChannels(config.APP_URL, "oauth_not_configured");
  }

  try {
    // 1. Exchange the code for tokens.
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.GOOGLE_CLIENT_ID,
        client_secret: config.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${config.APP_URL}/api/channels/oauth/callback`,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) throw new Error(`token exchange failed (${String(tokenRes.status)})`);
    const tokens = tokenResponseSchema.parse(await tokenRes.json());
    if (tokens.refresh_token === undefined) {
      // Consent screen was skipped (no prompt=consent) — nothing to store.
      return redirectToChannels(config.APP_URL, "no_refresh_token");
    }

    // 2. Discover the user's own channel id with the fresh access token.
    const mineRes = await fetch(
      "https://www.googleapis.com/youtube/v3/channels?part=id&mine=true",
      {
        signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      },
    );
    if (!mineRes.ok) throw new Error(`channels.list mine failed (${String(mineRes.status)})`);
    const mine = channelsResponseSchema.parse(await mineRes.json());
    const channelId = mine.items?.[0]?.id;
    if (channelId === undefined) {
      return redirectToChannels(config.APP_URL, "no_channel");
    }

    // 3. Tier channel limit (spec §7) — only a genuinely NEW channel counts;
    // an oauth RE-connect of an already-connected channel is never blocked.
    const deps = await getChannelDomainDeps();
    const existingChannel = await deps.channelRepo.findByYoutubeId(workspaceId, channelId);
    if (existingChannel === null) {
      const plan = (await getBillingStore().getWorkspace(workspaceId))?.plan ?? "free";
      const currentChannels = await deps.channelRepo.list(workspaceId);
      if (!checkChannelLimit(plan, currentChannels.length).allowed) {
        return redirectToChannels(config.APP_URL, "channel_limit");
      }
    }

    // 4. Hand off to A1's domain logic (encrypts + stores, queues sync+avatar).
    await connectOauthChannel(deps, getDefaultSyncEnqueuer(), {
      workspaceId,
      channelIdOrHandle: channelId,
      refreshToken: tokens.refresh_token,
    });
    return redirectToChannels(config.APP_URL);
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "oauth channel connect failed",
    );
    return redirectToChannels(config.APP_URL, "connect_failed");
  }
}
