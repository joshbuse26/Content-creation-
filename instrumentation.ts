/**
 * Next.js instrumentation hook — runs once per server boot (web service).
 * Error reporting is a no-op without SENTRY_DSN (server/ops/sentry.ts).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initErrorReporting } = await import("@/server/ops");
    await initErrorReporting();
  }
}
