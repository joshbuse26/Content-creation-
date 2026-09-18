"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type SyntheticEvent } from "react";
import { useOptionalChatThreads } from "@/components/chat/chat-threads-context";
import { Button } from "@/components/ui/button";
import { IconPlus, IconSearch } from "@/components/ui/icons";
import { sectionFor, type SectionCta } from "./nav";

/** Query-string key the projects list filters on. */
export const SEARCH_PARAM = "q";

/**
 * Top bar: breadcrumb (the active section) · search · the section's primary
 * CTA. Search is real but narrow — it filters the projects list by title
 * (`/projects?q=`); wider search is a later wave, so nothing here pretends
 * to search what it can't.
 */
export function TopBar() {
  const pathname = usePathname();
  const section = sectionFor(pathname);
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-surface px-5">
      <nav aria-label="Breadcrumb" className="min-w-0 text-sm">
        <span className="font-semibold text-ink">{section?.label ?? "Studio"}</span>
      </nav>
      <div className="flex flex-1 justify-center">
        <SearchBox />
      </div>
      <div className="flex shrink-0 items-center">
        {section?.cta !== null && section?.cta !== undefined ? (
          <PrimaryCta cta={section.cta} />
        ) : null}
      </div>
    </header>
  );
}

function SearchBox() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get(SEARCH_PARAM) ?? "";
  const [value, setValue] = useState(current);
  // Reflect the URL when it changes underneath us (back/forward, rail nav).
  useEffect(() => {
    setValue(current);
  }, [current]);

  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    const q = value.trim();
    router.push(q === "" ? "/projects" : `/projects?${SEARCH_PARAM}=${encodeURIComponent(q)}`);
  };

  return (
    <form role="search" onSubmit={submit} className="relative w-full max-w-md">
      <IconSearch
        size={14}
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
      />
      <input
        type="search"
        aria-label="Search projects"
        placeholder={pathname.startsWith("/projects") ? "Filter projects…" : "Search projects…"}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
        }}
        className="h-9 w-full rounded-md border border-line bg-bg pr-3 pl-9 text-sm text-ink placeholder:text-muted focus:border-accent-500"
      />
    </form>
  );
}

function PrimaryCta({ cta }: { cta: SectionCta }) {
  const threads = useOptionalChatThreads();
  if (cta.action.kind === "new-chat") {
    // Only meaningful inside the Coach's thread provider; the rail carries
    // the same action, so outside one this renders nothing rather than a
    // dead button.
    if (threads === null) return null;
    return (
      <Button
        variant="primary"
        size="sm"
        onClick={() => {
          void threads.startThread();
        }}
        busy={threads.creating}
      >
        <IconPlus size={13} /> {cta.label}
      </Button>
    );
  }
  return (
    <Link
      href={cta.action.href}
      className="inline-flex h-7 items-center gap-1 rounded-md bg-accent-500 px-2.5 text-xs font-medium text-accent-fg transition-colors hover:bg-accent-400"
    >
      <IconPlus size={13} /> {cta.label}
    </Link>
  );
}
