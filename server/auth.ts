import NextAuth, { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import type { EmailConfig } from "next-auth/providers";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getConfig } from "@/lib/config";
import { logger } from "@/lib/logger";
import { sendMagicLinkEmail } from "@/server/magic-link";
import { getDb, hasDb, schema } from "@/db";

/**
 * Auth.js v5.
 *
 * - Email magic link: in dev (no RESEND_API_KEY) the link is logged to the
 *   server console instead of sent — copy it from the logs to sign in.
 * - Google OAuth: configured from env, silently inactive without keys. The
 *   same Google account later powers the YouTube connect flow (spec §2).
 * - Database sessions via the Drizzle adapter when DATABASE_URL is set.
 * - TEMPORARY: PLAYTEST_AUTH_BYPASS adds a Credentials "playtest" provider
 *   and forces JWT sessions (Credentials cannot use database sessions).
 *   Remove before public launch.
 */

const PLAYTEST_FALLBACK_EMAIL = "joshbuse@hexbandit.io";
const PLAYTEST_USER_NAME = "Josh Buse";

function buildEmailProvider(): EmailConfig {
  const { EMAIL_FROM } = getConfig();
  return {
    id: "email",
    type: "email",
    name: "Email",
    from: EMAIL_FROM,
    maxAge: 24 * 60 * 60,
    options: {},
    async sendVerificationRequest({ identifier, url }) {
      // Delivery (Resend, or dev logging outside production) lives in
      // server/magic-link.ts — production without RESEND_API_KEY fails
      // loudly there instead of leaking the link into logs.
      await sendMagicLinkEmail({ identifier, url });
    },
  };
}

/** Resolve (or create) the playtest user row for the Credentials provider. */
async function resolvePlaytestUser(): Promise<{ id: string; email: string; name: string }> {
  const config = getConfig();
  const email = (config.ADMIN_EMAILS[0] ?? PLAYTEST_FALLBACK_EMAIL).toLowerCase();
  const name = PLAYTEST_USER_NAME;

  if (!hasDb()) {
    return { id: randomUUID(), email, name };
  }

  const db = getDb();
  const found = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (found[0] !== undefined) {
    return { id: found[0].id, email: found[0].email, name: found[0].name ?? name };
  }

  const id = randomUUID();
  await db.insert(schema.users).values({
    id,
    email,
    name,
    emailVerified: new Date(),
  });
  return { id, email, name };
}

function buildPlaytestCredentialsProvider() {
  // TEMPORARY — remove PLAYTEST_AUTH_BYPASS / this provider before public launch.
  return Credentials({
    id: "playtest",
    name: "Playtest",
    credentials: {},
    async authorize() {
      return resolvePlaytestUser();
    },
  });
}

function buildAuthConfig(): NextAuthConfig {
  const config = getConfig();
  const playtestBypass = config.PLAYTEST_AUTH_BYPASS;
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

  if (playtestBypass) {
    providers.push(buildPlaytestCredentialsProvider());
  }

  // Credentials requires JWT; keep database sessions when bypass is off.
  const sessionStrategy: "jwt" | "database" = playtestBypass ? "jwt" : hasDb() ? "database" : "jwt";

  const base: NextAuthConfig = {
    providers,
    secret: config.AUTH_SECRET ?? "dev-only-secret-change-me",
    trustHost: true,
    session: { strategy: sessionStrategy },
    pages: {},
    callbacks: {
      jwt({ token, user }) {
        // NextAuth types mark `user` as always present; at runtime it is only
        // set on the initial sign-in callback, not on subsequent JWT refreshes.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- dual-path runtime
        if (user) {
          token.sub = user.id;
          if (user.email) token.email = user.email;
          if (user.name) token.name = user.name;
        }
        return token;
      },
      session({ session, user, token }) {
        // Database strategy passes `user`; JWT (playtest bypass) passes `token`.
        // Types always include `user`; under JWT it is an empty shell at runtime.
        if (sessionStrategy === "jwt") {
          if (typeof token.sub === "string" && token.sub !== "") {
            session.user.id = token.sub;
            if (typeof token.email === "string") session.user.email = token.email;
            if (typeof token.name === "string") session.user.name = token.name;
          }
        } else if (typeof user.id === "string" && user.id !== "") {
          session.user.id = user.id;
        }
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
  }

  if (playtestBypass) {
    logger.warn(
      "TEMPORARY PLAYTEST_AUTH_BYPASS is enabled — one-click playtest sign-in is active; remove before public launch",
    );
  }

  return base;
}

export const { handlers, auth, signIn, signOut } = NextAuth(buildAuthConfig());
