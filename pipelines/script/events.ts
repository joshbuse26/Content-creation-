import { Redis } from "ioredis";
import { z } from "zod";
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

/**
 * Live pub/sub envelope (adversarial F7): every event's position in the
 * RPUSH list is its sequence number, and the live message carries it so a
 * subscriber can drop live events already covered by its replay — an event
 * landing in the subscribe→LRANGE window is otherwise BOTH replayed and
 * delivered live (double-emit).
 */
const liveEnvelopeSchema = z.object({
  seq: z.number().int().nonnegative(),
  event: scriptStreamEventSchema,
});

/** Injectable for tests; production uses real ioredis connections. */
type RedisClientFactory = (redisUrl: string) => Redis;

const defaultRedisClient: RedisClientFactory = (url) =>
  new Redis(url, { maxRetriesPerRequest: null });

export class RedisScriptEventBus implements ScriptEventBus {
  constructor(
    private readonly redisUrl: string,
    private readonly createClient: RedisClientFactory = defaultRedisClient,
  ) {}

  private publisher: Redis | undefined;

  private getPublisher(): Redis {
    this.publisher ??= this.createClient(this.redisUrl);
    return this.publisher;
  }

  async publish(scriptId: string, event: ScriptStreamEvent): Promise<void> {
    const redis = this.getPublisher();
    const payload = JSON.stringify(event);
    // RPUSH first — its returned list length assigns the event's sequence
    // (index in the list) — then publish the enveloped live copy.
    const results = await redis
      .multi()
      .rpush(listKey(scriptId), payload)
      .expire(listKey(scriptId), EVENT_TTL_SECONDS)
      .exec();
    const pushResult = results?.[0];
    if (pushResult?.[0] instanceof Error) throw pushResult[0];
    const seq = Number(pushResult?.[1]) - 1;
    await redis.publish(channelKey(scriptId), JSON.stringify({ seq, event }));
  }

  async *subscribe(scriptId: string, signal?: AbortSignal): AsyncGenerator<ScriptStreamEvent> {
    // Dedicated connection: SUBSCRIBE takes over the connection in Redis.
    const sub = this.createClient(this.redisUrl);
    const queue: ScriptStreamEvent[] = [];
    let resolveWait: (() => void) | null = null;
    const wake = () => {
      resolveWait?.();
      resolveWait = null;
    };
    // Sequence bookkeeping: replayed events occupy list indices 0..maxSeq;
    // a live event is delivered only when its seq extends past maxSeq, so
    // events raced into the subscribe→LRANGE window emit exactly once.
    let replayDone = false;
    let maxSeq = -1;
    const pending: { seq: number; event: ScriptStreamEvent }[] = [];
    const onLive = (raw: string) => {
      let candidate: unknown;
      try {
        candidate = JSON.parse(raw);
      } catch {
        logger.warn({ scriptId }, "script event failed JSON parse; dropped");
        return;
      }
      // Enveloped (current publishers) or bare (a not-yet-redeployed
      // publisher mid-rolling-deploy — no seq, so no dedupe possible).
      const envelope = liveEnvelopeSchema.safeParse(candidate);
      const seq = envelope.success ? envelope.data.seq : Number.POSITIVE_INFINITY;
      const parsed = envelope.success
        ? { success: true as const, data: envelope.data.event }
        : scriptStreamEventSchema.safeParse(candidate);
      if (!parsed.success) {
        logger.warn({ scriptId }, "script event failed schema parse; dropped");
        return;
      }
      if (!replayDone) {
        pending.push({ seq, event: parsed.data });
        return;
      }
      if (seq <= maxSeq) return; // already covered by the replay
      if (Number.isFinite(seq)) maxSeq = seq;
      queue.push(parsed.data);
      wake();
    };
    const onAbort = () => {
      wake();
    };
    signal?.addEventListener("abort", onAbort);
    try {
      sub.on("message", (_channel: string, message: string) => {
        onLive(message);
      });
      await sub.subscribe(channelKey(scriptId));
      // Replay AFTER subscribing so no gap exists; the list index is the
      // sequence, so live events buffered during the LRANGE are deduped
      // against it instead of double-emitted.
      const replay = await this.getPublisher().lrange(listKey(scriptId), 0, -1);
      for (const raw of replay) {
        const parsed = scriptStreamEventSchema.safeParse(JSON.parse(raw));
        if (parsed.success) queue.push(parsed.data);
        else logger.warn({ scriptId }, "script event failed schema parse; dropped");
      }
      maxSeq = replay.length - 1;
      replayDone = true;
      for (const buffered of pending.sort((a, b) => a.seq - b.seq)) {
        if (buffered.seq <= maxSeq) continue;
        if (Number.isFinite(buffered.seq)) maxSeq = buffered.seq;
        queue.push(buffered.event);
      }
      pending.length = 0;
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
