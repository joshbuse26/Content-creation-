import pino, { type DestinationStream, type Logger } from "pino";
import { getConfig } from "@/lib/config";

/**
 * Logger factory — structured pino with request-id child loggers and a
 * redaction list covering the spec §9 "no secrets/PII in logs" rule:
 * authorization headers, cookies, tokens of every flavor, and emails.
 *
 * `lib/logger.ts` (A0's shared instance) stays the default import for
 * existing code; this factory is for services that need their own stream
 * (worker, jobs) or a per-request child logger.
 */

/** Paths pino censors — both top-level and one level deep. */
export const REDACTION_PATHS: string[] = [
  "authorization",
  "*.authorization",
  'headers["authorization"]',
  "cookie",
  "*.cookie",
  "cookies",
  "*.cookies",
  '*["set-cookie"]',
  "password",
  "*.password",
  "token",
  "*.token",
  "accessToken",
  "*.accessToken",
  "refreshToken",
  "*.refreshToken",
  "apiKey",
  "*.apiKey",
  "secret",
  "*.secret",
  "email",
  "*.email",
];

export const REDACTION_CENSOR = "[redacted]";

export interface CreateLoggerOptions {
  level?: string;
  /** Static bindings attached to every line (e.g. { service: "worker" }). */
  base?: Record<string, unknown>;
  /** Injectable for tests — capture lines instead of writing to stdout. */
  stream?: DestinationStream;
}

export function createOpsLogger(options: CreateLoggerOptions = {}): Logger {
  const opts: pino.LoggerOptions = {
    level: options.level ?? getConfig().LOG_LEVEL,
    base: options.base ?? {},
    redact: { paths: REDACTION_PATHS, censor: REDACTION_CENSOR },
  };
  return options.stream === undefined ? pino(opts) : pino(opts, options.stream);
}

/** Child logger carrying the request id — attach at the edge, pass down. */
export function withRequestId(logger: Logger, requestId: string): Logger {
  return logger.child({ requestId });
}
