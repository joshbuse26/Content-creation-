import { describe, expect, it } from "vitest";
import {
  OAUTH_STATE_MAX_AGE_MS,
  signOauthState,
  verifyOauthState,
} from "@/server/channel/oauth-state";

/**
 * Regression tests for the hardened OAuth state: nonce + issued-at with a
 * 10-minute expiry + binding to the initiating userId, all verified in the
 * callback.
 */

const WS = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

describe("oauth state", () => {
  it("round-trips for the same user within the expiry window", () => {
    const state = signOauthState(WS, USER);
    expect(verifyOauthState(state, USER)).toBe(WS);
  });

  it("includes a unique nonce per state", () => {
    expect(signOauthState(WS, USER)).not.toBe(signOauthState(WS, USER));
  });

  it("rejects a state minted for a different user", () => {
    const state = signOauthState(WS, USER);
    expect(verifyOauthState(state, "33333333-3333-4333-8333-333333333333")).toBeNull();
  });

  it("rejects an expired state (10-minute lifetime)", () => {
    const t0 = Date.now();
    const state = signOauthState(WS, USER, () => t0);
    expect(verifyOauthState(state, USER, () => t0 + OAUTH_STATE_MAX_AGE_MS - 1)).toBe(WS);
    expect(verifyOauthState(state, USER, () => t0 + OAUTH_STATE_MAX_AGE_MS + 1)).toBeNull();
  });

  it("rejects a state with a future issued-at (clock tampering)", () => {
    const t0 = Date.now();
    const state = signOauthState(WS, USER, () => t0 + 60_000);
    expect(verifyOauthState(state, USER, () => t0)).toBeNull();
  });

  it("rejects tampered payloads and signatures", () => {
    const state = signOauthState(WS, USER);
    const [payload, mac] = state.split(".") as [string, string];
    // Forge the payload (different workspace), keep the old mac.
    const forged = Buffer.from(
      JSON.stringify({
        workspaceId: "44444444-4444-4444-8444-444444444444",
        userId: USER,
        nonce: "x",
        issuedAt: Date.now(),
      }),
    ).toString("base64url");
    expect(verifyOauthState(`${forged}.${mac}`, USER)).toBeNull();
    // Corrupt the mac.
    const badMac = mac.slice(0, -1) + (mac.endsWith("0") ? "1" : "0");
    expect(verifyOauthState(`${payload}.${badMac}`, USER)).toBeNull();
    // Garbage.
    expect(verifyOauthState("not-a-state", USER)).toBeNull();
    expect(verifyOauthState("", USER)).toBeNull();
  });
});
