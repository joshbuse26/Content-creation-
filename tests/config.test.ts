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

  it("requires AUTH_SECRET in production", () => {
    expect(() => parseEnv({ NODE_ENV: "production" })).toThrow(/AUTH_SECRET/);
    expect(parseEnv({ NODE_ENV: "production", AUTH_SECRET: "x".repeat(32) }).AUTH_SECRET).toBeTruthy();
  });

  it("rejects invalid enum values instead of defaulting", () => {
    expect(() => parseEnv({ PROVIDERS: "prod" })).toThrow(/PROVIDERS/);
  });
});
