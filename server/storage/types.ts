/**
 * Object storage — the interface every storage backend implements (spec §1:
 * S3-compatible bucket for thumbnails, uploads, exports).
 *
 * Backends: `MemoryObjectStorage` (tests, fixture mode, and the fallback
 * when the S3_* env quartet is not configured) and
 * `S3ObjectStorage` (server/storage/s3.ts), which is written against a thin
 * injectable client interface so it compiles and tests without
 * `@aws-sdk/client-s3` installed.
 */

export interface StoredObject {
  data: Uint8Array;
  contentType: string;
}

export interface ObjectStorage {
  /** Write (or overwrite) an object. Keys are opaque `/`-separated paths. */
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  /** Read an object, or null when the key does not exist. */
  get(key: string): Promise<StoredObject | null>;
  /** Delete is idempotent — deleting a missing key is a no-op. */
  delete(key: string): Promise<void>;
}

/**
 * Object keys are generated server-side only (never accepted from clients),
 * but validate defensively anyway: no traversal, no absolute paths, no
 * exotic characters that could confuse a bucket listing.
 */
export function assertValidObjectKey(key: string): void {
  if (key.length === 0 || key.length > 512) {
    throw new Error("object key must be 1-512 characters");
  }
  if (key.startsWith("/") || key.includes("..") || key.includes("//")) {
    throw new Error("object key must be a relative path without traversal");
  }
  if (!/^[A-Za-z0-9/_.-]+$/.test(key)) {
    throw new Error("object key contains unsupported characters");
  }
}
