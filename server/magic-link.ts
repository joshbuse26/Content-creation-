import { getConfig } from "@/lib/config";
import { logger } from "@/lib/logger";
import { PRODUCT_NAME } from "@/lib/branding";

/**
 * Magic-link delivery for the Auth.js email provider (server/auth.ts).
 *
 * - With RESEND_API_KEY: the link is emailed via Resend (10s timeout).
 * - Without it, outside production: the link is logged so local dev can
 *   copy it from the console. The identifier is intentionally not logged.
 * - Without it, in production: the sign-in FAILS LOUDLY — a magic link is a
 *   working credential and must never land in production logs. (Config also
 *   requires RESEND_API_KEY in production; this is defense in depth.)
 */
export async function sendMagicLinkEmail(params: {
  identifier: string;
  url: string;
}): Promise<void> {
  const { RESEND_API_KEY, EMAIL_FROM, NODE_ENV } = getConfig();
  if (RESEND_API_KEY !== undefined) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: params.identifier,
        subject: `Sign in to ${PRODUCT_NAME}`,
        text: `Sign in to ${PRODUCT_NAME}:\n\n${params.url}\n\nThis link expires in 24 hours. If you did not request it, ignore this email.`,
      }),
    });
    if (!res.ok) {
      throw new Error(`Magic-link email failed with status ${res.status}`);
    }
    return;
  }
  if (NODE_ENV === "production") {
    logger.error("magic-link sign-in failed: RESEND_API_KEY is not set in production");
    throw new Error("Email sign-in is not configured (RESEND_API_KEY missing)");
  }
  // Dev transport: log the link. Identifier is intentionally not logged.
  // The URL goes into the message string on purpose: `magicLink` object
  // keys are redacted globally (server/ops/logging.ts), and this line is
  // the one deliberate, non-production exception.
  logger.info(`DEV magic link (no RESEND_API_KEY set): ${params.url}`);
}
