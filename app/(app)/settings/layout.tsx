"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/shell/app-shell";

const tabs = [
  { href: "/settings/members", label: "Members" },
  { href: "/settings/billing", label: "Billing" },
  { href: "/settings/channels", label: "Channels" },
  { href: "/settings/api-keys", label: "API keys" },
];

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div>
      <PageHeader title="Settings" subtitle="Workspace members, billing, and channels." />
      <nav className="mb-6 flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {tabs.map((tab) => {
          const active = pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                active
                  ? "border-accent-600 text-accent-700 dark:border-accent-500 dark:text-accent-400"
                  : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
