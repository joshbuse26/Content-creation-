"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/marketing/site-chrome";
import { IconChannel, IconFolder, IconGear, IconSparkle } from "@/components/ui/icons";
import { useWorkspace } from "@/components/providers/workspace-context";
import { fmtNumber } from "@/components/lib/format";
import { isUiCreditExempt } from "@/components/lib/credits-ui";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { ChannelSwitcher } from "./channel-switcher";

const navItems = [
  { href: "/coach", label: "Coach", icon: IconSparkle },
  { href: "/projects", label: "Projects", icon: IconFolder },
  { href: "/ideas", label: "Ideas", icon: IconSparkle },
  { href: "/channels", label: "Channels", icon: IconChannel },
  { href: "/settings", label: "Settings", icon: IconGear },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { workspace } = useWorkspace();

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-20 flex w-60 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="px-4 pt-4 pb-2">
          <Link href="/projects" className="text-base">
            <Wordmark />
          </Link>
        </div>
        <div className="space-y-1 px-3 py-2">
          <WorkspaceSwitcher />
          <ChannelSwitcher />
        </div>
        <nav className="mt-2 flex-1 space-y-0.5 px-3">
          {navItems.map((item) => {
            const active = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                }`}
              >
                <Icon size={15} className={active ? "" : "text-zinc-400"} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-zinc-200 px-4 py-3 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          {workspace !== null ? (
            <div className="flex items-center justify-between">
              <span className="capitalize">{workspace.plan} plan</span>
              <Link
                href="/settings/billing"
                className="font-medium text-emerald-700 hover:underline dark:text-emerald-400"
              >
                {isUiCreditExempt(workspace.role)
                  ? "Unlimited"
                  : `${fmtNumber(workspace.creditBalance)} credits`}
              </Link>
            </div>
          ) : (
            <span>No workspace selected</span>
          )}
        </div>
      </aside>
      <div className="ml-60 min-w-0 flex-1">
        <main className="mx-auto max-w-6xl px-8 py-8">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle !== undefined ? (
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>
        ) : null}
      </div>
      {actions !== undefined ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
