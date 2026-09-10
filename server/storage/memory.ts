import { assertValidObjectKey, type ObjectStorage, type StoredObject } from "./types";

/**
 * In-memory object storage — tests, fixture mode, and the fallback when the
 * S3_* env quartet is not configured. Contents live for
 * the process lifetime only; every read returns a copy so callers can't
 * mutate the stored bytes.
 */
export class MemoryObjectStorage implements ObjectStorage {
  private readonly objects = new Map<string, StoredObject>();

  put(key: string, data: Uint8Array, contentType: string): Promise<void> {
    assertValidObjectKey(key);
    this.objects.set(key, { data: new Uint8Array(data), contentType });
    return Promise.resolve();
  }

  get(key: string): Promise<StoredObject | null> {
    const found = this.objects.get(key);
    if (found === undefined) return Promise.resolve(null);
    return Promise.resolve({ data: new Uint8Array(found.data), contentType: found.contentType });
  }

  delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  /** Test hook. */
  size(): number {
    return this.objects.size;
  }
}
