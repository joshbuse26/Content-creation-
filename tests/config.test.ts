import { describe, expect, it } from "vitest";
import { parseEnv, PRODUCT_NAME } from "@/lib/config";

describe("config", () => {
  it("PRODUCT_NAME is the single branding constant", () => {
    expect(PRODUCT_NAME).toBe("Gin Rummy");
  });

  it("parses with ZERO env vars — fixture mode needs no keys", () => {
    const config = parseEnv({});
    expect(config.PROVIDERS).toBe("fixture");
    expect(config.APP_URL).toBe("http://localhost:3000");
    expect(config.DATABASE_URL).toBeUndefined();
    expect(config.ADMIN_EMAILS).toEqual([]);
  });

  it("parses ADMIN_EMAILS as a case-folded, de-duplicated list", () => {
    expect(
      parseEnv({ ADMIN_EMAILS: "Josh@HexBandit.io, writer@example.com, josh@hexbandit.io" })
        .ADMIN_EMAILS,
    ).toEqual(["josh@hexbandit.io", "writer@example.com"]);
    expect(parseEnv({ ADMIN_EMAILS: "  " }).ADMIN_EMAILS).toEqual([]);
  });

  it("parses PLAYTEST_AUTH_BYPASS (TEMPORARY playtest flag)", () => {
    expect(parseEnv({}).PLAYTEST_AUTH_BYPASS).toBe(false);
    expect(parseEnv({ PLAYTEST_AUTH_BYPASS: "true" }).PLAYTEST_AUTH_BYPASS).toBe(true);
    expect(parseEnv({ PLAYTEST_AUTH_BYPASS: "1" }).PLAYTEST_AUTH_BYPASS).toBe(true);
    expect(parseEnv({ PLAYTEST_AUTH_BYPASS: "false" }).PLAYTEST_AUTH_BYPASS).toBe(false);
    expect(parseEnv({ PLAYTEST_AUTH_BYPASS: "0" }).PLAYTEST_AUTH_BYPASS).toBe(false);
  });

  it("treats empty strings as unset", () => {
    const config = parseEnv({ ANTHROPIC_API_KEY: "  ", DATABASE_URL: "" });
    expect(config.ANTHROPIC_API_KEY).toBeUndefined();
    expect(config.DATABASE_URL).toBeUndefined();
  });

  it("fails fast when PROVIDERS=live without provider keys", () => {
    expect(() => parseEnv({ PROVIDERS: "live" })).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => parseEnv({ PROVIDERS: "live" })).toThrow(/GOOGLE_API_KEY/);
  });

  it("accepts PROVIDERS=live with all provider keys", () => {
    const config = parseEnv({
      PROVIDERS: "live",
      ANTHROPIC_API_KEY: "sk-ant-test",
      GOOGLE_API_KEY: "g-test",
      TRANSCRIPT_API_KEY: "t-test",
      SEARCH_API_KEY: "s-test",
      IMAGE_API_KEY: "i-test",
    });
    expect(config.PROVIDERS).toBe("live");
  });

  const liveKeys = {
    PROVIDERS: "live",
    ANTHROPIC_API_KEY: "sk-ant-test",
    GOOGLE_API_KEY: "g-test",
    TRANSCRIPT_API_KEY: "t-test",
    SEARCH_API_KEY: "s-test",
    IMAGE_API_KEY: "i-test",
  };

  it("requires AUTH_SECRET in production", () => {
    expect(() => parseEnv({ NODE_ENV: "production", ...liveKeys })).toThrow(/AUTH_SECRET/);
    expect(
      parseEnv({
        NODE_ENV: "production",
        AUTH_SECRET: "x".repeat(32),
        RESEND_API_KEY: "re_test",
        ...liveKeys,
      }).AUTH_SECRET,
    ).toBeTruthy();
  });

  it("requires RESEND_API_KEY in production (magic links must be sent, not logged)", () => {
    expect(() =>
      parseEnv({ NODE_ENV: "production", AUTH_SECRET: "x".repeat(32), ...liveKeys }),
    ).toThrow(/RESEND_API_KEY/);
  });

  it("refuses PROVIDERS=fixture in production (fail-fast)", () => {
    expect(() => parseEnv({ NODE_ENV: "production", AUTH_SECRET: "x".repeat(32) })).toThrow(
      /PROVIDERS=fixture is not allowed/,
    );
    expect(() =>
      parseEnv({ NODE_ENV: "production", AUTH_SECRET: "x".repeat(32), PROVIDERS: "fixture" }),
    ).toThrow(/PROVIDERS/);
  });

  it("allows fixture during the production build phase (no runtime secrets at compile)", () => {
    const config = parseEnv({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build" });
    expect(config.PROVIDERS).toBe("fixture");
  });

  it("rejects invalid enum values instead of defaulting", () => {
    expect(() => parseEnv({ PROVIDERS: "prod" })).toThrow(/PROVIDERS/);
  });

  describe("LICENSED_SIMILARITY_MAX_OVERLAP (legal-risk guard threshold)", () => {
    it("defaults to 0.08 when unset", () => {
      expect(parseEnv({}).LICENSED_SIMILARITY_MAX_OVERLAP).toBe(0.08);
    });

    it("rejects 1.0 — a threshold that can never be exceeded disables the ratio check", () => {
      expect(() => parseEnv({ LICENSED_SIMILARITY_MAX_OVERLAP: "1" })).toThrow(
        /LICENSED_SIMILARITY_MAX_OVERLAP/,
      );
      expect(() => parseEnv({ LICENSED_SIMILARITY_MAX_OVERLAP: "1.0" })).toThrow(
        /LICENSED_SIMILARITY_MAX_OVERLAP/,
      );
    });

    it("rejects values above the 0.5 cap and non-positive values", () => {
      expect(() => parseEnv({ LICENSED_SIMILARITY_MAX_OVERLAP: "0.75" })).toThrow(
        /LICENSED_SIMILARITY_MAX_OVERLAP/,
      );
      expect(() => parseEnv({ LICENSED_SIMILARITY_MAX_OVERLAP: "0" })).toThrow(
        /LICENSED_SIMILARITY_MAX_OVERLAP/,
      );
    });

    it("accepts a sane in-range override", () => {
      expect(
        parseEnv({ LICENSED_SIMILARITY_MAX_OVERLAP: "0.12" }).LICENSED_SIMILARITY_MAX_OVERLAP,
      ).toBe(0.12);
    });
  });
});
