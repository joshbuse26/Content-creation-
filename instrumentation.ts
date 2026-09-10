/**
 * Next.js instrumentation hook — runs once per server boot (web service).
 * Error reporting is a no-op without SENTRY_DSN (server/ops/sentry.ts);
 * S3 client registration is lazy — no AWS client is built unless the S3_*
 * env quartet is set (server/storage).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initErrorReporting } = await import("@/server/ops");
    await initErrorReporting();
    const { registerS3StorageClient } = await import("@/server/storage/register-s3");
    registerS3StorageClient();
  }
}
