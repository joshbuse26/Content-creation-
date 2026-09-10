import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { FIXTURE_IDS, fixtureApiKey } from "@/lib/fixtures";
import { apiKeyIdSchema, asChannelId } from "@/lib/types/ids";
import { apiKeysImpl } from "@/server/routers/impl/apiKeys";
import { apiKeyDisplayPrefix } from "@/server/mcp/key-format";
import {
  FIXTURE_MCP_API_KEY_SECRET,
  hashApiKeySecret,
  InMemoryApiKeyStore,
  setApiKeyStoreForTests,
} from "@/server/mcp/keys";
import { MCP_TOOL_NAMES } from "@/server/mcp/tool-names";
import { fixtureCtx } from "./a2-helpers";

/**
 * B2 — API key lifecycle: show-once secrets, SHA-256 storage, scope
 * validation, revocation. Runs against the in-memory store (zero env), the
 * same code path fixture mode uses.
 */

let store: InMemoryApiKeyStore;

beforeEach(() => {
  store = new InMemoryApiKeyStore();
  setApiKeyStoreForTests(store);
});

afterEach(() => {
  setApiKeyStoreForTests(undefined);
});

const createInput = {
  workspaceId: fixtureCtx.workspaceId,
  scopes: [...MCP_TOOL_NAMES] as string[],
  channelIds: [asChannelId(FIXTURE_IDS.channel)],
};

describe("apiKeys.create — show-once secret + hashed storage", () => {
  it("mints a ≥32-byte-entropy secret whose display prefix is derivable from the row", async () => {
    const { apiKey, secret } = await apiKeysImpl.create({ ctx: fixtureCtx, input: createInput });
    expect(secret).toMatch(/^gr_live_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/);
    // The UI prefix (from the stored row alone) is a TRUE prefix of the secret.
    expect(secret.startsWith(apiKeyDisplayPrefix(apiKey.id))).toBe(true);
    expect(apiKey.workspaceId).toBe(fixtureCtx.workspaceId);
    expect(apiKey.revokedAt).toBeNull();
    expect(apiKey.lastUsedAt).toBeNull();
  });

  it("stores only the SHA-256 hash — the secret appears nowhere in list output", async () => {
    const { apiKey, secret } = await apiKeysImpl.create({ ctx: fixtureCtx, input: createInput });
    const stored = await store.findByHash(hashApiKeySecret(secret));
    expect(stored).not.toBeNull();
    expect(stored?.id).toBe(apiKey.id);
    expect(stored?.hashedKey).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.hashedKey).not.toContain(secret);

    const listed = await apiKeysImpl.list({
      ctx: fixtureCtx,
      input: { workspaceId: fixtureCtx.workspaceId },
    });
    const row = listed.find((k) => k.id === apiKey.id);
    expect(row).toBeDefined();
    // Entity shape only — no secret, no hash.
    expect(JSON.stringify(listed)).not.toContain(secret);
    expect(JSON.stringify(listed)).not.toContain(hashApiKeySecret(secret));
    expect(Object.keys(row ?? {})).not.toContain("hashedKey");
  });

  it("two keys never share a secret", async () => {
    const a = await apiKeysImpl.create({ ctx: fixtureCtx, input: createInput });
    const b = await apiKeysImpl.create({ ctx: fixtureCtx, input: createInput });
    expect(a.secret).not.toBe(b.secret);
    expect(a.apiKey.id).not.toBe(b.apiKey.id);
  });

  it("rejects scopes that are not MCP tool names", async () => {
    await expect(
      apiKeysImpl.create({
        ctx: fixtureCtx,
        input: { ...createInput, scopes: ["get_script", "drop_all_tables"] },
      }),
    ).rejects.toSatisfy((err: unknown) => err instanceof TRPCError && err.code === "BAD_REQUEST");
  });

  it("rejects channel ids that are not in the workspace", async () => {
    await expect(
      apiKeysImpl.create({
        ctx: fixtureCtx,
        input: {
          ...createInput,
          channelIds: [asChannelId("11111111-2222-4333-8444-555555555555")],
        },
      }),
    ).rejects.toSatisfy((err: unknown) => err instanceof TRPCError && err.code === "BAD_REQUEST");
  });
});

describe("apiKeys.revoke", () => {
  it("sets revokedAt and is idempotent", async () => {
    const { apiKey } = await apiKeysImpl.create({ ctx: fixtureCtx, input: createInput });
    const revoked = await apiKeysImpl.revoke({
      ctx: fixtureCtx,
      input: { workspaceId: fixtureCtx.workspaceId, apiKeyId: apiKey.id },
    });
    expect(revoked.revokedAt).toBeInstanceOf(Date);
    const again = await apiKeysImpl.revoke({
      ctx: fixtureCtx,
      input: { workspaceId: fixtureCtx.workspaceId, apiKeyId: apiKey.id },
    });
    expect(again.revokedAt).toEqual(revoked.revokedAt);
  });

  it("NOT_FOUND for a key that is not in the workspace", async () => {
    await expect(
      apiKeysImpl.revoke({
        ctx: fixtureCtx,
        input: {
          workspaceId: fixtureCtx.workspaceId,
          apiKeyId: apiKeyIdSchema.parse("99999999-8888-4777-8666-555555555555"),
        },
      }),
    ).rejects.toSatisfy((err: unknown) => err instanceof TRPCError && err.code === "NOT_FOUND");
  });
});

describe("fixture seed", () => {
  it("the in-memory store answers to the documented fixture secret", async () => {
    const stored = await store.findByHash(hashApiKeySecret(FIXTURE_MCP_API_KEY_SECRET));
    expect(stored?.id).toBe(fixtureApiKey.id);
    expect(stored?.scopes).toEqual(fixtureApiKey.scopes);
  });
});
