"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconChevronDown } from "./icons";

/**
 * Minimal headless dropdown: trigger button + floating panel.
 * Closes on outside click and Escape. Panel content is caller-rendered.
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

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current !== null && e.target instanceof Node && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
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
          {children(() => {
            setOpen(false);
          })}
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
        selected ? "font-semibold text-emerald-700 dark:text-emerald-400" : "text-zinc-700 dark:text-zinc-300"
      }`}
    >
      {children}
    </button>
  );
}
