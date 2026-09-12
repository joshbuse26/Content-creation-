// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SET_UNIQUE_ANGLE_NUDGE } from "@/lib/style-gates";
import { UniqueAngleNudge } from "../unique-angle-nudge";

afterEach(cleanup);

describe("UniqueAngleNudge", () => {
  it("shows the nudge copy when the angle is blank", () => {
    render(<UniqueAngleNudge angle="" />);
    expect(screen.getByRole("note").textContent).toBe(SET_UNIQUE_ANGLE_NUDGE);
  });

  it("treats whitespace-only and nullish angles as blank", () => {
    const { rerender } = render(<UniqueAngleNudge angle="   " />);
    expect(screen.getByRole("note")).toBeTruthy();
    rerender(<UniqueAngleNudge angle={null} />);
    expect(screen.getByRole("note")).toBeTruthy();
    rerender(<UniqueAngleNudge angle={undefined} />);
    expect(screen.getByRole("note")).toBeTruthy();
  });

  it("hides once an angle is set", () => {
    render(<UniqueAngleNudge angle="Blind-test budget espresso machines against a $3k flagship" />);
    expect(screen.queryByRole("note")).toBeNull();
  });
});
