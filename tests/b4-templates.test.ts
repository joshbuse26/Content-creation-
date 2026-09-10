import { beforeEach, describe, expect, it } from "vitest";
import { extractSlots, fillSlots } from "@/components/packaging/template-slots";
import { TRPCError } from "@trpc/server";
import type { Session } from "next-auth";
import { FIXTURE_IDS } from "@/lib/fixtures";
import type { RoleResolver } from "@/lib/authz";
import { asWorkspaceId } from "@/lib/types/ids";
import { fixtureRoleResolver } from "@/server/membership";
import { resetTemplateMemoryForTests } from "@/server/routers/impl/templates";
import { appRouter } from "@/server/routers";
import { createCallerFactory, type TrpcContext } from "@/server/trpc";

/**
 * Description templates — CRUD through the real tRPC middleware (authz:
 * admin+ manages, writers use, viewers read) and the fixture-mode flow of
 * template → description generation with {{slot}} filling.
 */

const createCaller = createCallerFactory(appRouter);
const WS = asWorkspaceId(FIXTURE_IDS.workspace);

function ctxFor(role: "viewer" | "writer" | "admin" | "owner" | null): TrpcContext {
  const resolveRole: RoleResolver = (_u, w) =>
    Promise.resolve((w as string) === FIXTURE_IDS.workspace ? role : null);
  const session: Session | null = {
    user: { id: FIXTURE_IDS.user },
    expires: new Date(Date.now() + 3_600_000).toISOString(),
  };
  return { session, resolveRole, requestId: "test-request" };
}

beforeEach(() => {
  resetTemplateMemoryForTests();
});

describe("templates CRUD (fixture mode, real middleware)", () => {
  it("every member can list; the fixture template is seeded", async () => {
    const caller = createCaller(ctxFor("viewer"));
    const templates = await caller.templates.list({ workspaceId: WS });
    expect(templates.length).toBeGreaterThanOrEqual(1);
    expect(templates.some((t) => t.id === FIXTURE_IDS.descriptionTemplate)).toBe(true);
  });

  it("writer cannot create/update/delete templates (admin+ only)", async () => {
    const caller = createCaller(ctxFor("writer"));
    for (const attempt of [
      caller.templates.create({ workspaceId: WS, name: "X", body: "{{summary}}" }),
      caller.templates.update({
        workspaceId: WS,
        templateId: FIXTURE_IDS.descriptionTemplate,
        name: "Renamed",
      }),
      caller.templates.remove({
        workspaceId: WS,
        templateId: FIXTURE_IDS.descriptionTemplate,
      }),
    ]) {
      const err = await attempt.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe("FORBIDDEN");
    }
  });

  it("admin can create, update, and remove a template", async () => {
    const caller = createCaller(ctxFor("admin"));
    const created = await caller.templates.create({
      workspaceId: WS,
      name: "Launch video",
      body: "{{summary}}\n\nLinks:\n{{links}}",
    });
    expect(created.name).toBe("Launch video");

    const updated = await caller.templates.update({
      workspaceId: WS,
      templateId: created.id,
      body: "{{summary}}\n\n{{keywords}}",
    });
    expect(updated.id).toBe(created.id);
    expect(updated.body).toContain("{{keywords}}");
    expect(updated.name).toBe("Launch video"); // untouched field survives

    const removed = await caller.templates.remove({ workspaceId: WS, templateId: created.id });
    expect(removed.removed).toBe(true);
    const remaining = await caller.templates.list({ workspaceId: WS });
    expect(remaining.some((t) => t.id === created.id)).toBe(false);
  });

  it("update/remove of a template outside the workspace is NOT_FOUND", async () => {
    const caller = createCaller(ctxFor("admin"));
    const err = await caller.templates
      .update({
        workspaceId: WS,
        templateId: "00000000-0000-4000-8000-00000000dead",
        name: "Nope",
      })
      .catch((e: unknown) => e);
    expect((err as TRPCError).code).toBe("NOT_FOUND");
  });

  it("cross-tenant access is FORBIDDEN through the middleware", async () => {
    const caller = createCaller({
      session: {
        user: { id: FIXTURE_IDS.user },
        expires: new Date(Date.now() + 3_600_000).toISOString(),
      },
      resolveRole: fixtureRoleResolver,
      requestId: "test-request",
    });
    const err = await caller.templates
      .list({ workspaceId: asWorkspaceId(FIXTURE_IDS.otherWorkspace) })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("FORBIDDEN");
  });
});

describe("template → description generation ({{slot}} filling, zero env)", () => {
  it("a writer generates a description through an admin-created template", async () => {
    const admin = createCaller(ctxFor("admin"));
    const template = await admin.templates.create({
      workspaceId: WS,
      name: "Slot test",
      body: "INTRO>>{{summary}}<<\nTitle: {{title}}\nChapters:\n{{chapters}}\n{{sponsor_note}}",
    });

    const writer = createCaller(ctxFor("writer"));
    const description = await writer.description.generate({
      workspaceId: WS,
      projectId: FIXTURE_IDS.project,
      mode: "informative",
      templateId: template.id,
    });

    expect(description.body).toContain("INTRO>>"); // template shell applied
    expect(description.body).not.toContain("{{summary}}"); // known slot filled
    expect(description.body).toContain("Title: "); // {{title}} filled
    expect(description.body).toContain("0:00"); // {{chapters}} derived
    expect(description.body).toContain("{{sponsor_note}}"); // unknown slot kept for the user
  });

  it("without a template the description is the plain generated body", async () => {
    const writer = createCaller(ctxFor("writer"));
    const description = await writer.description.generate({
      workspaceId: WS,
      projectId: FIXTURE_IDS.project,
      mode: "seo",
      templateId: null,
    });
    expect(description.body.length).toBeGreaterThan(50);
    expect(description.body).not.toContain("{{");
  });
});

describe("panel slot helpers (fill remaining {{slots}} client-side)", () => {
  it("extracts unique slot names in order of first appearance", () => {
    expect(extractSlots("{{a}} x {{ b }} y {{a}} {{c}}")).toEqual(["a", "b", "c"]);
    expect(extractSlots("no slots here")).toEqual([]);
  });

  it("fills only slots with non-empty values, preserving the rest", () => {
    const filled = fillSlots("Hi {{name}}, see {{link}} ({{name}})", {
      name: "Casey",
      link: "   ",
    });
    expect(filled).toBe("Hi Casey, see {{link}} (Casey)");
  });
});
