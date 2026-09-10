import pino from "pino";
import { getConfig } from "@/lib/config";

/**
 * Structured logger. Request IDs are attached by callers via child loggers;
 * never log secrets or PII (enforced by redaction below as a backstop).
 */
export const logger = pino({
  level: getConfig().LOG_LEVEL,
  redact: {
    paths: [
      "*.authorization",
      "*.cookie",
      "*.password",
      "*.token",
      "*.apiKey",
      "*.refreshToken",
      "email",
      "*.email",
    ],
    censor: "[redacted]",
  },
});
