import { beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_IDS } from "@/lib/fixtures";

/**
 * Regression tests for the fixture-session production guard: fixture-session
 * synthesis must never activate when NODE_ENV=production, even if PROVIDERS
 * somehow still reads "fixture" (config parsing refuses that combination at
 * startup; this covers the defense-in-depth check in server/session.ts).
 */

const authMock = vi.fn<() => Promise<unknown>>();
vi.mock("@/server/auth", () => ({
  auth: () => authMock(),
}));

const getConfigMock = vi.fn<() => { PROVIDERS: string; NODE_ENV: string }>();
vi.mock("@/lib/config", async (importOriginal) => {
  const actual: Record<string, unknown> = await importOriginal();
  return { ...actual, getConfig: () => getConfigMock() };
});

import { getSessionWithFixtureFallback } from "@/server/session";

describe("getSessionWithFixtureFallback", () => {
  beforeEach(() => {
    authMock.mockReset();
    getConfigMock.mockReset();
  });

  it("synthesizes the fixture session in fixture mode outside production", async () => {
    authMock.mockResolvedValue(null);
    getConfigMock.mockReturnValue({ PROVIDERS: "fixture", NODE_ENV: "development" });
    const session = await getSessionWithFixtureFallback();
    expect(session?.user.id).toBe(FIXTURE_IDS.user);
  });

  it("refuses to synthesize a fixture session when NODE_ENV=production", async () => {
    authMock.mockResolvedValue(null);
    getConfigMock.mockReturnValue({ PROVIDERS: "fixture", NODE_ENV: "production" });
    await expect(getSessionWithFixtureFallback()).resolves.toBeNull();
  });

  it("never synthesizes under PROVIDERS=live", async () => {
    authMock.mockResolvedValue(null);
    getConfigMock.mockReturnValue({ PROVIDERS: "live", NODE_ENV: "development" });
    await expect(getSessionWithFixtureFallback()).resolves.toBeNull();
  });

  it("returns the real session untouched when one exists", async () => {
    const real = { user: { id: "real-user" }, expires: new Date().toISOString() };
    authMock.mockResolvedValue(real);
    getConfigMock.mockReturnValue({ PROVIDERS: "fixture", NODE_ENV: "production" });
    await expect(getSessionWithFixtureFallback()).resolves.toBe(real);
  });
});
