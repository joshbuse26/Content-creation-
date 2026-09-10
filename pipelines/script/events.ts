import { Redis } from "ioredis";
import { getConfig } from "@/lib/config";
import { hasRedis } from "@/queue/connection";
import { scriptStreamEventSchema, type ScriptStreamEvent } from "@/lib/types/pipeline";
import { logger } from "@/lib/logger";

/**
 * Script event bus — carries the frozen ScriptStreamEvent union from the
 * pipeline to the SSE route (app/api/script-stream).
 *
 * Two implementations:
 * - In-process (fixture mode / tests / single-process dev): ring buffer per
 *   script + live listeners. Late subscribers replay from the start.
 * - Redis (production, web + worker are separate services): events RPUSHed
 *   to a capped list (replay) and PUBLISHed to a channel (live).
 *
 * A stream is over when a `complete` or `failed` event arrives.
 */

export function isTerminalEvent(event: ScriptStreamEvent): boolean {
  return event.type === "complete" || event.type === "failed";
}

export interface ScriptEventBus {
  publish(scriptId: string, event: ScriptStreamEvent): Promise<void>;
  /** Replays buffered events, then live ones, until a terminal event or abort. */
  subscribe(scriptId: string, signal?: AbortSignal): AsyncGenerator<ScriptStreamEvent>;
}

// ---------------------------------------------------------------------------
// In-process bus
// ---------------------------------------------------------------------------

interface Topic {
  events: ScriptStreamEvent[];
  listeners: Set<(event: ScriptStreamEvent) => void>;
}

export class InProcessScriptEventBus implements ScriptEventBus {
  private topics = new Map<string, Topic>();

  private topic(scriptId: string): Topic {
    let topic = this.topics.get(scriptId);
    if (topic === undefined) {
      topic = { events: [], listeners: new Set() };
      this.topics.set(scriptId, topic);
    }
    return topic;
  }

  publish(scriptId: string, event: ScriptStreamEvent): Promise<void> {
    const topic = this.topic(scriptId);
    topic.events.push(event);
    for (const listener of topic.listeners) listener(event);
    return Promise.resolve();
  }

  async *subscribe(scriptId: string, signal?: AbortSignal): AsyncGenerator<ScriptStreamEvent> {
    const topic = this.topic(scriptId);
    const queue: ScriptStreamEvent[] = [...topic.events];
    let resolveWait: (() => void) | null = null;
    const listener = (event: ScriptStreamEvent) => {
      queue.push(event);
      resolveWait?.();
      resolveWait = null;
    };
    topic.listeners.add(listener);
    const onAbort = () => {
      resolveWait?.();
      resolveWait = null;
    };
    signal?.addEventListener("abort", onAbort);
    try {
      for (;;) {
        const next = queue.shift();
        if (next !== undefined) {
          yield next;
          if (isTerminalEvent(next)) return;
          continue;
        }
        if (signal?.aborted === true) return;
        await new Promise<void>((resolve) => {
          resolveWait = resolve;
        });
      }
    } finally {
      topic.listeners.delete(listener);
      signal?.removeEventListener("abort", onAbort);
    }
  }
}

// ---------------------------------------------------------------------------
// Redis bus
// ---------------------------------------------------------------------------

const EVENT_TTL_SECONDS = 60 * 60; // replay window: one hour
const listKey = (scriptId: string) => `script-events:${scriptId}`;
const channelKey = (scriptId: string) => `script-events-live:${scriptId}`;

export class RedisScriptEventBus implements ScriptEventBus {
  constructor(private readonly redisUrl: string) {}

  private publisher: Redis | undefined;

  private getPublisher(): Redis {
    this.publisher ??= new Redis(this.redisUrl, { maxRetriesPerRequest: null });
    return this.publisher;
  }

  async publish(scriptId: string, event: ScriptStreamEvent): Promise<void> {
    const redis = this.getPublisher();
    const payload = JSON.stringify(event);
    await redis
      .multi()
      .rpush(listKey(scriptId), payload)
      .expire(listKey(scriptId), EVENT_TTL_SECONDS)
      .publish(channelKey(scriptId), payload)
      .exec();
  }

  async *subscribe(scriptId: string, signal?: AbortSignal): AsyncGenerator<ScriptStreamEvent> {
    // Dedicated connection: SUBSCRIBE takes over the connection in Redis.
    const sub = new Redis(this.redisUrl, { maxRetriesPerRequest: null });
    const queue: ScriptStreamEvent[] = [];
    let resolveWait: (() => void) | null = null;
    const push = (raw: string) => {
      const parsed = scriptStreamEventSchema.safeParse(JSON.parse(raw));
      if (parsed.success) {
        queue.push(parsed.data);
        resolveWait?.();
        resolveWait = null;
      } else {
        logger.warn({ scriptId }, "script event failed schema parse; dropped");
      }
    };
    const onAbort = () => {
      resolveWait?.();
      resolveWait = null;
    };
    signal?.addEventListener("abort", onAbort);
    try {
      sub.on("message", (_channel: string, message: string) => {
        push(message);
      });
      await sub.subscribe(channelKey(scriptId));
      // Replay AFTER subscribing so no gap exists; dedupe by replaying first.
      const replay = await this.getPublisher().lrange(listKey(scriptId), 0, -1);
      const seen = queue.splice(0, queue.length);
      for (const raw of replay) push(raw);
      for (const event of seen) queue.push(event);
      for (;;) {
        const next = queue.shift();
        if (next !== undefined) {
          yield next;
          if (isTerminalEvent(next)) return;
          continue;
        }
        if (signal?.aborted === true) return;
        await new Promise<void>((resolve) => {
          resolveWait = resolve;
        });
      }
    } finally {
      signal?.removeEventListener("abort", onAbort);
      sub.disconnect();
    }
  }
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

let cached: ScriptEventBus | undefined;

export function getScriptEventBus(): ScriptEventBus {
  if (cached === undefined) {
    const { REDIS_URL } = getConfig();
    cached =
      hasRedis() && REDIS_URL !== undefined
        ? new RedisScriptEventBus(REDIS_URL)
        : new InProcessScriptEventBus();
  }
  return cached;
}

export function setScriptEventBusForTests(bus: ScriptEventBus | undefined): void {
  cached = bus;
}
