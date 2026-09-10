import { handlers } from "@/server/auth";
import { clientIpFromRequest, enforceRateLimitHttp } from "@/server/ratelimit";

/**
 * Auth.js route handlers, wrapped with rate limiting (spec §6: 5/min on
 * auth endpoints). State-changing/credential flows (all POSTs, plus GET
 * signin/callback/verify pages) carry the strict "auth" policy per client
 * IP; high-frequency session bookkeeping reads (session/csrf/providers)
 * carry the "general" policy so session polling cannot lock users out.
 */

type AuthHandler = (typeof handlers)["GET"];
type AuthRequest = Parameters<AuthHandler>[0];

const RELAXED_GET_SEGMENTS = new Set(["session", "csrf", "providers", "_log"]);

function policyFor(req: Request): "auth" | "general" {
  if (req.method !== "GET") return "auth";
  const segments = new URL(req.url).pathname.split("/").filter((s) => s !== "");
  const action = segments[2]; // /api/auth/<action>/...
  return action !== undefined && RELAXED_GET_SEGMENTS.has(action) ? "general" : "auth";
}

function limited(handler: AuthHandler): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const denied = await enforceRateLimitHttp(policyFor(req), `ip:${clientIpFromRequest(req)}`);
    if (denied !== null) return denied;
    return handler(req as AuthRequest);
  };
}

export const GET = limited(handlers.GET);
export const POST = limited(handlers.POST);
