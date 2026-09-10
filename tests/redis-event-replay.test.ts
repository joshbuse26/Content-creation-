import { describe, expect, it } from "vitest";
import type { Redis } from "ioredis";
import { scriptIdSchema } from "@/lib/types/ids";
import type { ScriptStreamEvent } from "@/lib/types/pipeline";
import { RedisScriptEventBus } from "@/pipelines/script/events";

/**
 * Wave-C adversarial F7: an event published in the subscribe→LRANGE window
 * lands in BOTH the replay list and the live channel. The sequence envelope
 * (list index) must dedupe it to exactly one emission.
 *
 * The fake below implements only the surface the bus uses (multi/rpush/
 * expire/exec, publish, lrange, subscribe/on, disconnect), with a gate on
 * LRANGE so the test can hold the replay open while a publish races in.
 */

const SCRIPT_ID = "00000000-0000-4000-8000-000000000077";
const CHANNEL = `script-events-live:${SCRIPT_ID}`;

type MessageHandler = (channel: string, message: string) => void;

class FakeRedisServer {
  readonly lists = new Map<string, string[]>();
  readonly subscribers = new Map<string, Set<MessageHandler>>();
  /** When set, LRANGE waits on it before reading — the race window. */
  lrangeGate: Promise<void> | null = null;
}

class FakeRedis {
  private readonly handlers: MessageHandler[] = [];

  constructor(private readonly server: FakeRedisServer) {}

  multi() {
    const ops: (() => unknown)[] = [];
    const chain = {
      rpush: (key: string, value: string) => {
        ops.push(() => {
          const list = this.server.lists.get(key) ?? [];
          list.push(value);
          this.server.lists.set(key, list);
          return list.length;
        });
        return chain;
      },
      expire: () => {
        ops.push(() => 1);
        return chain;
      },
      exec: () => Promise.resolve(ops.map((op) => [null, op()] as [null, unknown])),
    };
    return chain;
  }

  publish(channel: string, message: string): Promise<number> {
    const subs = this.server.subscribers.get(channel) ?? new Set();
    for (const handler of subs) handler(channel, message);
    return Promise.resolve(subs.size);
  }

  async lrange(key: string): Promise<string[]> {
    if (this.server.lrangeGate !== null) await this.server.lrangeGate;
    return [...(this.server.lists.get(key) ?? [])];
  }

  on(event: string, handler: MessageHandler): this {
    if (event === "message") this.handlers.push(handler);
    return this;
  }

  subscribe(channel: string): Promise<number> {
    const set = this.server.subscribers.get(channel) ?? new Set();
    set.add((ch, msg) => {
      for (const handler of this.handlers) handler(ch, msg);
    });
    this.server.subscribers.set(channel, set);
    return Promise.resolve(1);
  }

  disconnect(): void {
    /* no-op */
  }
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function makeBus(server: FakeRedisServer): RedisScriptEventBus {
  return new RedisScriptEventBus("redis://fake", () => new FakeRedis(server) as unknown as Redis);
}

const stageEvent = (
  stage: "assemble_context" | "outline" | "draft_sections",
): ScriptStreamEvent => ({
  type: "stage_started",
  stage,
});
const completeEvent: ScriptStreamEvent = {
  type: "complete",
  scriptId: scriptIdSchema.parse(SCRIPT_ID),
};

async function waitForSubscriber(server: FakeRedisServer): Promise<void> {
  while ((server.subscribers.get(CHANNEL)?.size ?? 0) === 0) await tick();
}

describe("RedisScriptEventBus replay dedupe (F7)", () => {
  it("an event landing in the subscribe→LRANGE window emits exactly once", async () => {
    const server = new FakeRedisServer();
    const bus = makeBus(server);
    await bus.publish(SCRIPT_ID, stageEvent("assemble_context"));
    await bus.publish(SCRIPT_ID, stageEvent("outline"));

    // Hold the replay LRANGE open while a publish races into the window.
    let openGate: () => void = () => undefined;
    server.lrangeGate = new Promise<void>((resolve) => {
      openGate = resolve;
    });

    const collected: ScriptStreamEvent[] = [];
    const consumer = (async () => {
      for await (const event of bus.subscribe(SCRIPT_ID)) {
        collected.push(event);
      }
    })();

    await waitForSubscriber(server);
    // In-window publish: RPUSHed (so the pending LRANGE will replay it) AND
    // delivered live to the already-subscribed consumer.
    await bus.publish(SCRIPT_ID, stageEvent("draft_sections"));
    openGate();
    server.lrangeGate = null;
    await tick();

    // A post-replay live event still flows, and the terminal event closes.
    await bus.publish(SCRIPT_ID, completeEvent);
    await consumer;

    expect(collected).toEqual([
      stageEvent("assemble_context"),
      stageEvent("outline"),
      stageEvent("draft_sections"), // exactly once — not replay + live
      completeEvent,
    ]);
  });

  it("late subscriber replays everything once and ends at the terminal event", async () => {
    const server = new FakeRedisServer();
    const bus = makeBus(server);
    await bus.publish(SCRIPT_ID, stageEvent("assemble_context"));
    await bus.publish(SCRIPT_ID, completeEvent);

    const collected: ScriptStreamEvent[] = [];
    for await (const event of bus.subscribe(SCRIPT_ID)) {
      collected.push(event);
    }
    expect(collected).toEqual([stageEvent("assemble_context"), completeEvent]);
  });

  it("a bare (legacy, un-enveloped) live payload from an old publisher still flows", async () => {
    const server = new FakeRedisServer();
    const bus = makeBus(server);

    const collected: ScriptStreamEvent[] = [];
    const consumer = (async () => {
      for await (const event of bus.subscribe(SCRIPT_ID)) {
        collected.push(event);
      }
    })();
    await waitForSubscriber(server);
    await tick(); // replay (empty) completes

    const legacy = new FakeRedis(server);
    await legacy.publish(CHANNEL, JSON.stringify(stageEvent("outline")));
    await legacy.publish(CHANNEL, JSON.stringify(completeEvent));
    await consumer;

    expect(collected).toEqual([stageEvent("outline"), completeEvent]);
  });
});
