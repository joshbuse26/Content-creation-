import { describe, expect, it } from "vitest";
import {
  createOpsLogger,
  REDACTION_CENSOR,
  REDACTION_PATHS,
  withRequestId,
} from "@/server/ops/logging";

function makeCapture(): { lines: string[]; logger: ReturnType<typeof createOpsLogger> } {
  const lines: string[] = [];
  const logger = createOpsLogger({
    level: "info",
    stream: { write: (line: string) => lines.push(line) },
  });
  return { lines, logger };
}

const parse = (line: string | undefined): Record<string, unknown> => {
  if (line === undefined) throw new Error("no log line captured");
  return JSON.parse(line) as Record<string, unknown>;
};

describe("ops logger redaction", () => {
  it("redacts authorization headers wherever they appear", () => {
    const { lines, logger } = makeCapture();
    logger.info(
      { authorization: "Bearer sk-live-123", headers: { authorization: "Bearer sk-live-456" } },
      "request",
    );
    const entry = parse(lines[0]);
    expect(entry.authorization).toBe(REDACTION_CENSOR);
    expect((entry.headers as Record<string, unknown>).authorization).toBe(REDACTION_CENSOR);
    expect(lines[0]).not.toContain("sk-live-123");
    expect(lines[0]).not.toContain("sk-live-456");
  });

  it("redacts cookies including nested and set-cookie", () => {
    const { lines, logger } = makeCapture();
    logger.info(
      {
        cookie: "session=abc123",
        req: { cookies: "session=def456", "set-cookie": "session=ghi789" },
      },
      "cookies",
    );
    expect(lines[0]).not.toContain("abc123");
    expect(lines[0]).not.toContain("def456");
    expect(lines[0]).not.toContain("ghi789");
  });

  it("redacts tokens, api keys and secrets", () => {
    const { lines, logger } = makeCapture();
    logger.info(
      {
        token: "tok_1",
        auth: { refreshToken: "rt_2", accessToken: "at_3", apiKey: "key_4", secret: "sec_5" },
        password: "hunter2",
      },
      "creds",
    );
    for (const leaked of ["tok_1", "rt_2", "at_3", "key_4", "sec_5", "hunter2"]) {
      expect(lines[0]).not.toContain(leaked);
    }
  });

  it("redacts emails (PII) at top level and one level deep", () => {
    const { lines, logger } = makeCapture();
    logger.info({ email: "casey@example.com", user: { email: "casey@example.com" } }, "user");
    expect(lines[0]).not.toContain("casey@example.com");
    const entry = parse(lines[0]);
    expect(entry.email).toBe(REDACTION_CENSOR);
    expect((entry.user as Record<string, unknown>).email).toBe(REDACTION_CENSOR);
  });

  it("keeps non-sensitive fields intact", () => {
    const { lines, logger } = makeCapture();
    logger.info({ route: "/api/trpc/script.generate", durationMs: 42 }, "ok");
    const entry = parse(lines[0]);
    expect(entry.route).toBe("/api/trpc/script.generate");
    expect(entry.durationMs).toBe(42);
  });

  it("request-id child loggers carry the id and keep redaction", () => {
    const { lines, logger } = makeCapture();
    const child = withRequestId(logger, "req-123");
    child.info({ token: "tok_leak" }, "child");
    const entry = parse(lines[0]);
    expect(entry.requestId).toBe("req-123");
    expect(entry.token).toBe(REDACTION_CENSOR);
  });

  it("covers the required redaction categories in the path list", () => {
    const flat = REDACTION_PATHS.join(" ");
    for (const needle of ["authorization", "cookie", "token", "email", "magicLink", "secret"]) {
      expect(flat).toContain(needle);
    }
  });

  it("redacts two levels deep (wildcard * . * . key)", () => {
    const { lines, logger } = makeCapture();
    logger.info(
      {
        req: { auth: { token: "tok_deep", refreshToken: "rt_deep", secret: "sec_deep" } },
        ctx: { user: { email: "deep@example.com" } },
      },
      "deep",
    );
    for (const leaked of ["tok_deep", "rt_deep", "sec_deep", "deep@example.com"]) {
      expect(lines[0]).not.toContain(leaked);
    }
  });

  it("redacts magicLink keys at any covered depth", () => {
    const { lines, logger } = makeCapture();
    logger.info(
      { magicLink: "https://x/1?token=a", mail: { magicLink: "https://x/2?token=b" } },
      "links",
    );
    expect(lines[0]).not.toContain("token=a");
    expect(lines[0]).not.toContain("token=b");
  });

  it("the shared lib/logger uses the same redaction list", async () => {
    const { REDACTION_PATHS: opsPaths } = await import("@/server/ops/logging");
    const loggerSource = await import("node:fs/promises").then((fs) =>
      fs.readFile("lib/logger.ts", "utf8"),
    );
    expect(loggerSource).toContain("REDACTION_PATHS");
    expect(opsPaths).toContain("*.*.token");
    expect(opsPaths).toContain("accessToken");
  });
});
