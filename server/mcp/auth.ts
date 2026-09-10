import { and, asc, eq } from "drizzle-orm";
import { getDb, hasDb, schema } from "@/db";
import { logger } from "@/lib/logger";
import type { ApiKey } from "@/lib/types/entities";
import { asUserId, type UserId } from "@/lib/types/ids";
import { getSharedWorkspaceStore } from "@/server/workspace/memory";
import { getApiKeyStore, hashApiKeySecret } from "./keys";

/**
 * MCP authentication — `Authorization: Bearer <api_key>` → SHA-256 hash →
 * api_keys lookup (build spec §6). Revoked keys are rejected with the same
 * generic message as unknown ones so key validity is not probeable beyond
 * what the caller already holds.
 *
 * Every MCP call acts AS the key's workspace owner: api_keys carries no
 * user column in the frozen schema, and keys are owner-only to create, so
 * the owner is the honest actor for authz, rate limits and the credit
 * ledger's actor_user_id.
 */

export class McpAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpAuthError";
  }
}

export interface McpAuthContext {
  key: ApiKey;
  actorUserId: UserId;
}

const INVALID = "Invalid or revoked API key";

function bearerToken(authorizationHeader: string | null): string | null {
  if (authorizationHeader === null) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  const token = match?.[1]?.trim();
  return token === undefined || token === "" ? null : token;
}

async function resolveWorkspaceOwner(workspaceId: ApiKey["workspaceId"]): Promise<UserId | null> {
  if (!hasDb()) {
    const membership = getSharedWorkspaceStore().memberships.find(
      (m) => m.workspaceId === workspaceId && m.role === "owner",
    );
    return membership?.userId ?? null;
  }
  const rows = await getDb()
    .select({ userId: schema.memberships.userId })
    .from(schema.memberships)
    .where(
      and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.role, "owner")),
    )
    .orderBy(asc(schema.memberships.createdAt))
    .limit(1);
  const userId = rows[0]?.userId;
  return userId === undefined ? null : asUserId(userId);
}

/** Throws McpAuthError (→ HTTP 401) unless the bearer key is live. */
export async function authenticateApiKey(
  authorizationHeader: string | null,
): Promise<McpAuthContext> {
  const token = bearerToken(authorizationHeader);
  if (token === null) {
    throw new McpAuthError("Missing bearer token — send `Authorization: Bearer <api_key>`");
  }
  const stored = await getApiKeyStore().findByHash(hashApiKeySecret(token));
  if (stored === null || stored.revokedAt !== null) {
    throw new McpAuthError(INVALID);
  }
  const actorUserId = await resolveWorkspaceOwner(stored.workspaceId);
  if (actorUserId === null) {
    // A workspace always has an owner (last-owner guard); treat the
    // orphaned-key edge as an invalid key rather than leaking state.
    logger.error({ apiKeyId: stored.id }, "mcp key belongs to a workspace with no owner");
    throw new McpAuthError(INVALID);
  }
  const now = new Date();
  try {
    await getApiKeyStore().touchLastUsed(stored.id, now);
  } catch (err) {
    // last_used_at is best-effort telemetry — never fail the call over it.
    logger.warn(
      { apiKeyId: stored.id, err: err instanceof Error ? err.message : String(err) },
      "mcp last_used_at update failed",
    );
  }
  const { hashedKey: _hashedKey, ...key } = stored;
  return { key: { ...key, lastUsedAt: now }, actorUserId };
}
