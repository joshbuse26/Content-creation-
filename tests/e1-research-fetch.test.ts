import { describe, expect, it } from "vitest";
import {
  FetchTimeoutError,
  guardedFetch,
  SsrfBlockedError,
  type DnsLookupFn,
  type GuardedFetchImpl,
} from "@/pipelines/research/ssrf";

/**
 * E1: research-fetch hardening (WAVE-D-PLAN §3 D4). Every outbound research
 * fetch has an explicit timeout, a size cap, and CANNOT hang the pipeline —
 * even a source that ignores the AbortSignal is cut off by a hard deadline
 * and surfaced as a skippable FetchTimeoutError. A slow/blocked source is
 * skipped (the pipeline's fetch loop catches these and continues), so a
 * golden/prod research run never stalls.
 */

const publicLookup: DnsLookupFn = () => Promise.resolve([{ address: "93.184.216.34" }]);

describe("guardedFetch never hangs", () => {
  it("rejects with FetchTimeoutError when the fetch IGNORES the abort signal", async () => {
    // A hostile impl that never resolves and never honors `signal`.
    const hung: GuardedFetchImpl = () => new Promise<Response>(() => {});
    const start = Date.now();
    await expect(
      guardedFetch("https://example.com/slow", {
        lookup: publicLookup,
        fetchImpl: hung,
        timeoutMs: 50,
      }),
    ).rejects.toBeInstanceOf(FetchTimeoutError);
    // Settled well within a small multiple of the deadline — proof of no hang.
    expect(Date.now() - start).toBeLessThan(2_000);
  });

  it("rejects with FetchTimeoutError when a body read stalls forever", async () => {
    const stallingBody: GuardedFetchImpl = () =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start() {
              /* never enqueues, never closes */
            },
          }),
          { status: 200 },
        ),
      );
    await expect(
      guardedFetch("https://example.com/stall", {
        lookup: publicLookup,
        fetchImpl: stallingBody,
        timeoutMs: 50,
      }),
    ).rejects.toBeInstanceOf(FetchTimeoutError);
  });

  it("a well-behaved fast source still returns normally", async () => {
    const ok: GuardedFetchImpl = () =>
      Promise.resolve(new Response("hello world", { status: 200 }));
    const page = await guardedFetch("https://example.com/ok", {
      lookup: publicLookup,
      fetchImpl: ok,
      timeoutMs: 1_000,
    });
    expect(page.status).toBe(200);
    expect(page.body).toBe("hello world");
  });

  it("the timeout error is a distinct, catchable type the pipeline skips", () => {
    const err = new FetchTimeoutError("slow");
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(SsrfBlockedError);
    expect(err.name).toBe("FetchTimeoutError");
  });
});
