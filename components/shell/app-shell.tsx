"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { ChatThreadsProvider } from "@/components/chat/chat-threads-context";
import { Wordmark } from "@/components/marketing/site-chrome";
import { useWorkspace } from "@/components/providers/workspace-context";
import { fmtNumber } from "@/components/lib/format";
import { isUiCreditExempt } from "@/components/lib/credits-ui";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { ChannelSwitcher } from "./channel-switcher";
import { CoachRail } from "./coach-rail";
import { MainErrorBoundary } from "./main-error-boundary";
import { APP_HOME, APP_NAV, sectionFor } from "./nav";
import { TopBar } from "./top-bar";
import { WorkspaceGate } from "./workspace-gate";

/**
 * The command-center shell: a fixed left rail (brand · switchers · sections ·
 * Coach chats · workspace footer), a top bar (breadcrumb · search · primary
 * CTA) and a full-bleed main pane. One shell for every authenticated route;
 * the theme is forced dark by app/(app)/layout.tsx.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const onCoach = sectionFor(pathname)?.href === APP_HOME;

  return (
    // ONE thread provider for the whole shell (stable tree across
    // navigation); it only fetches on the Coach, where the rail shows chats.
    <ChatThreadsProvider projectId={null} enabled={onCoach}>
      <div className="flex h-screen overflow-hidden">
        <Rail pathname={pathname} showCoach={onCoach} />
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Suspense: the search box reads useSearchParams. Same-height fallback → no layout shift. */}
          <Suspense fallback={<div className="h-14 shrink-0 border-b border-line bg-surface" />}>
            <TopBar />
          </Suspense>
          {/* The pane is the scroll container: full-height surfaces (Coach) fill
              it and scroll their own message list; long pages scroll here. */}
          <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-6">
            <MainErrorBoundary resetKey={pathname}>
              <WorkspaceGate>{children}</WorkspaceGate>
            </MainErrorBoundary>
          </main>
        </div>
      </div>
    </ChatThreadsProvider>
  );
}

function Rail({ pathname, showCoach }: { pathname: string; showCoach: boolean }) {
  const { workspace } = useWorkspace();
  const active = sectionFor(pathname);

  return (
    <aside className="flex w-rail shrink-0 flex-col border-r border-line bg-surface">
      <div className="px-4 pt-4 pb-2">
        <Link href={APP_HOME} className="text-base" aria-label="Home">
          <Wordmark />
        </Link>
      </div>
      <div className="space-y-1 px-3 py-2">
        <WorkspaceSwitcher />
        <ChannelSwitcher />
      </div>
      <nav className="mt-1 space-y-0.5 px-3" aria-label="Sections">
        {APP_NAV.map((item) => {
          const isActive = item.href === active?.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={`relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-surface-2 text-ink before:absolute before:top-1.5 before:bottom-1.5 before:-left-3 before:w-0.5 before:rounded-r before:bg-accent-500"
                  : "text-muted hover:bg-surface-2 hover:text-ink"
              }`}
            >
              <Icon size={15} className={isActive ? "text-accent-400" : ""} />
              {item.label}
            </Link>
          );
        })}
      </nav>
      {showCoach ? (
        <>
          <div className="mx-3 my-3 border-t border-line" />
          <CoachRail />
        </>
      ) : (
        <div className="flex-1" />
      )}
      <footer className="border-t border-line px-4 py-3 text-xs text-muted">
        {workspace !== null ? (
          <div className="flex items-center gap-2">
            <span className="min-w-0 truncate" title={workspace.name}>
              {workspace.name}
            </span>
            <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-ink uppercase">
              {workspace.plan}
            </span>
            <span className="flex-1" />
            <Link
              href="/settings/billing"
              className="shrink-0 font-medium text-accent-400 hover:underline"
            >
              {isUiCreditExempt(workspace.role)
                ? "Unlimited"
                : `${fmtNumber(workspace.creditBalance)} credits`}
            </Link>
          </div>
        ) : (
          <span>No workspace selected</span>
        )}
      </footer>
    </aside>
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
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle !== undefined ? (
          <p className="mt-1 text-sm text-zinc-500 dark:text-muted">{subtitle}</p>
        ) : null}
      </div>
      {actions !== undefined ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
