import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getConfig } from "@/lib/config";

/**
 * HMAC-signed `state` parameter for the YouTube channel-connect OAuth flow
 * (app/api/channels/oauth/*). The payload carries the workspaceId across
 * the round-trip to Google plus three anti-abuse fields:
 *
 * - a random nonce (state values are single-purpose and unguessable),
 * - an issued-at timestamp, verified against a 10-minute expiry,
 * - the initiating userId, so a state minted for one signed-in user cannot
 *   be replayed through another user's callback (login-CSRF binding).
 *
 * Format: `<base64url(JSON payload)>.<hex hmac-sha256>`.
 */

export const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;

interface OauthStatePayload {
  workspaceId: string;
  userId: string;
  nonce: string;
  issuedAt: number;
}

function stateSecret(): string {
  const config = getConfig();
  return config.CHANNEL_TOKEN_SECRET ?? config.AUTH_SECRET ?? "dev-oauth-state";
}

function mac(encodedPayload: string): string {
  return createHmac("sha256", stateSecret()).update(encodedPayload).digest("hex");
}

export function signOauthState(
  workspaceId: string,
  userId: string,
  now: () => number = Date.now,
): string {
  const payload: OauthStatePayload = {
    workspaceId,
    userId,
    nonce: randomBytes(16).toString("hex"),
    issuedAt: now(),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${mac(encoded)}`;
}

/**
 * Returns the workspaceId when the signature checks out, the state is at
 * most 10 minutes old, and it was minted for `expectedUserId`; null
 * otherwise.
 */
export function verifyOauthState(
  state: string,
  expectedUserId: string,
  now: () => number = Date.now,
): string | null {
  const dot = state.lastIndexOf(".");
  if (dot <= 0) return null;
  const encoded = state.slice(0, dot);
  const given = state.slice(dot + 1);
  const expected = mac(encoded);
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null) return null;
  const { workspaceId, userId, nonce, issuedAt } = payload as Partial<OauthStatePayload>;
  if (
    typeof workspaceId !== "string" ||
    workspaceId === "" ||
    typeof userId !== "string" ||
    typeof nonce !== "string" ||
    nonce === "" ||
    typeof issuedAt !== "number"
  ) {
    return null;
  }
  const age = now() - issuedAt;
  if (age < 0 || age > OAUTH_STATE_MAX_AGE_MS) return null;
  if (userId !== expectedUserId) return null;
  return workspaceId;
}
