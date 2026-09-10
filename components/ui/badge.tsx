import type { ReactNode } from "react";

export type BadgeTone =
  | "neutral"
  | "green"
  | "yellow"
  | "red"
  | "blue"
  | "purple"
  | "emerald"
  | "orange";

const toneClasses: Record<BadgeTone, string> = {
  neutral: "bg-zinc-200/70 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  green: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  emerald: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  yellow: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300",
  red: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  blue: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  purple: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  orange: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
};

export function Badge({
  tone = "neutral",
  className = "",
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] leading-4 font-medium whitespace-nowrap ${toneClasses[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
