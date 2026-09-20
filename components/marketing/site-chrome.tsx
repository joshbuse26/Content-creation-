import Link from "next/link";
import { PRODUCT_NAME } from "@/lib/branding";
import { getConfig } from "@/lib/config";
import { APP_HOME } from "@/components/shell/nav";

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-baseline gap-1.5 ${className}`}>
      <span
        aria-hidden="true"
        className="inline-block h-2.5 w-2.5 self-center rounded-[3px] bg-accent-600 dark:bg-accent-500"
      />
      <span className="font-semibold tracking-tight">{PRODUCT_NAME}</span>
    </span>
  );
}

export function SiteNav() {
  const fixtureMode = getConfig().PROVIDERS === "fixture";
  const enterHref = fixtureMode ? APP_HOME : "/login";
  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
        <Link href="/" className="text-lg">
          <Wordmark />
        </Link>
        <nav className="flex items-center gap-6 text-sm">
          <Link
            href="/tools"
            className="font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            Free tools
          </Link>
          {fixtureMode ? null : (
            <Link
              href="/login"
              className="font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              Sign in
            </Link>
          )}
          <Link
            href={enterHref}
            className="rounded-md bg-accent-700 px-3.5 py-2 font-medium text-white hover:bg-accent-600 dark:bg-accent-600 dark:hover:bg-accent-500"
          >
            {fixtureMode ? "Enter the app" : "Start writing"}
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-zinc-200 py-8">
      <nav className="mx-auto flex max-w-4xl gap-6 px-6 text-sm text-zinc-500">
        <Link href="/terms" className="hover:text-zinc-900">
          Terms
        </Link>
        <Link href="/privacy" className="hover:text-zinc-900">
          Privacy
        </Link>
        <Link href="/login" className="hover:text-zinc-900">
          Sign in
        </Link>
      </nav>
    </footer>
  );
}
