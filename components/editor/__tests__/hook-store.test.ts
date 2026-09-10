// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { HookCandidate } from "@/lib/types/pipeline";
import { loadHookCandidates, storeHookCandidates } from "../hook-store";

const candidates: HookCandidate[] = [
  { style: "open_loop", body: "What if the cheap one wins?", autoPicked: true },
  { style: "stakes", body: "If it loses, I sell my rig.", autoPicked: false },
];

const key = "gr.hooks.script-1";

beforeEach(() => {
  window.localStorage.clear();
});

describe("hook-store", () => {
  it("round-trips valid candidates", () => {
    storeHookCandidates("script-1", candidates);
    expect(loadHookCandidates("script-1")).toEqual(candidates);
  });

  it("returns null when nothing is stored", () => {
    expect(loadHookCandidates("script-1")).toBeNull();
  });

  it("returns null and clears the key on malformed JSON", () => {
    window.localStorage.setItem(key, "{not json");
    expect(loadHookCandidates("script-1")).toBeNull();
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it("returns null and clears the key on schema-invalid data", () => {
    window.localStorage.setItem(
      key,
      JSON.stringify([{ style: "clickbait", body: 42, autoPicked: "yes" }]),
    );
    expect(loadHookCandidates("script-1")).toBeNull();
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it("rejects a non-array payload", () => {
    window.localStorage.setItem(key, JSON.stringify({ style: "open_loop" }));
    expect(loadHookCandidates("script-1")).toBeNull();
    expect(window.localStorage.getItem(key)).toBeNull();
  });
});
