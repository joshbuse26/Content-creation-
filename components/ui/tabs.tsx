"use client";

import type { ReactNode } from "react";

export interface TabDef<T extends string> {
  id: T;
  label: ReactNode;
}

/** Simple controlled tab strip; keyboard accessible via native buttons. */
export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  className = "",
}: {
  tabs: TabDef<T>[];
  active: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={`flex flex-wrap items-center gap-1 border-b border-zinc-200 dark:border-zinc-800 ${className}`}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={isActive}
            onClick={() => {
              onChange(tab.id);
            }}
            className={`-mb-px cursor-pointer rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              isActive
                ? "border-emerald-600 text-emerald-700 dark:border-emerald-500 dark:text-emerald-400"
                : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
