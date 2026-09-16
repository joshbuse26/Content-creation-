"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconChevronDown } from "./icons";

/**
 * Minimal headless dropdown: trigger button + floating panel.
 * Closes on outside click and Escape. Panel content is caller-rendered.
 * Keyboard: Escape (and item selection via the provided `close`) returns
 * focus to the trigger; ArrowUp/ArrowDown move between menu items.
 */
export function Dropdown({
  trigger,
  children,
  align = "left",
  buttonClassName = "",
  chevron = true,
}: {
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  buttonClassName?: string;
  chevron?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const menuItems = (): HTMLButtonElement[] =>
    rootRef.current === null
      ? []
      : Array.from(rootRef.current.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).filter(
          (el) => !el.disabled,
        );

  const closeAndRestore = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        rootRef.current !== null &&
        e.target instanceof Node &&
        !rootRef.current.contains(e.target)
      ) {
        // Pointer moved elsewhere — close without stealing focus back.
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = menuItems();
    if (items.length === 0) return;
    e.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const delta = e.key === "ArrowDown" ? 1 : -1;
    const next =
      current === -1
        ? delta === 1
          ? 0
          : items.length - 1
        : (current + delta + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div
      ref={rootRef}
      className="relative inline-block"
      onKeyDown={open ? onMenuKeyDown : undefined}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
        }}
        className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 ${buttonClassName}`}
      >
        {trigger}
        {chevron ? <IconChevronDown size={12} className="text-zinc-400" /> : null}
      </button>
      {open ? (
        <div
          role="menu"
          className={`absolute z-30 mt-1 min-w-44 rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {children(closeAndRestore)}
        </div>
      ) : null}
    </div>
  );
}

export function DropdownItem({
  onSelect,
  selected = false,
  disabled = false,
  children,
}: {
  onSelect: () => void;
  selected?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        onSelect();
      }}
      className={`flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-zinc-800 ${
        selected
          ? "font-semibold text-accent-700 dark:text-accent-400"
          : "text-zinc-700 dark:text-zinc-300"
      }`}
    >
      {children}
    </button>
  );
}
