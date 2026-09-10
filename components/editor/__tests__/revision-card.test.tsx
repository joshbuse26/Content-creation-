// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { fixtureRevision, fixtureSections } from "@/lib/fixtures";
import { RevisionCard } from "../revision-card";

afterEach(cleanup);

function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error("fixture sections missing");
  return v;
}

const intro = must(fixtureSections[1]);

function renderCard(
  decision: "pending" | "accepted" | "rejected",
  handlers?: {
    onAccept?: () => void;
    onReject?: () => void;
  },
) {
  return render(
    <RevisionCard
      revision={fixtureRevision}
      sectionHeading={intro.heading}
      sectionBody={intro.body}
      decision={decision}
      onAccept={handlers?.onAccept ?? (() => undefined)}
      onReject={handlers?.onReject ?? (() => undefined)}
    />,
  );
}

describe("RevisionCard", () => {
  it("shows the suggestion, rationale, and a red/green line diff", () => {
    renderCard("pending");
    expect(screen.getByText(fixtureRevision.suggestion)).toBeTruthy();
    expect(screen.getByText(`Why: ${fixtureRevision.rationale}`)).toBeTruthy();
    // Original line struck out (red), replacement line added (green).
    expect(screen.getByText(intro.body)).toBeTruthy();
    const replacement = fixtureRevision.diff[0]?.replacement ?? "";
    expect(screen.getByText(replacement)).toBeTruthy();
  });

  it("fires onAccept / onReject from the per-suggestion buttons", () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    renderCard("pending", { onAccept, onReject });
    fireEvent.click(screen.getByRole("button", { name: "Accept suggestion" }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Reject suggestion" }));
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it("replaces the buttons with a status badge once decided", () => {
    renderCard("accepted");
    expect(screen.queryByRole("button", { name: "Accept suggestion" })).toBeNull();
    expect(screen.getByText("accepted")).toBeTruthy();
  });

  it("keeps the diff visible on rejected suggestions but not accepted ones", () => {
    const rejected = renderCard("rejected");
    const replacement = fixtureRevision.diff[0]?.replacement ?? "";
    expect(rejected.queryByText(replacement)).toBeTruthy();
    rejected.unmount();
    renderCard("accepted");
    expect(screen.queryByText(replacement)).toBeNull();
  });
});
