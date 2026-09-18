// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { FIXTURE_IDS, fixtureChatThreadWorkspace } from "@/lib/fixtures";
import { asWorkspaceId } from "@/lib/types/ids";
import { createAppQueryClient } from "@/components/providers/query-client";
import { trpc } from "@/components/providers/trpc";
import { ToastProvider } from "@/components/ui/toast";
import { COACH_STARTERS } from "@/components/chat/chat-panel";
import { AppShell } from "@/components/shell/app-shell";
import { APP_HOME, APP_NAV, sectionFor } from "@/components/shell/nav";
import { TOOLKIT_TOOLS } from "@/components/toolkit/tools";
import CoachPage from "@/app/(app)/coach/page";

/**
 * F1 — command-center shell.
 *
 *  - the IA is one list (APP_NAV) with the agreed labels/routes, and Tools
 *    does NOT collide with the public /tools marketing route;
 *  - every Tools card opens a route that actually exists under app/;
 *  - the shell renders the rail, the wordmark → Coach, the Coach chats
 *    section with "+ New chat" and the thread list;
 *  - F0 request discipline survives the rail: rendering the shell AND the
 *    Coach page (two consumers of the thread list) costs ONE listThreads
 *    request, and a non-chat route costs ZERO.
 */

const WS = asWorkspaceId(FIXTURE_IDS.workspace);

let pathname = "/coach";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/providers/workspace-context", () => {
  const workspace = {
    id: FIXTURE_IDS.workspace,
    name: "Demo Studio",
    plan: "starter",
    creditBalance: 42,
    role: "member",
  };
  return {
    useWorkspace: () => ({
      workspaces: [workspace],
      workspacesLoading: false,
      hasNoWorkspaces: false,
      workspaceId: WS,
      workspace,
      selectWorkspace: vi.fn(),
      channels: [],
      channelsLoading: false,
      channelsError: false,
      refetchChannels: vi.fn(),
      channelId: null,
      channel: null,
      selectChannel: vi.fn(),
    }),
  };
});

// ---------------------------------------------------------------------------
// Counting fake transport (same shape as the F0 suite)
// ---------------------------------------------------------------------------

const counts = new Map<string, number>();
const count = (proc: string): number => counts.get(proc) ?? 0;
/** The fake server's thread table — createThread prepends to it. */
let threads: (typeof fixtureChatThreadWorkspace)[] = [];

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(href, "http://localhost");
  const procs = url.pathname.replace(/^\/api\/trpc\//, "").split(",");
  const results = procs.map((proc) => {
    counts.set(proc, count(proc) + 1);
    if (proc === "chat.listThreads") {
      return { result: { data: superjson.serialize(threads) } };
    }
    if (proc === "chat.createThread") {
      threads = [fixtureChatThreadWorkspace, ...threads];
      return { result: { data: superjson.serialize(fixtureChatThreadWorkspace) } };
    }
    if (proc === "chat.getThread") {
      return {
        result: {
          data: superjson.serialize({
            thread: fixtureChatThreadWorkspace,
            messages: [],
            nextCursor: null,
          }),
        },
      };
    }
    throw new Error(`unexpected procedure in F1 shell test: ${proc} (${init?.method ?? "GET"})`);
  });
  return Promise.resolve(
    new Response(JSON.stringify(results), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

function Harness({ children }: { children: ReactNode }) {
  const queryClient = createAppQueryClient();
  const trpcClient = trpc.createClient({
    links: [httpBatchLink({ url: "/api/trpc", transformer: superjson, fetch: fakeFetch })],
  });
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
}

beforeEach(() => {
  counts.clear();
  threads = [fixtureChatThreadWorkspace];
  pathname = "/coach";
  Element.prototype.scrollTo = vi.fn();
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Routes that exist under app/ — derived from the filesystem, not a list
// ---------------------------------------------------------------------------

function appRoutes(dir: string, prefix = ""): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Route groups "(name)" add no URL segment.
      const segment = /^\(.*\)$/.test(entry) ? "" : `/${entry}`;
      routes.push(...appRoutes(full, `${prefix}${segment}`));
    } else if (entry === "page.tsx") {
      routes.push(prefix === "" ? "/" : prefix);
    }
  }
  return routes;
}

const ROUTES = appRoutes(join(process.cwd(), "app"));

/** True when a concrete href is served by a page (dynamic segments match anything). */
function routeExists(href: string): boolean {
  const path = href.split(/[?#]/)[0] ?? href;
  return ROUTES.some((route) => {
    const pattern = route.replace(/\[[^\]]+\]/g, "[^/]+");
    return new RegExp(`^${pattern}$`).test(path);
  });
}

// ---------------------------------------------------------------------------

describe("F1 — information architecture", () => {
  it("has the agreed sections in order, and the app home is the Coach", () => {
    expect(APP_NAV.map((s) => s.label)).toEqual([
      "Coach",
      "Intel",
      "Projects",
      "Channels",
      "Tools",
      "Settings",
    ]);
    expect(APP_HOME).toBe("/coach");
    expect(APP_NAV[0]?.href).toBe(APP_HOME);
  });

  it("every section route exists, and Tools does not collide with the public /tools route", () => {
    for (const section of APP_NAV) expect(routeExists(section.href), section.href).toBe(true);
    expect(APP_NAV.some((s) => s.href === "/tools")).toBe(false);
    // The public free-tools page still exists — it was not moved.
    expect(routeExists("/tools")).toBe(true);
  });

  it("resolves a pathname to its owning section by prefix", () => {
    expect(sectionFor("/coach")?.label).toBe("Coach");
    expect(sectionFor("/projects/abc/chat")?.label).toBe("Projects");
    expect(sectionFor("/toolkit")?.label).toBe("Tools");
    expect(sectionFor("/discover")?.label).toBe("Intel");
    expect(sectionFor("/onboarding")).toBeNull();
    // Prefix means path-segment prefix: "/coaching" is not the Coach.
    expect(sectionFor("/coaching")).toBeNull();
  });

  it("every Tools card opens a route that exists and never a chat questionnaire", () => {
    expect(TOOLKIT_TOOLS.length).toBeGreaterThanOrEqual(8);
    for (const tool of TOOLKIT_TOOLS) expect(routeExists(tool.href), tool.href).toBe(true);
    const slugs = TOOLKIT_TOOLS.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe("F1 — shell rendering", () => {
  it("renders the rail (wordmark → Coach, all sections, Coach chats) and the Coach page with ONE listThreads request", async () => {
    render(
      <Harness>
        <AppShell>
          <CoachPage />
        </AppShell>
      </Harness>,
    );

    const rail = screen.getByRole("complementary");
    expect(within(rail).getByRole("link", { name: "Home" }).getAttribute("href")).toBe(APP_HOME);
    const sections = within(rail).getByRole("navigation", { name: "Sections" });
    for (const s of APP_NAV) {
      const link = within(sections).getByRole("link", { name: s.label });
      expect(link.getAttribute("href")).toBe(s.href);
    }
    expect(within(sections).getByRole("link", { name: "Coach" }).getAttribute("aria-current")).toBe(
      "page",
    );

    // Coach chats live in the rail: "+ New chat" plus the thread list.
    const chats = within(rail).getByRole("region", { name: "Chats" });
    expect(within(chats).getByRole("button", { name: /New chat/ })).toBeTruthy();
    await waitFor(() => {
      expect(
        within(chats).getByRole("button", { name: fixtureChatThreadWorkspace.title }),
      ).toBeTruthy();
    });
    // The page itself opened that thread (shared selection): its header shows the title.
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: fixtureChatThreadWorkspace.title })).toBeTruthy();
    });

    // Two consumers (rail + page), ONE list request — the F0 budget holds.
    expect(count("chat.listThreads")).toBe(1);
    expect(count("chat.getThread")).toBe(1);

    // Workspace footer: name · plan chip · credits.
    const footer = within(rail).getByRole("contentinfo");
    expect(footer.textContent).toContain("Demo Studio");
    expect(footer.textContent).toContain("starter");
    expect(footer.textContent).toContain("42 credits");
  });

  it("with no conversations the Coach shows the starter chips; a chip opens ONE thread with the composer seeded", async () => {
    threads = [];
    render(
      <Harness>
        <AppShell>
          <CoachPage />
        </AppShell>
      </Harness>,
    );
    const starters = await screen.findByLabelText("Starter prompts");
    for (const text of COACH_STARTERS) {
      expect(within(starters).getByRole("button", { name: text })).toBeTruthy();
    }
    const first = COACH_STARTERS[0];
    fireEvent.click(within(starters).getByRole("button", { name: first }));
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLTextAreaElement>(/Message/).value).toBe(first);
    });
    // Exactly one thread created, and the list refreshed exactly once for it.
    expect(count("chat.createThread")).toBe(1);
    expect(count("chat.listThreads")).toBe(2);
    // The rail now lists it (shared selection → highlighted).
    const chats = within(screen.getByRole("complementary")).getByRole("region", { name: "Chats" });
    expect(
      within(chats)
        .getByRole("button", { name: fixtureChatThreadWorkspace.title })
        .getAttribute("aria-current"),
    ).toBe("true");
  });

  it("on a non-chat route the rail shows no chats and makes NO thread requests", async () => {
    pathname = "/projects";
    render(
      <Harness>
        <AppShell>
          <p>projects body</p>
        </AppShell>
      </Harness>,
    );
    expect(screen.getByText("projects body")).toBeTruthy();
    const rail = screen.getByRole("complementary");
    expect(within(rail).queryByRole("region", { name: "Chats" })).toBeNull();
    expect(within(rail).getByRole("link", { name: "Projects" }).getAttribute("aria-current")).toBe(
      "page",
    );
    // The section CTA is the top bar's "New project".
    expect(screen.getByRole("link", { name: /New project/ }).getAttribute("href")).toBe(
      "/projects?new=1",
    );
    // Give any stray query a tick to fire — there must be none.
    await new Promise((r) => setTimeout(r, 20));
    expect(count("chat.listThreads")).toBe(0);
  });
});
