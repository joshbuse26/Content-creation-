// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { fixtureSections } from "@/lib/fixtures";
import { wordCount } from "../logic/stats";
import { SectionCard, type SectionCardProps } from "../section-card";

afterEach(cleanup);

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

describe("SectionCard", () => {
  it("shows the section word count", () => {
    renderCard();
    const words = wordCount(chapter.body);
    expect(screen.getByText(new RegExp(`${words}w`))).toBeTruthy();
  });

  it("move buttons call onMove with the direction, and respect edges", () => {
    const onMove = vi.fn();
    renderCard({ onMove, isFirst: true });
    const up = screen.getByRole("button", { name: /move section up/i });
    const down = screen.getByRole("button", { name: /move section down/i });
    expect(up.hasAttribute("disabled")).toBe(true);
    fireEvent.click(down);
    expect(onMove).toHaveBeenCalledWith(1);
  });

  it("toggles the lock", () => {
    const onToggleLock = vi.fn();
    renderCard({ onToggleLock });
    fireEvent.click(screen.getByRole("button", { name: /lock section/i }));
    expect(onToggleLock).toHaveBeenCalledTimes(1);
  });

  it("locked sections disable editing and regeneration actions", () => {
    renderCard({ section: { ...chapter, locked: true } });
    expect(screen.getByRole("button", { name: /edit text/i }).hasAttribute("disabled")).toBe(true);
    expect(
      screen
        .getByRole("button", { name: /regenerate with a steering note/i })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("Alt+arrow reorders an unlocked section but respects locked (like the buttons)", () => {
    const onMove = vi.fn();
    const { unmount } = renderCard({ onMove });
    fireEvent.keyDown(screen.getByLabelText(chapter.heading), { key: "ArrowDown", altKey: true });
    expect(onMove).toHaveBeenCalledWith(1);
    unmount();

    const onMoveLocked = vi.fn();
    renderCard({ onMove: onMoveLocked, section: { ...chapter, locked: true } });
    const card = screen.getByLabelText(chapter.heading);
    fireEvent.keyDown(card, { key: "ArrowDown", altKey: true });
    fireEvent.keyDown(card, { key: "ArrowUp", altKey: true });
    expect(onMoveLocked).not.toHaveBeenCalled();
  });

  it("submits a steering note through onRegenerate", () => {
    const onRegenerate = vi.fn();
    renderCard({ onRegenerate });
    fireEvent.click(screen.getByRole("button", { name: /regenerate with a steering note/i }));
    const input = screen.getByPlaceholderText(/steer the rewrite/i);
    fireEvent.change(input, { target: { value: "lead with the price reveal" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(onRegenerate).toHaveBeenCalledWith("lead with the price reveal");
  });

  it("editing the body fires onSaveEdit with only the changed fields", () => {
    const onSaveEdit = vi.fn();
    renderCard({ onSaveEdit });
    fireEvent.click(screen.getByRole("button", { name: /edit text/i }));
    const textarea = screen.getByDisplayValue(chapter.body);
    fireEvent.change(textarea, { target: { value: "Shorter body." } });
    fireEvent.click(screen.getByRole("button", { name: /save edits/i }));
    expect(onSaveEdit).toHaveBeenCalledWith({ body: "Shorter body." });
  });

  it("highlights unsupported claims in yellow marks", () => {
    const section = {
      ...chapter,
      body: "The moon is made of cheese, obviously.",
      factRefs: [{ claim: "The moon is made of cheese", researchDocId: null }],
    };
    renderCard({ section });
    const mark = screen.getByText("The moon is made of cheese");
    expect(mark.tagName).toBe("MARK");
    expect(mark.className).toContain("claim-unsupported");
  });
});
