import { getConfig } from "@/lib/config";
import { logger } from "@/lib/logger";

/**
 * Error reporting — Sentry, env-gated on SENTRY_DSN.
 *
 * The @sentry/node SDK is NOT yet in package.json (dependency request filed
 * in REQUESTS-A4.md — A4 cannot edit package.json). Until it lands, this
 * module ships a typed no-op reporter with the same surface, so callers wire
 * error reporting now and it lights up when the dep + DSN are present. The
 * SDK is loaded via dynamic import so its absence is a logged degradation,
 * never a crash.
 */

export interface ErrorReporter {
  readonly enabled: boolean;
  captureException(error: unknown, context?: Record<string, unknown>): void;
  captureMessage(message: string, context?: Record<string, unknown>): void;
  /** Flush pending events (call before process exit). Resolves true when drained. */
  flush(timeoutMs?: number): Promise<boolean>;
}

interface SentryLikeSdk {
  init(options: { dsn: string; environment: string; tracesSampleRate?: number }): void;
  captureException(error: unknown, context?: unknown): unknown;
  captureMessage(message: string, context?: unknown): unknown;
  flush(timeout?: number): Promise<boolean>;
}

export function createNoopReporter(): ErrorReporter {
  return {
    enabled: false,
    captureException() {
      /* no-op */
    },
    captureMessage() {
      /* no-op */
    },
    flush() {
      return Promise.resolve(true);
    },
  };
}

function createSdkReporter(sdk: SentryLikeSdk): ErrorReporter {
  return {
    enabled: true,
    captureException(error, context) {
      sdk.captureException(error, context === undefined ? undefined : { extra: context });
    },
    captureMessage(message, context) {
      sdk.captureMessage(message, context === undefined ? undefined : { extra: context });
    },
    flush(timeoutMs = 2_000) {
      return sdk.flush(timeoutMs);
    },
  };
}

let cached: ErrorReporter | undefined;
let initPromise: Promise<ErrorReporter> | undefined;

/**
 * Initialize error reporting once per process. No DSN → no-op (fixture mode
 * and local dev run with zero env). DSN set but SDK missing → no-op with a
 * warning naming the missing dependency.
 */
export function initErrorReporting(): Promise<ErrorReporter> {
  if (initPromise !== undefined) return initPromise;
  initPromise = (async () => {
    const config = getConfig();
    if (config.SENTRY_DSN === undefined) {
      cached = createNoopReporter();
      return cached;
    }
    try {
      // Non-literal specifier: the package is an optional integration until
      // the dependency request in REQUESTS-A4.md is applied.
      const specifier = "@sentry/node";
      const sdk = (await import(/* webpackIgnore: true */ specifier)) as SentryLikeSdk;
      sdk.init({
        dsn: config.SENTRY_DSN,
        environment: config.NODE_ENV,
        tracesSampleRate: 0.1,
      });
      cached = createSdkReporter(sdk);
      logger.info("error reporting enabled (Sentry)");
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "SENTRY_DSN is set but @sentry/node is not installed — error reporting is a no-op (see REQUESTS-A4.md)",
      );
      cached = createNoopReporter();
    }
    return cached;
  })();
  return initPromise;
}

/** Synchronous accessor — no-op until initErrorReporting() has resolved. */
export function getErrorReporter(): ErrorReporter {
  return cached ?? createNoopReporter();
}

/** Test hook. */
export function resetErrorReportingForTests(): void {
  cached = undefined;
  initPromise = undefined;
}
