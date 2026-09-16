import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/app-shell";
import { TOOLKIT_TOOLS } from "@/components/toolkit/tools";
import { IconExternal } from "@/components/ui/icons";

export const metadata: Metadata = { title: "Tools" };

/** Tools landing — a grid of real surfaces (F1 stub; F4 owns the full grid). */
export default function ToolkitPage() {
  return (
    <div>
      <PageHeader title="Tools" subtitle="Every studio tool, one click away." />
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Tools">
        {TOOLKIT_TOOLS.map((tool) => (
          <li key={tool.slug}>
            <Link
              href={tool.href}
              className="group flex h-full flex-col gap-2 rounded-card border border-zinc-200 bg-white p-4 transition-colors hover:border-accent-500 dark:border-line dark:bg-surface dark:hover:bg-surface-2"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{tool.title}</span>
                <IconExternal
                  size={13}
                  className="text-zinc-400 transition-colors group-hover:text-accent-400 dark:text-muted"
                />
              </span>
              <span className="text-xs text-zinc-500 dark:text-muted">{tool.blurb}</span>
              <span className="mt-auto pt-1 text-[11px] font-medium tracking-wide text-zinc-400 uppercase dark:text-muted">
                {tool.opens}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
