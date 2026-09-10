import type { Session } from "next-auth";
import { getConfig } from "@/lib/config";
import { FIXTURE_IDS, fixtureUser } from "@/lib/fixtures";
import { auth } from "@/server/auth";

/**
 * Session resolution for API routes (tRPC + SSE).
 *
 * In fixture mode there is no sign-in path, so a missing session is
 * synthesized for the fixture user — real HTTP calls then flow through the
 * genuine tRPC stack (authz middleware included) instead of a client-side
 * fixture shim (REQUESTS-A3 #1). PROVIDERS=live keeps real sessions only.
 *
 * SECURITY: fixture-session synthesis must never activate in production —
 * it would hand every unauthenticated visitor a signed-in session. Config
 * parsing already refuses NODE_ENV=production + PROVIDERS=fixture at
 * startup (lib/config.ts); the NODE_ENV check here is defense in depth.
 */
export async function getSessionWithFixtureFallback(): Promise<Session | null> {
  const session = await auth();
  if (session !== null) return session;
  const config = getConfig();
  if (config.PROVIDERS !== "fixture" || config.NODE_ENV === "production") return null;
  return {
    user: {
      id: FIXTURE_IDS.user,
      email: fixtureUser.email,
      name: fixtureUser.name,
    },
    expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
}
