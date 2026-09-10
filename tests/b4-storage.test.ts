import { describe, expect, it } from "vitest";
import {
  assertValidObjectKey,
  MemoryObjectStorage,
  S3ObjectStorage,
  thumbnailImageKey,
  type S3ClientLike,
} from "@/server/storage";

describe("object keys", () => {
  it("accepts normal keys and rejects traversal / absolute / weird chars", () => {
    expect(() => {
      assertValidObjectKey("thumbnails/ws/proj/abc-0.png");
    }).not.toThrow();
    for (const bad of ["", "/abs/path.png", "a/../b.png", "a//b.png", "a b.png", "x".repeat(513)]) {
      expect(() => {
        assertValidObjectKey(bad);
      }).toThrow();
    }
  });

  it("thumbnailImageKey is scoped workspace → project and validates", () => {
    const key = thumbnailImageKey("ws-1", "proj-1", "a".repeat(64), 2);
    expect(key).toBe(`thumbnails/ws-1/proj-1/${"a".repeat(16)}-2.png`);
    expect(() => {
      assertValidObjectKey(key);
    }).not.toThrow();
  });
});

describe("MemoryObjectStorage", () => {
  it("round-trips bytes + content type, isolates stored copies", async () => {
    const storage = new MemoryObjectStorage();
    const bytes = Uint8Array.from([1, 2, 3, 4]);
    await storage.put("a/b.png", bytes, "image/png");
    bytes[0] = 99; // caller mutation must not reach the store
    const got = await storage.get("a/b.png");
    expect(got).not.toBeNull();
    expect(Array.from(got?.data ?? [])).toEqual([1, 2, 3, 4]);
    expect(got?.contentType).toBe("image/png");
    // reads return copies too
    if (got !== null) got.data[1] = 77;
    const again = await storage.get("a/b.png");
    expect(Array.from(again?.data ?? [])).toEqual([1, 2, 3, 4]);
  });

  it("get of a missing key is null; delete is idempotent", async () => {
    const storage = new MemoryObjectStorage();
    expect(await storage.get("missing.png")).toBeNull();
    await expect(storage.delete("missing.png")).resolves.toBeUndefined();
    await storage.put("k.png", Uint8Array.from([9]), "image/png");
    await storage.delete("k.png");
    expect(await storage.get("k.png")).toBeNull();
  });
});

describe("S3ObjectStorage (thin injectable client — no AWS SDK required)", () => {
  function fakeClient(): { client: S3ClientLike; objects: Map<string, Uint8Array> } {
    const objects = new Map<string, Uint8Array>();
    const client: S3ClientLike = {
      putObject: ({ bucket, key, body }) => {
        objects.set(`${bucket}/${key}`, body);
        return Promise.resolve();
      },
      getObject: ({ bucket, key }) => {
        const body = objects.get(`${bucket}/${key}`);
        if (body === undefined) return Promise.resolve(null);
        return Promise.resolve({ body, contentType: "image/png" });
      },
      deleteObject: ({ bucket, key }) => {
        objects.delete(`${bucket}/${key}`);
        return Promise.resolve();
      },
    };
    return { client, objects };
  }

  it("round-trips through the injected client, scoped to the bucket", async () => {
    const { client, objects } = fakeClient();
    const storage = new S3ObjectStorage(client, "gin-rummy-media");
    await storage.put("thumbnails/ws/p/x-0.png", Uint8Array.from([5, 6]), "image/png");
    expect(objects.has("gin-rummy-media/thumbnails/ws/p/x-0.png")).toBe(true);
    const got = await storage.get("thumbnails/ws/p/x-0.png");
    expect(Array.from(got?.data ?? [])).toEqual([5, 6]);
    expect(await storage.get("nope.png")).toBeNull();
    await storage.delete("thumbnails/ws/p/x-0.png");
    expect(await storage.get("thumbnails/ws/p/x-0.png")).toBeNull();
  });

  it("rejects invalid keys before touching the client", async () => {
    const { client } = fakeClient();
    const storage = new S3ObjectStorage(client, "b");
    await expect(storage.put("../evil.png", Uint8Array.from([1]), "image/png")).rejects.toThrow();
  });
});
