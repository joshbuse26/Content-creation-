import { Redis } from "ioredis";
import { getConfig } from "@/lib/config";

let cached: Redis | undefined;

/**
 * Shared Redis connection for BullMQ. `maxRetriesPerRequest: null` is a
 * BullMQ requirement. Lazy — nothing connects until a queue/worker is used.
 */
export function getRedisConnection(): Redis {
  if (cached === undefined) {
    const { REDIS_URL } = getConfig();
    if (REDIS_URL === undefined) {
      throw new Error("REDIS_URL is not set — queues require Redis");
    }
    cached = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  }
  return cached;
}

export function hasRedis(): boolean {
  return getConfig().REDIS_URL !== undefined;
}
