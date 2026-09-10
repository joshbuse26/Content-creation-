import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import type { Session } from "next-auth";
import { ARCHETYPE_SEEDS } from "@/lib/archetypes";
import { FIXTURE_IDS } from "@/lib/fixtures";
import { archetypesContracts } from "@/lib/types/api";
import { asWorkspaceId } from "@/lib/types/ids";
import { fixtureRoleResolver } from "@/server/membership";
import { archetypesImpl } from "@/server/routers/impl/archetypes";
import { appRouter } from "@/server/routers";
import { createCallerFactory, type TrpcContext } from "@/server/trpc";

/**
 * Wave C (C0): archetypes.list — the seeded catalog is served keyless (no
 * DB), contract-valid, and workspace-gated like every other procedure.
 */

const createCaller = createCallerFactory(appRouter);

function ctxFor(userId: string | null): TrpcContext {
  const session: Session | null =
    userId === null
      ? null
      : { user: { id: userId }, expires: new Date(Date.now() + 3_600_000).toISOString() };
  return { session, resolveRole: fixtureRoleResolver, requestId: "test-request" };
}

describe("archetypes.list", () => {
  it("keyless impl serves all 12 seeds, contract-valid", async () => {
    const list = await archetypesImpl.list();
    expect(list).toHaveLength(12);
    expect(() => archetypesContracts.list.output.parse(list)).not.toThrow();
    expect(list.map((a) => a.id)).toEqual(ARCHETYPE_SEEDS.map((a) => a.id));
  });

  it("is readable by a workspace member through the router (no charge)", async () => {
    const caller = createCaller(ctxFor(FIXTURE_IDS.user));
    const list = await caller.archetypes.list({
      workspaceId: asWorkspaceId(FIXTURE_IDS.workspace),
    });
    expect(list).toHaveLength(12);
    expect(list[0]?.styleCard.hookPatterns.length).toBeGreaterThan(0);
  });

  it("denies cross-tenant and unauthenticated access", async () => {
    const member = createCaller(ctxFor(FIXTURE_IDS.user));
    await expect(
      member.archetypes.list({ workspaceId: asWorkspaceId(FIXTURE_IDS.otherWorkspace) }),
    ).rejects.toSatisfy((e: unknown) => e instanceof TRPCError && e.code === "FORBIDDEN");
    const anon = createCaller(ctxFor(null));
    await expect(
      anon.archetypes.list({ workspaceId: asWorkspaceId(FIXTURE_IDS.workspace) }),
    ).rejects.toSatisfy((e: unknown) => e instanceof TRPCError && e.code === "UNAUTHORIZED");
  });
});
