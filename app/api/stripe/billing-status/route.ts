import { NextResponse } from "next/server";
import { z } from "zod";
import { assertAccess } from "@/lib/authz";
import { asUserId, workspaceIdSchema } from "@/lib/types/ids";
import { getBillingStatus } from "@/server/billing/status";
import { isCreditExempt } from "@/server/credits";
import { getRoleResolver } from "@/server/membership";
import { clientIpFromRequest, enforceRateLimitHttp } from "@/server/ratelimit";
import { getSessionWithFixtureFallback } from "@/server/session";

/**
 * GET /api/stripe/billing-status?workspaceId=… — billing state the frozen
 * billing.summary contract cannot carry (read-only lockdown, grace clock,
 * pending plan change, overage usage). Auth mirrors the tRPC layer:
 * session, then assertAccess billing:read (admin+ per the role matrix).
 */

export const dynamic = "force-dynamic";

const querySchema = z.object({ workspaceId: workspaceIdSchema });

export async function GET(req: Request): Promise<Response> {
  const session = await getSessionWithFixtureFallback();
  const sessionUserId = session?.user.id ?? "";
  if (sessionUserId === "") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const denied = await enforceRateLimitHttp(
    "general",
    `billing-status:${sessionUserId}:${clientIpFromRequest(req)}`,
  );
  if (denied !== null) return denied;

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ workspaceId: url.searchParams.get("workspaceId") });
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid query" }, { status: 400 });
  }

  let role;
  try {
    role = await assertAccess(
      asUserId(sessionUserId),
      parsed.data.workspaceId,
      "billing",
      "read",
      getRoleResolver(),
    );
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const status = await getBillingStatus(parsed.data.workspaceId, {
    creditExempt: isCreditExempt(session?.user?.email, role),
  });
  if (status === null) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(status);
}
