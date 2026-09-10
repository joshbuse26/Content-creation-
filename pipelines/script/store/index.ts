import { hasDb } from "@/db";
import { DrizzleEngineStore } from "./drizzle";
import { InMemoryEngineStore } from "./memory";
import type { EngineStore } from "./types";

export type * from "./types";
export { InMemoryEngineStore } from "./memory";
export { DrizzleEngineStore } from "./drizzle";

let cached: EngineStore | undefined;

/**
 * Store selection: Drizzle when a database is configured, otherwise the
 * fixture-seeded in-memory store (zero-env mode) — one shared instance per
 * process so routers, pipelines, and the SSE route see the same data.
 */
export function getEngineStore(): EngineStore {
  cached ??= hasDb() ? new DrizzleEngineStore() : new InMemoryEngineStore();
  return cached;
}

/** Test hook: swap in a fresh store (or a specific instance). */
export function setEngineStoreForTests(store: EngineStore | undefined): void {
  cached = store;
}
