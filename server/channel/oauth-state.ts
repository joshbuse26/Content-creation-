import { createHmac, timingSafeEqual } from "node:crypto";
import { getConfig } from "@/lib/config";

/**
 * HMAC-signed `state` parameter for the YouTube channel-connect OAuth flow
 * (app/api/channels/oauth/*). Carries the workspaceId across the round-trip
 * to Google so the callback can trust which workspace initiated the connect.
 */

function stateSecret(): string {
  const config = getConfig();
  return config.CHANNEL_TOKEN_SECRET ?? config.AUTH_SECRET ?? "dev-oauth-state";
}

export function signOauthState(workspaceId: string): string {
  const mac = createHmac("sha256", stateSecret()).update(workspaceId).digest("hex");
  return `${workspaceId}.${mac}`;
}

/** Returns the workspaceId when the signature checks out, null otherwise. */
export function verifyOauthState(state: string): string | null {
  const dot = state.lastIndexOf(".");
  if (dot <= 0) return null;
  const workspaceId = state.slice(0, dot);
  const mac = state.slice(dot + 1);
  const expected = createHmac("sha256", stateSecret()).update(workspaceId).digest("hex");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return workspaceId;
}
