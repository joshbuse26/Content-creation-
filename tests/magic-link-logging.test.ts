import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression tests for the magic-link leak fix: magic-link URLs are only
 * logged outside production; in production without RESEND_API_KEY the
 * sign-in fails loudly instead of logging a working credential.
 */

interface FakeConfig {
  NODE_ENV: string;
  PROVIDERS: string;
  LOG_LEVEL: string;
  EMAIL_FROM: string;
  RESEND_API_KEY: string | undefined;
  DATABASE_URL: string | undefined;
  AUTH_SECRET: string | undefined;
  GOOGLE_CLIENT_ID: string | undefined;
  GOOGLE_CLIENT_SECRET: string | undefined;
}

const fakeConfig: FakeConfig = {
  NODE_ENV: "development",
  PROVIDERS: "fixture",
  LOG_LEVEL: "info",
  EMAIL_FROM: "Test <login@test.local>",
  RESEND_API_KEY: undefined,
  DATABASE_URL: undefined,
  AUTH_SECRET: undefined,
  GOOGLE_CLIENT_ID: undefined,
  GOOGLE_CLIENT_SECRET: undefined,
};

vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return { ...actual, getConfig: () => fakeConfig };
});

describe("magic-link transport", () => {
  beforeEach(() => {
    fakeConfig.NODE_ENV = "development";
    fakeConfig.RESEND_API_KEY = undefined;
    vi.restoreAllMocks();
  });

  it("logs the link in development when RESEND_API_KEY is unset", async () => {
    const { sendMagicLinkEmail } = await import("@/server/magic-link");
    const { logger } = await import("@/lib/logger");
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => undefined);

    await sendMagicLinkEmail({
      identifier: "user@example.com",
      url: "https://app.example.com/magic?token=abc",
    });
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({ magicLink: expect.stringContaining("token=abc") as unknown }),
      expect.stringContaining("DEV magic link"),
    );
  });

  it("fails loudly (and never logs the link) in production without RESEND_API_KEY", async () => {
    fakeConfig.NODE_ENV = "production";
    const { sendMagicLinkEmail } = await import("@/server/magic-link");
    const { logger } = await import("@/lib/logger");
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined);

    await expect(
      sendMagicLinkEmail({
        identifier: "user@example.com",
        url: "https://app.example.com/magic?token=abc",
      }),
    ).rejects.toThrow(/RESEND_API_KEY/);
    expect(infoSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });
});
