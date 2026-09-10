import NextAuth, { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import type { EmailConfig } from "next-auth/providers";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { getConfig } from "@/lib/config";
import { logger } from "@/lib/logger";
import { PRODUCT_NAME } from "@/lib/branding";
import { getDb, hasDb, schema } from "@/db";

/**
 * Auth.js v5.
 *
 * - Email magic link: in dev (no RESEND_API_KEY) the link is logged to the
 *   server console instead of sent — copy it from the logs to sign in.
 * - Google OAuth: configured from env, silently inactive without keys. The
 *   same Google account later powers the YouTube connect flow (spec §2).
 * - Database sessions via the Drizzle adapter when DATABASE_URL is set.
 */

function buildEmailProvider(): EmailConfig {
  const { RESEND_API_KEY, EMAIL_FROM } = getConfig();
  return {
    id: "email",
    type: "email",
    name: "Email",
    from: EMAIL_FROM,
    maxAge: 24 * 60 * 60,
    options: {},
    async sendVerificationRequest({ identifier, url }) {
      if (RESEND_API_KEY !== undefined) {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: EMAIL_FROM,
            to: identifier,
            subject: `Sign in to ${PRODUCT_NAME}`,
            text: `Sign in to ${PRODUCT_NAME}:\n\n${url}\n\nThis link expires in 24 hours. If you did not request it, ignore this email.`,
          }),
        });
        if (!res.ok) {
          throw new Error(`Magic-link email failed with status ${res.status}`);
        }
        return;
      }
      // Dev transport: log the link. Identifier is intentionally not logged.
      logger.info({ magicLink: url }, "DEV magic link (no RESEND_API_KEY set)");
    },
  };
}

function buildAuthConfig(): NextAuthConfig {
  const config = getConfig();
  const providers: NextAuthConfig["providers"] = [];

  if (config.GOOGLE_CLIENT_ID !== undefined && config.GOOGLE_CLIENT_SECRET !== undefined) {
    providers.push(
      Google({
        clientId: config.GOOGLE_CLIENT_ID,
        clientSecret: config.GOOGLE_CLIENT_SECRET,
        // youtube.readonly is requested later by the channel-connect flow,
        // not at first sign-in — keep the consent screen minimal here.
        allowDangerousEmailAccountLinking: false,
      }),
    );
  }

  if (hasDb()) {
    providers.push(buildEmailProvider());
  }

  const base: NextAuthConfig = {
    providers,
    secret: config.AUTH_SECRET ?? "dev-only-secret-change-me",
    trustHost: true,
    session: { strategy: hasDb() ? "database" : "jwt" },
    pages: {},
    callbacks: {
      session({ session, user }) {
        // Database strategy: expose the stable user id on the session.
        session.user.id = user.id;
        return session;
      },
    },
    cookies: {
      sessionToken: {
        options: { httpOnly: true, sameSite: "lax", secure: config.NODE_ENV === "production" },
      },
    },
  };

  if (hasDb()) {
    base.adapter = DrizzleAdapter(getDb(), {
      usersTable: schema.users,
      accountsTable: schema.accounts,
      sessionsTable: schema.sessions,
      verificationTokensTable: schema.verificationTokens,
    });
  } else {
    logger.warn("DATABASE_URL not set — auth running without persistence (sign-in disabled)");
    // Without an adapter the session callback receives a JWT token, not a user.
    base.callbacks = {
      session({ session }) {
        return session;
      },
    };
  }

  return base;
}

export const { handlers, auth, signIn, signOut } = NextAuth(buildAuthConfig());
