/**
 * API-key formatting — pure helpers shared by the server key store and the
 * settings UI (no db/crypto imports so client components can use them).
 *
 * A secret looks like `gr_live_<idFrag>_<random>` where `idFrag` is the
 * first 8 hex chars of the key row's UUID. Because the fragment is derived
 * from the row id, the UI can render a TRUE prefix of the secret
 * (`gr_live_<idFrag>…`) from the stored row alone — the plaintext secret is
 * shown exactly once at creation and never stored (only its SHA-256 hash).
 */

export const API_KEY_SECRET_PREFIX = "gr_live_";

/** First 8 hex chars of the key's UUID — embedded verbatim in the secret. */
export function apiKeyIdFragment(apiKeyId: string): string {
  return apiKeyId.replace(/-/g, "").slice(0, 8);
}

/** The display prefix for a key row: a genuine prefix of its secret. */
export function apiKeyDisplayPrefix(apiKeyId: string): string {
  return `${API_KEY_SECRET_PREFIX}${apiKeyIdFragment(apiKeyId)}`;
}
