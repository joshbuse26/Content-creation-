import { NextResponse } from "next/server";
import { z } from "zod";
import { assertAccess } from "@/lib/authz";
import { getConfig } from "@/lib/config";
import { asUserId, workspaceIdSchema } from "@/lib/types/ids";
import { signOauthState } from "@/server/channel/oauth-state";
import { getRoleResolver } from "@/server/membership";
import { clientIpFromRequest, enforceRateLimitHttp } from "@/server/ratelimit";
import { getSessionWithFixtureFallback } from "@/server/session";

/**
 * GET /api/channels/oauth/start?workspaceId=…
 *
 * Begins the incremental-consent YouTube connect flow (spec §5.1,
 * REQUESTS-A1 #4): redirects to Google's consent screen requesting
 * youtube.readonly offline access. The callback route finishes the dance.
 * `state` is HMAC-signed over the workspaceId so the callback can trust it.
 */

export const dynamic = "force-dynamic";

const OAUTH_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";

export async function GET(req: Request): Promise<Response> {
  const denied = await enforceRateLimitHttp("auth", `ip:${clientIpFromRequest(req)}`);
  if (denied !== null) return denied;
  const session = await getSessionWithFixtureFallback();
  const sessionUserId = session?.user.id ?? "";
  if (sessionUserId === "") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const parsed = z
    .object({ workspaceId: workspaceIdSchema })
    .safeParse({ workspaceId: url.searchParams.get("workspaceId") });
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid query" }, { status: 400 });
  }
  const { workspaceId } = parsed.data;

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

  const config = getConfig();
  if (config.GOOGLE_CLIENT_ID === undefined || config.GOOGLE_CLIENT_SECRET === undefined) {
    return NextResponse.json(
      { error: "Google OAuth is not configured — connect a public channel instead" },
      { status: 503 },
    );
  }

  const consent = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  consent.searchParams.set("client_id", config.GOOGLE_CLIENT_ID);
  consent.searchParams.set("redirect_uri", `${config.APP_URL}/api/channels/oauth/callback`);
  consent.searchParams.set("response_type", "code");
  consent.searchParams.set("scope", OAUTH_SCOPE);
  consent.searchParams.set("access_type", "offline");
  consent.searchParams.set("prompt", "consent");
  consent.searchParams.set("include_granted_scopes", "true");
  consent.searchParams.set("state", signOauthState(workspaceId, sessionUserId));
  return NextResponse.redirect(consent);
}
