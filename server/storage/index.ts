import { logger } from "@/lib/logger";
import { MemoryObjectStorage } from "./memory";
import { S3ObjectStorage, s3ConfigFromEnv, type S3ClientLike } from "./s3";
import type { ObjectStorage } from "./types";

export type { ObjectStorage, StoredObject } from "./types";
export { assertValidObjectKey } from "./types";
export { MemoryObjectStorage } from "./memory";
export { S3ObjectStorage, s3ConfigFromEnv, type S3ClientLike, type S3StorageConfig } from "./s3";

/**
 * Storage selection.
 *
 * - S3_* env set AND an S3 client registered (integrator wires the AWS SDK —
 *   see the header of server/storage/s3.ts): S3-compatible bucket.
 * - Otherwise: process-local in-memory storage. Fixture mode and tests run
 *   entirely on it; if S3_* is configured but no client factory has been
 *   registered (SDK not installed yet), we log a warning once and fall back
 *   so the app never crashes on a missing optional dependency.
 */

let cached: ObjectStorage | undefined;
let s3ClientFactory: (() => S3ClientLike) | undefined;
let warnedMissingClient = false;

/** Integrator hook: register the AWS-SDK-backed client once the dep lands. */
export function registerS3Client(factory: () => S3ClientLike): void {
  s3ClientFactory = factory;
  cached = undefined;
}

export function getObjectStorage(): ObjectStorage {
  if (cached !== undefined) return cached;
  const cfg = s3ConfigFromEnv();
  if (cfg !== null && s3ClientFactory !== undefined) {
    cached = new S3ObjectStorage(s3ClientFactory(), cfg.bucket);
    return cached;
  }
  if (cfg !== null && !warnedMissingClient) {
    warnedMissingClient = true;
    logger.warn(
      "S3_* env is configured but no S3 client is registered (SDK dependency pending) — " +
        "falling back to in-memory object storage. Stored objects will NOT survive restarts.",
    );
  }
  cached = new MemoryObjectStorage();
  return cached;
}

/** Test hook: swap or clear the process-wide storage instance. */
export function setObjectStorageForTests(storage: ObjectStorage | undefined): void {
  cached = storage;
}

/**
 * Canonical key for a generated thumbnail image. Scoped by workspace then
 * project so tenancy checks can be done on the key prefix alone.
 */
export function thumbnailImageKey(
  workspaceId: string,
  projectId: string,
  inputHash: string,
  index: number,
): string {
  return `thumbnails/${workspaceId}/${projectId}/${inputHash.slice(0, 16)}-${index}.png`;
}
