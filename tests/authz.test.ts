import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { assertAccess, can, type RoleResolver } from "@/lib/authz";
import { asUserId, asWorkspaceId } from "@/lib/types/ids";
import type { Role } from "@/lib/types/enums";

const USER = asUserId("11111111-1111-4111-8111-111111111111");
const WS = asWorkspaceId("22222222-2222-4222-8222-222222222222");
const OTHER_WS = asWorkspaceId("33333333-3333-4333-8333-333333333333");

const resolverFor =
  (role: Role): RoleResolver =>
  (_userId, workspaceId) =>
    Promise.resolve(workspaceId === WS ? role : null);

describe("role matrix (can)", () => {
  it("viewer: read-only on content, no writes anywhere", () => {
    expect(can("viewer", "project", "read")).toBe(true);
    expect(can("viewer", "script", "read")).toBe(true);
    expect(can("viewer", "project", "create")).toBe(false);
    expect(can("viewer", "script", "update")).toBe(false);
    expect(can("viewer", "channel", "update")).toBe(false);
  });

  it("writer: content create/edit, but no channels/members/templates", () => {
    expect(can("writer", "project", "create")).toBe(true);
    expect(can("writer", "script", "update")).toBe(true);
    expect(can("writer", "research", "delete")).toBe(true);
    expect(can("writer", "channel", "create")).toBe(false);
    expect(can("writer", "member", "create")).toBe(false);
    expect(can("writer", "template", "update")).toBe(false);
    expect(can("writer", "billing", "update")).toBe(false);
  });

  it("admin: adds channels/members/templates/workspace, not billing/apiKeys", () => {
    expect(can("admin", "channel", "create")).toBe(true);
    expect(can("admin", "member", "update")).toBe(true);
    expect(can("admin", "template", "delete")).toBe(true);
    expect(can("admin", "workspace", "update")).toBe(true);
    expect(can("admin", "billing", "update")).toBe(false);
    expect(can("admin", "apiKey", "create")).toBe(false);
    expect(can("admin", "apiKey", "read")).toBe(false);
  });

  it("owner: everything, including billing and API keys", () => {
    expect(can("owner", "billing", "update")).toBe(true);
    expect(can("owner", "apiKey", "create")).toBe(true);
    expect(can("owner", "apiKey", "read")).toBe(true);
    expect(can("owner", "channel", "delete")).toBe(true);
  });

  it("billing reads are admin+", () => {
    expect(can("viewer", "billing", "read")).toBe(false);
    expect(can("writer", "billing", "read")).toBe(false);
    expect(can("admin", "billing", "read")).toBe(true);
    expect(can("owner", "billing", "read")).toBe(true);
  });
});

describe("assertAccess", () => {
  it("returns the role when permitted", async () => {
    await expect(assertAccess(USER, WS, "project", "create", resolverFor("writer"))).resolves.toBe(
      "writer",
    );
  });

  it("throws FORBIDDEN for non-members (cross-tenant denial)", async () => {
    const err = await assertAccess(USER, OTHER_WS, "project", "read", resolverFor("owner")).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("FORBIDDEN");
  });

  it("throws FORBIDDEN when the role lacks the action", async () => {
    const err = await assertAccess(USER, WS, "channel", "create", resolverFor("writer")).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("FORBIDDEN");
  });

  it("non-member and no-permission errors are indistinguishable", async () => {
    const nonMember = await assertAccess(USER, OTHER_WS, "project", "read", resolverFor("owner")).catch(
      (e: unknown) => e,
    );
    const noPermission = await assertAccess(USER, WS, "billing", "update", resolverFor("viewer")).catch(
      (e: unknown) => e,
    );
    expect((nonMember as TRPCError).message).toBe((noPermission as TRPCError).message);
    expect((nonMember as TRPCError).code).toBe((noPermission as TRPCError).code);
  });
});
