import { NextResponse } from "next/server";
import { z } from "zod";
import { assertAccess } from "@/lib/authz";
import { asUserId, thumbnailConceptIdSchema, workspaceIdSchema } from "@/lib/types/ids";
import { getThumbnailConcept } from "@/pipelines/thumbnails";
import { getRoleResolver } from "@/server/membership";
import { clientIpFromRequest, enforceRateLimitHttp } from "@/server/ratelimit";
import { getSessionWithFixtureFallback } from "@/server/session";
import { getObjectStorage } from "@/server/storage";

/**
 * GET /api/thumbnail-image?workspaceId=…&conceptId=…
 *
 * Serves a generated thumbnail image from object storage. Auth mirrors the
 * tRPC layer: session required, then assertAccess (thumbnail:read), then
 * the concept's row-level workspace check — a missing concept and a foreign
 * concept are indistinguishable (404). The storage key is never accepted
 * from the client; it is resolved from the concept row server-side.
 */

export const dynamic = "force-dynamic";

const querySchema = z.object({
  workspaceId: workspaceIdSchema,
  conceptId: thumbnailConceptIdSchema,
});

export async function GET(req: Request): Promise<Response> {
  const session = await getSessionWithFixtureFallback();
  const sessionUserId = session?.user.id ?? "";
  if (sessionUserId === "") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const denied = await enforceRateLimitHttp(
    "general",
    `thumb:${sessionUserId}:${clientIpFromRequest(req)}`,
  );
  if (denied !== null) return denied;

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    workspaceId: url.searchParams.get("workspaceId"),
    conceptId: url.searchParams.get("conceptId"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid query" }, { status: 400 });
  }
  const { workspaceId, conceptId } = parsed.data;

  try {
    await assertAccess(
      asUserId(sessionUserId),
      workspaceId,
      "thumbnail",
      "read",
      getRoleResolver(),
    );
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const concept = await getThumbnailConcept(workspaceId, conceptId);
  if (concept === null || concept.imageKey === null) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const object = await getObjectStorage().get(concept.imageKey);
  if (object === null) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return new Response(new Uint8Array(object.data), {
    status: 200,
    headers: {
      "Content-Type": object.contentType,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
