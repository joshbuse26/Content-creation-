import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { getConfig } from "@/lib/config";
import { logger } from "@/lib/logger";

/**
 * OAuth refresh-token encryption at rest (build spec §3, §9).
 *
 * The channels.oauth_refresh_token column stores only ciphertext produced
 * here — AES-256-GCM (authenticated), key derived from a server secret via
 * scrypt, fresh random IV per encryption. Format:
 *
 *   v1.<iv b64url>.<auth tag b64url>.<ciphertext b64url>
 *
 * The secret is CHANNEL_TOKEN_SECRET when set, else AUTH_SECRET (see
 * REQUESTS-A1.md — a dedicated env var is requested so token re-encryption
 * isn't coupled to session-secret rotation). In keyless fixture/dev mode a
 * process-local random key is used: tokens survive the process, not restarts,
 * which is fine because fixture mode never holds real tokens.
 */

const VERSION = "v1";
const SCRYPT_SALT = "gin-rummy.channel-token.v1";

let devFallbackSecret: string | undefined;
let warnedDevFallback = false;

function getSecret(): string {
  const env = process.env["CHANNEL_TOKEN_SECRET"];
  if (env !== undefined && env.trim() !== "") return env;
  const { AUTH_SECRET, NODE_ENV } = getConfig();
  if (AUTH_SECRET !== undefined) return AUTH_SECRET;
  if (NODE_ENV === "production") {
    throw new Error("Refresh-token encryption requires CHANNEL_TOKEN_SECRET or AUTH_SECRET");
  }
  devFallbackSecret ??= randomBytes(32).toString("hex");
  if (!warnedDevFallback) {
    warnedDevFallback = true;
    logger.warn(
      "No AUTH_SECRET/CHANNEL_TOKEN_SECRET set — using a process-local token-encryption key " +
        "(dev/fixture only; encrypted tokens will not survive a restart)",
    );
  }
  return devFallbackSecret;
}

const keyCache = new Map<string, Buffer>();

function deriveKey(secret: string): Buffer {
  const cached = keyCache.get(secret);
  if (cached !== undefined) return cached;
  const key = scryptSync(secret, SCRYPT_SALT, 32);
  keyCache.set(secret, key);
  return key;
}

const b64url = (buf: Buffer): string => buf.toString("base64url");

export function encryptRefreshToken(plaintext: string, secret?: string): string {
  const key = deriveKey(secret ?? getSecret());
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}.${b64url(iv)}.${b64url(tag)}.${b64url(ciphertext)}`;
}

export class TokenDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenDecryptionError";
  }
}

export function decryptRefreshToken(encrypted: string, secret?: string): string {
  const parts = encrypted.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new TokenDecryptionError("Unrecognized encrypted-token format");
  }
  const [, ivB64, tagB64, ctB64] = parts;
  if (ivB64 === undefined || tagB64 === undefined || ctB64 === undefined) {
    throw new TokenDecryptionError("Unrecognized encrypted-token format");
  }
  const key = deriveKey(secret ?? getSecret());
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(ctB64, "base64url")),
      decipher.final(),
    ]);
    return plain.toString("utf8");
  } catch {
    // Wrong key or tampered ciphertext — never leak which.
    throw new TokenDecryptionError("Refresh token could not be decrypted");
  }
}
