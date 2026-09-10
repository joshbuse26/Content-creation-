// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Dropdown, DropdownItem } from "../dropdown";

afterEach(cleanup);

function renderMenu(onPick: (v: string) => void = () => undefined) {
  return render(
    <Dropdown trigger={<span>Options</span>}>
      {(close) => (
        <>
          <DropdownItem
            onSelect={() => {
              onPick("a");
              close();
            }}
          >
            Alpha
          </DropdownItem>
          <DropdownItem disabled onSelect={() => undefined}>
            Beta (disabled)
          </DropdownItem>
          <DropdownItem
            onSelect={() => {
              onPick("c");
              close();
            }}
          >
            Gamma
          </DropdownItem>
        </>
      )}
    </Dropdown>,
  );
}

const trigger = () => screen.getByRole("button", { name: /options/i });

describe("Dropdown", () => {
  it("opens on click and closes on Escape, restoring focus to the trigger", () => {
    renderMenu();
    fireEvent.click(trigger());
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("selecting an item closes the menu and restores focus to the trigger", () => {
    const onPick = vi.fn();
    renderMenu(onPick);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitem", { name: "Alpha" }));
    expect(onPick).toHaveBeenCalledWith("a");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("ArrowDown/ArrowUp move focus between enabled menu items, wrapping and skipping disabled", () => {
    renderMenu();
    fireEvent.click(trigger());
    trigger().focus();
    const root = trigger().parentElement as HTMLElement;

    fireEvent.keyDown(root, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Alpha" }));

    // Skips the disabled item and lands on Gamma.
    fireEvent.keyDown(root, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Gamma" }));

    // Wraps back to the first enabled item.
    fireEvent.keyDown(root, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Alpha" }));

    fireEvent.keyDown(root, { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Gamma" }));
  });

  it("closes on outside click without stealing focus", () => {
    renderMenu();
    fireEvent.click(trigger());
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
