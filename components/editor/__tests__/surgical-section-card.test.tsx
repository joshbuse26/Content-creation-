// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { fixtureSections } from "@/lib/fixtures";
import { SectionCard, type SectionCardProps } from "../section-card";

/**
 * E4 — surgical edit affordance + role gating on the section card.
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error("fixture sections missing");
  return v;
}
const chapter = must(fixtureSections[2]);

function renderCard(overrides: Partial<SectionCardProps> = {}) {
  const props: SectionCardProps = {
    section: chapter,
    isFirst: false,
    isLast: false,
    onMove: () => undefined,
    onToggleLock: () => undefined,
    onSaveEdit: () => undefined,
    onRegenerate: () => undefined,
    ...overrides,
  };
  return render(<SectionCard {...props} />);
}

describe("SectionCard — surgical edit", () => {
  it("routes to onSurgicalRegenerate when a body span is highlighted", () => {
    const onRegenerate = vi.fn();
    const onSurgicalRegenerate = vi.fn();
    renderCard({ onRegenerate, onSurgicalRegenerate });

    // Simulate highlighting a span inside the body paragraph.
    const selected = chapter.body.slice(0, 20);
    const body = screen.getByText(
      (_c, el) => el?.tagName === "P" && el.textContent === chapter.body,
    );
    vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => selected,
      rangeCount: 1,
      getRangeAt: () => ({ commonAncestorContainer: body }) as unknown as Range,
    } as unknown as Selection);
    fireEvent.mouseUp(body);

    // The steering box opened with the selection chip; type a note + submit.
    const input = screen.getByPlaceholderText(/steer the rewrite/i);
    fireEvent.change(input, { target: { value: "tighten it" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    expect(onSurgicalRegenerate).toHaveBeenCalledWith({
      guidance: "tighten it",
      selectionText: selected,
    });
    expect(onRegenerate).not.toHaveBeenCalled();
  });
});

describe("SectionCard — role gating", () => {
  it("a viewer (canWrite=false) cannot edit or regenerate", () => {
    renderCard({ canWrite: false });
    expect(screen.getByRole("button", { name: /edit text/i }).hasAttribute("disabled")).toBe(true);
    expect(
      screen
        .getByRole("button", { name: /regenerate with a steering note/i })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("renders the comment slot", () => {
    renderCard({ commentSlot: <div data-testid="comment-slot">thread</div> });
    expect(screen.getByTestId("comment-slot")).toBeTruthy();
  });
});
