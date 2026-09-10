import { z } from "zod";
import { PRODUCT_NAME } from "@/lib/branding";

export { PRODUCT_NAME };

/**
 * Environment configuration — parsed once with Zod, fail-fast on invalid
 * values. Under `PROVIDERS=fixture` (the default) the app runs with ZERO
 * secrets set; under `PROVIDERS=live` every provider key required by a live
 * integration must be present, and config parsing throws at startup if not.
 */

export const LLM_MODELS = {
  /** Outline / drafting / retention / voice / revision stages. */
  sonnet: "claude-sonnet-5",
  /** Fact-check, scoring, tags, classification. */
  haiku: "claude-haiku-4-5-20251001",
} as const;
export type LlmModel = (typeof LLM_MODELS)[keyof typeof LLM_MODELS];

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    /** Set by Next.js during `next build` — secrets are not required to compile. */
    NEXT_PHASE: optionalString,
    /** fixture: deterministic local data, zero keys needed. live: real APIs. */
    PROVIDERS: z.enum(["fixture", "live"]).default("fixture"),

    APP_URL: z.preprocess(emptyToUndefined, z.url().default("http://localhost:3000")),

    DATABASE_URL: optionalString,
    REDIS_URL: optionalString,

    AUTH_SECRET: optionalString,
    GOOGLE_CLIENT_ID: optionalString,
    GOOGLE_CLIENT_SECRET: optionalString,
    /** OAuth refresh-token encryption key (falls back to AUTH_SECRET) so
     *  token re-encryption is decoupled from session-secret rotation. */
    CHANNEL_TOKEN_SECRET: optionalString,

    GOOGLE_API_KEY: optionalString,
    /** Which live LLM backend serves the pipeline tiers in LLM_MODELS. */
    LLM_BACKEND: z.enum(["anthropic", "grok"]).default("anthropic"),
    ANTHROPIC_API_KEY: optionalString,
    XAI_API_KEY: optionalString,
    /** Grok model serving the "sonnet" (main/generative) tier. */
    XAI_MODEL_MAIN: z.preprocess(emptyToUndefined, z.string().default("grok-4.6")),
    /** Grok model serving the "haiku" (fast/classification) tier. */
    XAI_MODEL_FAST: z.preprocess(emptyToUndefined, z.string().default("grok-4.1-fast")),
    TRANSCRIPT_API_KEY: optionalString,
    SEARCH_API_KEY: optionalString,
    IMAGE_API_KEY: optionalString,
    VOYAGE_API_KEY: optionalString,

    STRIPE_SECRET_KEY: optionalString,
    STRIPE_WEBHOOK_SECRET: optionalString,
    /** Stripe price ids (price_…) or price lookup keys, one per paid tier
     *  plus the metered overage price (server/billing/checkout.ts). */
    STRIPE_PRICE_STARTER: optionalString,
    STRIPE_PRICE_TEAM: optionalString,
    STRIPE_PRICE_AGENCY: optionalString,
    STRIPE_PRICE_OVERAGE: optionalString,

    /**
     * partnered_named generation mode (PRODUCT-CONTRACTS §3). OFF by
     * default; the server rejects partnered_named requests while off
     * (server/modes.ts) and the UI hides the mode. May only ever be enabled
     * for deployments with signed partner licenses on file.
     */
    FEATURE_PARTNERED_NAMED: z
      .preprocess(emptyToUndefined, z.enum(["true", "false", "1", "0"]).default("false"))
      .transform((v) => v === "true" || v === "1"),

    /**
     * Licensed-voice similarity guard threshold (PRODUCT-CONTRACTS §7): the
     * maximum allowed 5-gram overlap ratio in any 200-word window between a
     * licensed-voice section and its source snippets. Above this, the section
     * is auto-rewritten once and then hard-failed. Default 0.08 (8%).
     */
    LICENSED_SIMILARITY_MAX_OVERLAP: z.preprocess(
      emptyToUndefined,
      z.coerce.number().gt(0).max(1).default(0.08),
    ),

    RESEND_API_KEY: optionalString,
    EMAIL_FROM: z.preprocess(emptyToUndefined, z.string().default("Gin Rummy <login@localhost>")),

    SENTRY_DSN: optionalString,
    POSTHOG_KEY: optionalString,

    S3_ENDPOINT: optionalString,
    S3_BUCKET: optionalString,
    S3_ACCESS_KEY_ID: optionalString,
    S3_SECRET_ACCESS_KEY: optionalString,

    LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  })
  .superRefine((env, ctx) => {
    const isBuildPhase = env.NEXT_PHASE === "phase-production-build";
    if (env.NODE_ENV === "production" && !isBuildPhase && env.PROVIDERS === "fixture") {
      // Fixture mode synthesizes a signed-in session without any sign-in
      // (server/session.ts) — running it in production would hand every
      // visitor the fixture user. Fail fast at startup instead.
      ctx.addIssue({
        code: "custom",
        path: ["PROVIDERS"],
        message:
          "PROVIDERS=fixture is not allowed when NODE_ENV=production — fixture mode " +
          "synthesizes sessions without sign-in. Set PROVIDERS=live (with its required keys).",
      });
    }
    if (env.PROVIDERS === "live") {
      const required: (keyof typeof env)[] = [
        env.LLM_BACKEND === "grok" ? "XAI_API_KEY" : "ANTHROPIC_API_KEY",
        "GOOGLE_API_KEY",
        "TRANSCRIPT_API_KEY",
        "SEARCH_API_KEY",
        "IMAGE_API_KEY",
      ];
      for (const key of required) {
        if (env[key] === undefined) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: `${key} is required when PROVIDERS=live`,
          });
        }
      }
    }
    if (env.NODE_ENV === "production" && !isBuildPhase && env.AUTH_SECRET === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_SECRET"],
        message: "AUTH_SECRET is required in production",
      });
    }
    if (env.NODE_ENV === "production" && !isBuildPhase && env.RESEND_API_KEY === undefined) {
      // Without Resend the email provider would fall back to logging magic
      // links — a credential leak. Production must be able to send them.
      ctx.addIssue({
        code: "custom",
        path: ["RESEND_API_KEY"],
        message: "RESEND_API_KEY is required in production (magic links are never logged)",
      });
    }
  });

export type AppConfig = z.infer<typeof envSchema>;

let cached: AppConfig | undefined;

/** Parse and cache config. Throws (fail-fast) on invalid environment. */
export function getConfig(): AppConfig {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Pure parse — used by getConfig and by tests. */
export function parseEnv(env: Record<string, string | undefined>): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`[${PRODUCT_NAME}] Invalid environment configuration:\n${details}`);
  }
  return result.data;
}

/** Test hook: clear the memoized config. */
export function resetConfigForTests(): void {
  cached = undefined;
}
