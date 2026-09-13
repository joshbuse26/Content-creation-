import { beforeEach, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import type { Session } from "next-auth";
import { FIXTURE_IDS } from "@/lib/fixtures";
import type { RoleResolver } from "@/lib/authz";
import { asWorkspaceId } from "@/lib/types/ids";
import { resetTemplateMemoryForTests } from "@/server/routers/impl/templates";
import { appRouter } from "@/server/routers";
import { createCallerFactory, type TrpcContext } from "@/server/trpc";

/**
 * E4 — reusable content packs (outline / hook_pack) through the real tRPC
 * middleware: admin+ manage (save/remove), any member lists, writer applies;
 * channel isolation (a pack tagged to channel A is never offered for channel
 * B); tenancy; zero credits. The existing description-template CRUD is left
 * untouched (covered by b4-templates.test.ts).
 */

const createCaller = createCallerFactory(appRouter);
const WS = asWorkspaceId(FIXTURE_IDS.workspace);
const CHANNEL_A = FIXTURE_IDS.channel; // the fixture project's channel
const CHANNEL_B = "00000000-0000-4000-8000-0000000000f1";

function ctxFor(role: "viewer" | "writer" | "admin" | "owner" | null): TrpcContext {
  const resolveRole: RoleResolver = (_u, w) =>
    Promise.resolve((w as string) === FIXTURE_IDS.workspace ? role : null);
  const session: Session | null = {
    user: { id: FIXTURE_IDS.user },
    expires: new Date(Date.now() + 3_600_000).toISOString(),
  };
  return { session, resolveRole, requestId: "test-request" };
}

const OUTLINE_PAYLOAD = {
  kind: "outline" as const,
  outline: {
    sections: [
      { kind: "hook" as const, heading: "A", purpose: "p", retentionNote: "r", targetSeconds: 20 },
      { kind: "intro" as const, heading: "B", purpose: "p", retentionNote: "r", targetSeconds: 40 },
      {
        kind: "chapter" as const,
        heading: "C",
        purpose: "p",
        retentionNote: "r",
        targetSeconds: 60,
      },
    ],
  },
};

beforeEach(() => {
  resetTemplateMemoryForTests();
});

describe("content packs — role gating", () => {
  it("a writer cannot save or remove a pack (admin+ only)", async () => {
    const writer = createCaller(ctxFor("writer"));
    const saveErr = await writer.templates
      .saveContentPack({
        workspaceId: WS,
        channelId: CHANNEL_A,
        name: "X",
        payload: OUTLINE_PAYLOAD,
      })
      .catch((e: unknown) => e);
    expect((saveErr as TRPCError).code).toBe("FORBIDDEN");

    const removeErr = await writer.templates
      .removeContentPack({ workspaceId: WS, contentTemplateId: FIXTURE_IDS.contentPackOutline })
      .catch((e: unknown) => e);
    expect((removeErr as TRPCError).code).toBe("FORBIDDEN");
  });

  it("any member lists; a writer applies", async () => {
    const viewer = createCaller(ctxFor("viewer"));
    const packs = await viewer.templates.listContentPacks({
      workspaceId: WS,
      channelId: CHANNEL_A,
      kind: null,
    });
    expect(packs.length).toBeGreaterThanOrEqual(2); // seeded outline + hook

    const writer = createCaller(ctxFor("writer"));
    const applied = await writer.templates.applyContentPack({
      workspaceId: WS,
      contentTemplateId: FIXTURE_IDS.contentPackOutline,
      projectId: FIXTURE_IDS.project,
    });
    expect(applied.payload.kind).toBe("outline");
    expect(applied.contentTemplate.id).toBe(FIXTURE_IDS.contentPackOutline);
  });

  it("an admin saves and removes a pack round-trip", async () => {
    const admin = createCaller(ctxFor("admin"));
    const saved = await admin.templates.saveContentPack({
      workspaceId: WS,
      channelId: CHANNEL_A,
      name: "Saved outline",
      payload: OUTLINE_PAYLOAD,
    });
    expect(saved.kind).toBe("outline");
    expect(saved.name).toBe("Saved outline");

    const removed = await admin.templates.removeContentPack({
      workspaceId: WS,
      contentTemplateId: saved.id,
    });
    expect(removed.removed).toBe(true);
  });
});

describe("content packs — channel isolation", () => {
  it("a pack tagged to channel A is not offered when listing channel B", async () => {
    const admin = createCaller(ctxFor("admin"));
    // The seeded packs are tagged to channel A. List for channel B.
    const forB = await admin.templates.listContentPacks({
      workspaceId: WS,
      channelId: CHANNEL_B,
      kind: null,
    });
    expect(forB.some((p) => p.channelId === CHANNEL_A)).toBe(false);

    // Add a channel-B pack and a workspace-wide pack; verify what each channel sees.
    await admin.templates.saveContentPack({
      workspaceId: WS,
      channelId: CHANNEL_B,
      name: "B-only outline",
      payload: OUTLINE_PAYLOAD,
    });
    await admin.templates.saveContentPack({
      workspaceId: WS,
      channelId: null,
      name: "Workspace-wide outline",
      payload: OUTLINE_PAYLOAD,
    });

    const listB = await admin.templates.listContentPacks({
      workspaceId: WS,
      channelId: CHANNEL_B,
      kind: null,
    });
    expect(listB.some((p) => p.name === "B-only outline")).toBe(true);
    expect(listB.some((p) => p.name === "Workspace-wide outline")).toBe(true); // null channel shown everywhere
    expect(listB.some((p) => p.channelId === CHANNEL_A)).toBe(false); // channel A never leaks

    const listA = await admin.templates.listContentPacks({
      workspaceId: WS,
      channelId: CHANNEL_A,
      kind: null,
    });
    expect(listA.some((p) => p.name === "B-only outline")).toBe(false);
  });

  it("kind filter narrows to outline or hook_pack", async () => {
    const admin = createCaller(ctxFor("admin"));
    const outlines = await admin.templates.listContentPacks({
      workspaceId: WS,
      channelId: CHANNEL_A,
      kind: "outline",
    });
    expect(outlines.every((p) => p.kind === "outline")).toBe(true);
    const hooks = await admin.templates.listContentPacks({
      workspaceId: WS,
      channelId: CHANNEL_A,
      kind: "hook_pack",
    });
    expect(hooks.every((p) => p.kind === "hook_pack")).toBe(true);
  });

  it("applying a channel-A pack to a channel-B project (different channel) is refused", async () => {
    const admin = createCaller(ctxFor("admin"));
    const bPack = await admin.templates.saveContentPack({
      workspaceId: WS,
      channelId: CHANNEL_B,
      name: "B pack",
      payload: OUTLINE_PAYLOAD,
    });
    // The fixture project lives on channel A; applying a channel-B pack fails.
    const err = await admin.templates
      .applyContentPack({
        workspaceId: WS,
        contentTemplateId: bPack.id,
        projectId: FIXTURE_IDS.project,
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("BAD_REQUEST");
  });
});

describe("content packs — tenancy", () => {
  it("a pack id outside the workspace is NOT_FOUND on remove", async () => {
    const admin = createCaller(ctxFor("admin"));
    const err = await admin.templates
      .removeContentPack({
        workspaceId: WS,
        contentTemplateId: "00000000-0000-4000-8000-00000000dead",
      })
      .catch((e: unknown) => e);
    expect((err as TRPCError).code).toBe("NOT_FOUND");
  });
});
