import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { registerS3Client, s3ConfigFromEnv, type S3ClientLike } from "@/server/storage";

/**
 * Startup wiring for S3-compatible object storage (v1.1 integration pass):
 * builds the thin `S3ClientLike` adapter over `@aws-sdk/client-s3` exactly
 * as documented in the header of server/storage/s3.ts and registers it.
 *
 * Called from BOTH processes — web (instrumentation.ts) and worker
 * (worker/index.ts). Registration is unconditional and lazy: the factory is
 * only invoked by getObjectStorage() when the S3_* env quartet is set, so
 * fixture/keyless boots never construct an AWS client and keep the
 * in-memory backend.
 */
export function registerS3StorageClient(): void {
  registerS3Client((): S3ClientLike => {
    const cfg = s3ConfigFromEnv();
    if (cfg === null) {
      // getObjectStorage() only calls the factory when the env is set.
      throw new Error("S3 client factory invoked without S3_* env configured");
    }
    const client = new S3Client({
      endpoint: cfg.endpoint,
      region: "auto",
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      forcePathStyle: true, // required by most S3-compatible endpoints
    });
    return {
      putObject: async (p) => {
        await client.send(
          new PutObjectCommand({
            Bucket: p.bucket,
            Key: p.key,
            Body: p.body,
            ContentType: p.contentType,
          }),
        );
      },
      getObject: async (p) => {
        try {
          const out = await client.send(new GetObjectCommand({ Bucket: p.bucket, Key: p.key }));
          const body =
            out.Body === undefined ? new Uint8Array() : await out.Body.transformToByteArray();
          return { body, contentType: out.ContentType ?? null };
        } catch (err) {
          if ((err as { name?: string }).name === "NoSuchKey") return null;
          throw err;
        }
      },
      deleteObject: async (p) => {
        await client.send(new DeleteObjectCommand({ Bucket: p.bucket, Key: p.key }));
      },
    };
  });
}
