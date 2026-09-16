import type { Metadata } from "next";
import Link from "next/link";
import { TOOL_DEFS } from "@/components/tools/tool-defs";
import { PRODUCT_NAME } from "@/lib/branding";

export const metadata: Metadata = {
  title: "Free YouTube Tools",
  description: `Free tools for YouTube creators from ${PRODUCT_NAME}: title generator, tag generator, description generator, and hook analyzer. No account needed.`,
  alternates: { canonical: "/tools" },
  openGraph: {
    title: `Free YouTube Tools · ${PRODUCT_NAME}`,
    description: "Titles, tags, descriptions, and hook analysis — free, fast, no account needed.",
    url: "/tools",
    type: "website",
  },
};

export default function ToolsIndexPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <p className="text-xs font-semibold uppercase tracking-widest text-accent-700 dark:text-accent-500">
        Free tools
      </p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight">Package a video in minutes, free</h1>
      <p className="mt-3 max-w-xl text-zinc-600 dark:text-zinc-400">
        Four small tools from the {PRODUCT_NAME} studio. No account, no card — five runs a day per
        tool set.
      </p>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {TOOL_DEFS.map((t) => (
          <Link
            key={t.id}
            href={t.path}
            className="rounded-lg border border-zinc-200 bg-white p-5 transition-colors hover:border-accent-600 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-accent-500"
          >
            <h2 className="font-semibold">{t.name}</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t.blurb}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
