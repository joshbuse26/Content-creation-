import { NextResponse } from "next/server";
import { getProviders } from "@/lib/providers";
import { logger } from "@/lib/logger";
import { clientIpFromRequest, enforceRateLimitHttp } from "@/server/ratelimit";
import { freeToolRequestSchema, runFreeTool } from "@/server/tools";

/**
 * POST /api/tools — the shared endpoint behind the free standalone tools
 * (spec §6): NO auth, IP rate limited (freeTools policy — 5/day/IP), fast
 * tier only (enforced in server/tools/run.ts), no user-supplied fetching
 * (no SSRF surface). Errors are generic; details go to logs only.
 */

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8 * 1024;

export async function POST(req: Request): Promise<Response> {
  const ip = clientIpFromRequest(req);
  const denied = await enforceRateLimitHttp("freeTools", `tools:${ip}`);
  if (denied !== null) return denied;

  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Request too large." }, { status: 413 });
    }
    raw = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = freeToolRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const { llm } = await getProviders();
    const result = await runFreeTool(llm, parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    logger.error(
      { tool: parsed.data.tool, err: err instanceof Error ? err.message : String(err) },
      "free tool generation failed",
    );
    return NextResponse.json({ error: "Generation failed. Try again shortly." }, { status: 500 });
  }
}
