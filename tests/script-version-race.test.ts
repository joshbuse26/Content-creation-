import { describe, expect, it } from "vitest";
import { isUniqueViolation } from "@/pipelines/script/store/drizzle";

/**
 * Regression tests for the script-version race fix: createScript retries
 * once when the insert collides on scripts_project_version_uq (Postgres
 * SQLSTATE 23505). The retry itself is a plain recompute-and-reinsert; the
 * classifier that gates it must recognize pg's error in every wrapping
 * drizzle applies.
 */

describe("isUniqueViolation", () => {
  it("recognizes a bare pg unique-violation error", () => {
    const err = Object.assign(new Error("duplicate key value"), { code: "23505" });
    expect(isUniqueViolation(err)).toBe(true);
  });

  it("recognizes a wrapped pg error (drizzle sets .cause)", () => {
    const pgErr = Object.assign(new Error("duplicate key value"), { code: "23505" });
    const wrapped = new Error("Failed query", { cause: pgErr });
    expect(isUniqueViolation(wrapped)).toBe(true);
    const doubleWrapped = new Error("outer", { cause: wrapped });
    expect(isUniqueViolation(doubleWrapped)).toBe(true);
  });

  it("rejects other errors", () => {
    expect(isUniqueViolation(new Error("connection refused"))).toBe(false);
    expect(isUniqueViolation(Object.assign(new Error("fk"), { code: "23503" }))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false);
  });
});
