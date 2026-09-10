import pino from "pino";
import { getConfig } from "@/lib/config";
import { REDACTION_CENSOR, REDACTION_PATHS } from "@/server/ops/logging";

/**
 * Structured logger. Request IDs are attached by callers via child loggers;
 * never log secrets or PII — enforced as a backstop by the SHARED redaction
 * list in server/ops/logging.ts (single source: tokens/secrets/cookies/
 * emails/magic links, top-level plus one- and two-level wildcards).
 */
export const logger = pino({
  level: getConfig().LOG_LEVEL,
  redact: { paths: REDACTION_PATHS, censor: REDACTION_CENSOR },
});
