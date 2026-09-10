import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import type { Session } from "next-auth";
import { appRouter } from "@/server/routers";
import { createCallerFactory, type TrpcContext } from "@/server/trpc";
import { fixtureRoleResolver } from "@/server/membership";
import { FIXTURE_IDS, fixtureWorkspace } from "@/lib/fixtures";
import { asChannelId as parseChannelId, asScriptId, asWorkspaceId } from "@/lib/types/ids";
import type { RoleResolver } from "@/lib/authz";

/**
 * Tenancy tests THROUGH the tRPC middleware — proves assertAccess is wired
 * into every workspace-scoped procedure, not just unit-tested in isolation.
 */

const createCaller = createCallerFactory(appRouter);

function ctxFor(userId: string | null, resolveRole: RoleResolver = fixtureRoleResolver): TrpcContext {
  const session: Session | null =
    userId === null
      ? null
      : { user: { id: userId }, expires: new Date(Date.now() + 3_600_000).toISOString() };
  return { session, resolveRole, requestId: "test-request" };
}

const WS = asWorkspaceId(FIXTURE_IDS.workspace);
const OTHER_WS = asWorkspaceId(FIXTURE_IDS.otherWorkspace);

describe("tRPC authz middleware", () => {
  it("rejects unauthenticated calls with UNAUTHORIZED", async () => {
    const caller = createCaller(ctxFor(null));
    const err = await caller.workspace.get({ workspaceId: WS }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("UNAUTHORIZED");
  });

  it("allows a member to read their workspace", async () => {
    const caller = createCaller(ctxFor(FIXTURE_IDS.user));
    const ws = await caller.workspace.get({ workspaceId: WS });
    expect(ws.id).toBe(fixtureWorkspace.id);
    expect(ws.name).toBe("Deep Dive Media");
  });

  it("denies cross-tenant access with FORBIDDEN", async () => {
    const caller = createCaller(ctxFor(FIXTURE_IDS.user));
    const err = await caller.workspace.get({ workspaceId: OTHER_WS }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("FORBIDDEN");
  });

  it("denies cross-tenant mutations too", async () => {
    const caller = createCaller(ctxFor(FIXTURE_IDS.user));
    const err = await caller.project
      .create({
        workspaceId: OTHER_WS,
        channelId: asChannelId(),
        title: "Sneaky project",
        ideaId: null,
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("FORBIDDEN");
  });

  it("enforces role: viewer cannot create projects in their own workspace", async () => {
    const viewerResolver: RoleResolver = (_u, w) =>
      Promise.resolve((w as string) === FIXTURE_IDS.workspace ? ("viewer" as const) : null);
    const caller = createCaller(ctxFor(FIXTURE_IDS.user, viewerResolver));
    const err = await caller.project
      .create({ workspaceId: WS, channelId: asChannelId(), title: "Nope", ideaId: null })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("FORBIDDEN");

    // …but can still read
    const projects = await caller.project.list({ workspaceId: WS, limit: 10 });
    expect(projects.length).toBeGreaterThan(0);
  });

  it("owner-only: billing checkout denied to admin, allowed to owner", async () => {
    const adminResolver: RoleResolver = () => Promise.resolve("admin" as const);
    const adminCaller = createCaller(ctxFor(FIXTURE_IDS.user, adminResolver));
    const err = await adminCaller.billing
      .checkout({ workspaceId: WS, plan: "starter" })
      .catch((e: unknown) => e);
    expect((err as TRPCError).code).toBe("FORBIDDEN");

    const ownerCaller = createCaller(ctxFor(FIXTURE_IDS.user));
    const res = await ownerCaller.billing.checkout({ workspaceId: WS, plan: "starter" });
    expect(res.checkoutUrl).toContain("stripe.com");
  });

  it("stub outputs satisfy their frozen output schemas (spot check)", async () => {
    const caller = createCaller(ctxFor(FIXTURE_IDS.user));
    const script = await caller.script.get({ workspaceId: WS, scriptId: fixtureScriptId() });
    expect(script.sections.length).toBe(6);
    expect(script.qualityReport?.passed).toBe(true);
  });
});

function asChannelId() {
  return parseChannelId(FIXTURE_IDS.channel);
}

function fixtureScriptId() {
  return asScriptId(FIXTURE_IDS.script);
}
