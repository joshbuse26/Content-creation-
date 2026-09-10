import Link from "next/link";
import { PRODUCT_NAME } from "@/lib/branding";

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-baseline gap-1.5 ${className}`}>
      <span
        aria-hidden="true"
        className="inline-block h-2.5 w-2.5 self-center rounded-[3px] bg-emerald-600 dark:bg-emerald-500"
      />
      <span className="font-semibold tracking-tight">{PRODUCT_NAME}</span>
    </span>
  );
}

export function SiteNav() {
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
          <Link
            href="/login"
            className="font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            Sign in
          </Link>
          <Link
            href="/login"
            className="rounded-md bg-emerald-700 px-3.5 py-2 font-medium text-white hover:bg-emerald-600 dark:bg-emerald-600 dark:hover:bg-emerald-500"
          >
            Start writing
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-zinc-200 py-10 dark:border-zinc-800">
      <div className="mx-auto flex max-w-5xl flex-col items-start justify-between gap-4 px-6 text-sm text-zinc-500 sm:flex-row dark:text-zinc-400">
        <div>
          <Wordmark className="text-base" />
          <p className="mt-1 text-xs">Scripts your audience actually finishes.</p>
        </div>
        <nav className="flex gap-6">
          <Link href="/tools" className="hover:text-zinc-900 dark:hover:text-zinc-100">
            Free tools
          </Link>
          <Link href="/privacy" className="hover:text-zinc-900 dark:hover:text-zinc-100">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-zinc-900 dark:hover:text-zinc-100">
            Terms
          </Link>
          <Link href="/login" className="hover:text-zinc-900 dark:hover:text-zinc-100">
            Sign in
          </Link>
        </nav>
      </div>
    </footer>
  );
}
