import { getConfig } from "@/lib/config";
import { assertValidObjectKey, type ObjectStorage, type StoredObject } from "./types";

/**
 * S3-compatible object storage (Railway Storage Bucket / R2 / Vultr — spec
 * §1) written against a THIN INJECTABLE CLIENT INTERFACE, not the AWS SDK
 * directly: `@aws-sdk/client-s3` is not installed yet (REQUESTS-B4.md), so
 * this module must compile, run, and be testable without it.
 *
 * Integrator wiring once the SDK lands (server/storage/index.ts):
 *
 *   import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand }
 *     from "@aws-sdk/client-s3";
 *
 *   const client = new S3Client({
 *     endpoint: cfg.endpoint,
 *     region: "auto",
 *     credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
 *     forcePathStyle: true, // required by most S3-compatible endpoints
 *   });
 *   const s3: S3ClientLike = {
 *     putObject: async (p) => {
 *       await client.send(new PutObjectCommand({
 *         Bucket: p.bucket, Key: p.key, Body: p.body, ContentType: p.contentType,
 *       }));
 *     },
 *     getObject: async (p) => {
 *       try {
 *         const out = await client.send(new GetObjectCommand({ Bucket: p.bucket, Key: p.key }));
 *         const body = out.Body === undefined
 *           ? new Uint8Array()
 *           : await out.Body.transformToByteArray();
 *         return { body, contentType: out.ContentType ?? null };
 *       } catch (err) {
 *         if ((err as { name?: string }).name === "NoSuchKey") return null;
 *         throw err;
 *       }
 *     },
 *     deleteObject: async (p) => {
 *       await client.send(new DeleteObjectCommand({ Bucket: p.bucket, Key: p.key }));
 *     },
 *   };
 *   registerS3Client(() => s3);
 */

export interface S3ClientLike {
  putObject(params: {
    bucket: string;
    key: string;
    body: Uint8Array;
    contentType: string;
  }): Promise<void>;
  /** null when the key does not exist. */
  getObject(params: {
    bucket: string;
    key: string;
  }): Promise<{ body: Uint8Array; contentType: string | null } | null>;
  deleteObject(params: { bucket: string; key: string }): Promise<void>;
}

export interface S3StorageConfig {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** The S3_* env quartet, or null when any part is missing (memory fallback). */
export function s3ConfigFromEnv(): S3StorageConfig | null {
  const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = getConfig();
  if (
    S3_ENDPOINT === undefined ||
    S3_BUCKET === undefined ||
    S3_ACCESS_KEY_ID === undefined ||
    S3_SECRET_ACCESS_KEY === undefined
  ) {
    return null;
  }
  return {
    endpoint: S3_ENDPOINT,
    bucket: S3_BUCKET,
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
  };
}

export class S3ObjectStorage implements ObjectStorage {
  constructor(
    private readonly client: S3ClientLike,
    private readonly bucket: string,
  ) {}

  async put(key: string, data: Uint8Array, contentType: string): Promise<void> {
    assertValidObjectKey(key);
    await this.client.putObject({ bucket: this.bucket, key, body: data, contentType });
  }

  async get(key: string): Promise<StoredObject | null> {
    const found = await this.client.getObject({ bucket: this.bucket, key });
    if (found === null) return null;
    return { data: found.body, contentType: found.contentType ?? "application/octet-stream" };
  }

  async delete(key: string): Promise<void> {
    await this.client.deleteObject({ bucket: this.bucket, key });
  }
}
