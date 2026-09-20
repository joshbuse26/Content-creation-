// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { FIXTURE_IDS, fixtureChatThreadWorkspace } from "@/lib/fixtures";
import { asWorkspaceId } from "@/lib/types/ids";
import { resetConfigForTests } from "@/lib/config";
import { isCreditExempt, requireCredits } from "@/server/credits";
import { createAppQueryClient } from "@/components/providers/query-client";
import { trpc } from "@/components/providers/trpc";
import { ToastProvider } from "@/components/ui/toast";
import { COACH_PROMPT_PARAM, coachLaunchHref } from "@/components/chat/coach-launch";
import { AppShell } from "@/components/shell/app-shell";
import { APP_HOME, APP_NAV } from "@/components/shell/nav";
import { TOOLKIT_TOOLS } from "@/components/toolkit/tools";
import CoachPage from "@/app/(app)/coach/page";

/**
 * Playtest simplification (Josh, 2026-09-17):
 *  A) no paywalls — everyone is credit-exempt while PLAYTEST_AUTH_BYPASS is
 *     on (metering itself is untouched and stays tested with the flag off),
 *     and no CTA in the product carries "N credit(s)" copy;
 *  B) Ideas is a Tools card, not a rail section; /ideas lands on /toolkit;
 *  C) writing tools open the Coach with the job in the composer — ONE new
 *     conversation per launch, and the launch param is consumed.
 */

const WS = asWorkspaceId(FIXTURE_IDS.workspace);

// ---------------------------------------------------------------------------
// A) server: free while the playtest bypass is on
// ---------------------------------------------------------------------------

describe("A — credits are free while PLAYTEST_AUTH_BYPASS is on", () => {
  const original = process.env.PLAYTEST_AUTH_BYPASS;
  afterEach(() => {
    if (original === undefined) delete process.env.PLAYTEST_AUTH_BYPASS;
    else process.env.PLAYTEST_AUTH_BYPASS = original;
    resetConfigForTests();
  });

  it("a plain writer is exempt with the flag on, and still gated with it off", async () => {
    process.env.PLAYTEST_AUTH_BYPASS = "true";
    resetConfigForTests();
    expect(isCreditExempt("someone@example.com", "writer")).toBe(true);
    // requireCredits never even looks the workspace up when exempt.
    await expect(
      requireCredits(asWorkspaceId("00000000-0000-4000-8000-00000000dead"), 999, {
        userEmail: "someone@example.com",
        workspaceRole: "writer",
      }),
    ).resolves.toBeUndefined();

    process.env.PLAYTEST_AUTH_BYPASS = "false";
    resetConfigForTests();
    expect(isCreditExempt("someone@example.com", "writer")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A) UI: no "N credit(s)" copy on any in-app CTA
// ---------------------------------------------------------------------------

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") continue;
      out.push(...tsxFiles(full));
    } else if (entry.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Surfaces where a credit figure is still legitimate: the billing page (it
 * IS the ledger), the rail footer's balance link, and the metered script
 * pipeline's exempt-aware step notes.
 */
const CREDIT_COPY_ALLOWED = new Set([
  // Public marketing free-tools page (pricing pitch), not the app.
  "components/tools/tool-page.tsx",
  "components/settings/billing-panel.tsx",
  "components/shell/app-shell.tsx",
  "components/generation/staged-generate-panel.tsx",
  "components/generation/stream-view.tsx",
]);

describe("A — no charge copy on product CTAs", () => {
  it("no component renders '<n> credit(s)' or '· 1 credit' outside the allowed surfaces", () => {
    const root = process.cwd();
    const offenders: string[] = [];
    for (const file of tsxFiles(join(root, "components"))) {
      const rel = file.slice(root.length + 1);
      if (CREDIT_COPY_ALLOWED.has(rel)) continue;
      const src = readFileSync(file, "utf8");
      // Copy in JSX/strings — identifiers like creditsCharged or isUiCreditExempt don't match.
      if (
        /(\d+|\{[^}]*\}|·)\s*credits?\b/i.test(src) ||
        /\bcredits? (charged|needed)\b/i.test(src)
      ) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// B/C) IA + tool launches
// ---------------------------------------------------------------------------

describe("B — Ideas is a Tools card, not a section", () => {
  it("the rail has no Ideas section; the Tools grid has an Ideas card with its own screen", () => {
    expect(APP_NAV.map((s) => s.label)).toEqual([
      "Coach",
      "Intel",
      "Projects",
      "Channels",
      "Tools",
      "Settings",
    ]);
    const ideas = TOOLKIT_TOOLS.find((t) => t.slug === "ideas");
    expect(ideas?.href).toBe("/toolkit/ideas");
  });

  it("writing tools open the Coach with a starter; Ideas, Thumbnail Studio and Intel are their own screens", () => {
    const own = TOOLKIT_TOOLS.filter((t) => !t.href.startsWith(`${APP_HOME}?`));
    expect(own.map((t) => t.slug).sort()).toEqual(["ideas", "intel", "thumbnails"]);
    expect(own.find((t) => t.slug === "thumbnails")?.href).toBe("/toolkit/thumbnails");
    expect(own.find((t) => t.slug === "intel")?.href).toBe("/discover");
  });

  it("coachLaunchHref round-trips the prompt through the query string", () => {
    const href = coachLaunchHref("Give me 5 hooks for: ");
    const url = new URL(href, "http://localhost");
    expect(url.pathname).toBe(APP_HOME);
    expect(url.searchParams.get(COACH_PROMPT_PARAM)).toBe("Give me 5 hooks for: ");
  });
});

// ---------------------------------------------------------------------------
// C) the Coach honours a launch: one new thread, composer seeded, URL cleaned
// ---------------------------------------------------------------------------

const LAUNCH = "Give me 5 hooks for a video about: ";
const replace = vi.fn();
let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  usePathname: () => "/coach",
  useRouter: () => ({ push: vi.fn(), replace }),
  useSearchParams: () => searchParams,
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
    plan: "free",
    creditBalance: 0,
    role: "writer",
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

const counts = new Map<string, number>();
const count = (proc: string): number => counts.get(proc) ?? 0;
let threads: (typeof fixtureChatThreadWorkspace)[] = [];

function fakeFetch(input: RequestInfo | URL): Promise<Response> {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(href, "http://localhost");
  const procs = url.pathname.replace(/^\/api\/trpc\//, "").split(",");
  const results = procs.map((proc) => {
    counts.set(proc, count(proc) + 1);
    if (proc === "chat.listThreads") return { result: { data: superjson.serialize(threads) } };
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
    throw new Error(`unexpected procedure: ${proc}`);
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

describe("C — a tool launch opens ONE new Coach conversation with the composer seeded", () => {
  beforeEach(() => {
    counts.clear();
    replace.mockClear();
    // An existing thread proves the launch does NOT reuse it.
    threads = [fixtureChatThreadWorkspace];
    searchParams = new URLSearchParams({ [COACH_PROMPT_PARAM]: LAUNCH });
    Element.prototype.scrollTo = vi.fn();
  });
  afterEach(() => {
    cleanup();
  });

  it("creates exactly one thread, seeds the composer, and strips the prompt from the URL", async () => {
    render(
      <Harness>
        <AppShell>
          <CoachPage />
        </AppShell>
      </Harness>,
    );
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLTextAreaElement>(/Message/).value).toBe(LAUNCH);
    });
    expect(count("chat.createThread")).toBe(1);
    expect(replace).toHaveBeenCalledWith("/coach");
    // Never a "N credit" line on the confirm/tool surfaces of this page.
    const main = screen.getByRole("main");
    expect(within(main).queryByText(/\d+ credits?/)).toBeNull();
  });
});
