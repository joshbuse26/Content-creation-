// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { usePipelinePoll } from "../use-pipeline-poll";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("usePipelinePoll", () => {
  it("polls refetch on the interval after begin() and stops when data changes", () => {
    vi.useFakeTimers();
    const refetch = vi.fn();
    const { result, rerender } = renderHook(
      ({ data }: { data: string }) =>
        usePipelinePoll(refetch, data, { intervalMs: 1000, timeoutMs: 60_000 }),
      { initialProps: { data: "a" } },
    );
    expect(result.current.pending).toBe(false);

    act(() => {
      result.current.begin();
    });
    expect(result.current.pending).toBe(true);
    expect(result.current.timedOut).toBe(false);

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(refetch).toHaveBeenCalledTimes(3);

    // Data changed — polling stops, no further refetches.
    rerender({ data: "b" });
    expect(result.current.pending).toBe(false);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(refetch).toHaveBeenCalledTimes(3);
  });

  it("does not stop while the data reference is unchanged", () => {
    vi.useFakeTimers();
    const refetch = vi.fn();
    const { result, rerender } = renderHook(
      ({ data }: { data: string }) =>
        usePipelinePoll(refetch, data, { intervalMs: 1000, timeoutMs: 60_000 }),
      { initialProps: { data: "a" } },
    );
    act(() => {
      result.current.begin();
    });
    rerender({ data: "a" });
    expect(result.current.pending).toBe(true);
  });

  it("gives up after the timeout with a visible timedOut flag", () => {
    vi.useFakeTimers();
    const refetch = vi.fn();
    const { result } = renderHook(() =>
      usePipelinePoll(refetch, "a", { intervalMs: 1000, timeoutMs: 5000 }),
    );
    act(() => {
      result.current.begin();
    });
    act(() => {
      vi.advanceTimersByTime(5500);
    });
    expect(result.current.pending).toBe(false);
    expect(result.current.timedOut).toBe(true);
    const calls = refetch.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(refetch).toHaveBeenCalledTimes(calls);

    // A new begin() clears timedOut and restarts polling.
    act(() => {
      result.current.begin();
    });
    expect(result.current.pending).toBe(true);
    expect(result.current.timedOut).toBe(false);
  });

  it("clears timers on unmount", () => {
    vi.useFakeTimers();
    const refetch = vi.fn();
    const { result, unmount } = renderHook(() =>
      usePipelinePoll(refetch, "a", { intervalMs: 1000, timeoutMs: 60_000 }),
    );
    act(() => {
      result.current.begin();
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(refetch).not.toHaveBeenCalled();
  });
});
