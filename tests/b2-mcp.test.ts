import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/mcp/route";
import { FIXTURE_IDS, fixtureFrame, fixtureProject } from "@/lib/fixtures";
import { apiKeyIdSchema, asChannelId, type ApiKeyId } from "@/lib/types/ids";
import { setEngineDepsForTests } from "@/pipelines/script/deps";
import {
  FIXTURE_MCP_API_KEY_SECRET,
  getApiKeyStore,
  hashApiKeySecret,
  InMemoryApiKeyStore,
  mintApiKeySecret,
  setApiKeyStoreForTests,
} from "@/server/mcp/keys";
import { MCP_TOOL_NAMES } from "@/server/mcp/tool-names";
import { MemorySlidingWindowStore, RateLimiter, setRateLimiterForTests } from "@/server/ratelimit";
import { apiKeysImpl } from "@/server/routers/impl/apiKeys";
import {
  getSharedWorkspaceStore,
  resetSharedWorkspaceStoreForTests,
} from "@/server/workspace/memory";
import { fixtureCtx, makeDeps } from "./a2-helpers";

/**
 * B2 — /api/mcp end to end (fixture mode, zero env): bearer auth, JSON-RPC
 * protocol (initialize / tools/list / tools/call), key scope + channel
 * scope enforcement, credit charging through the shared pipelines, and the
 * per-key rate limit.
 */

let deps: ReturnType<typeof makeDeps>;

beforeEach(() => {
  setApiKeyStoreForTests(new InMemoryApiKeyStore());
  resetSharedWorkspaceStoreForTests();
  deps = makeDeps();
  setEngineDepsForTests(deps);
});

afterEach(() => {
  setApiKeyStoreForTests(undefined);
  resetSharedWorkspaceStoreForTests();
  setEngineDepsForTests(undefined);
  setRateLimiterForTests(undefined);
});

interface RpcBody {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

async function post(body: unknown, secret: string | null): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== null) headers.authorization = `Bearer ${secret}`;
  return POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

let rpcId = 0;
function rpc(method: string, params?: unknown): RpcBody {
  rpcId += 1;
  return { jsonrpc: "2.0", id: rpcId, method, ...(params === undefined ? {} : { params }) };
}

interface JsonRpcReply {
  jsonrpc: string;
  id: unknown;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
}

async function replyOf(res: Response): Promise<JsonRpcReply> {
  expect(res.status).toBe(200);
  return (await res.json()) as JsonRpcReply;
}

interface ToolCallResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

async function callTool(
  secret: string,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  const reply = await replyOf(await post(rpc("tools/call", { name, arguments: args }), secret));
  expect(reply.error).toBeUndefined();
  return reply.result as unknown as ToolCallResult;
}

async function mintKey(overrides?: {
  scopes?: string[];
  channelIds?: string[];
}): Promise<{ secret: string; apiKey: { id: ApiKeyId } }> {
  const { apiKey, secret } = await apiKeysImpl.create({
    ctx: fixtureCtx,
    input: {
      workspaceId: fixtureCtx.workspaceId,
      scopes: overrides?.scopes ?? [...MCP_TOOL_NAMES],
      channelIds: (overrides?.channelIds ?? [FIXTURE_IDS.channel]).map(asChannelId),
    },
  });
  return { secret, apiKey };
}

/**
 * A key whose channel scope points at a channel that is NOT the fixture
 * channel (e.g. it was later disconnected) — planted directly in the store
 * because apiKeys.create validates channel membership at creation time.
 */
async function plantForeignScopedKey(foreignChannelId: string): Promise<string> {
  const id = apiKeyIdSchema.parse(randomUUID());
  const secret = mintApiKeySecret(id);
  await getApiKeyStore().insert({
    id,
    workspaceId: fixtureCtx.workspaceId,
    hashedKey: hashApiKeySecret(secret),
    scopes: [...MCP_TOOL_NAMES],
    channelIds: [asChannelId(foreignChannelId)],
  });
  return secret;
}

describe("auth", () => {
  it("401 without a bearer token", async () => {
    const res = await post(rpc("initialize"), null);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("Bearer");
  });

  it("401 for an unknown key", async () => {
    const res = await post(rpc("initialize"), "gr_live_00000000_not_a_real_key");
    expect(res.status).toBe(401);
  });

  it("401 for a revoked key", async () => {
    const { secret, apiKey } = await mintKey();
    // Key works before revocation…
    expect((await post(rpc("initialize"), secret)).status).toBe(200);
    await apiKeysImpl.revoke({
      ctx: fixtureCtx,
      input: { workspaceId: fixtureCtx.workspaceId, apiKeyId: apiKey.id },
    });
    // …and is rejected immediately after.
    const res = await post(rpc("initialize"), secret);
    expect(res.status).toBe(401);
  });

  it("the documented fixture secret authenticates in fixture mode", async () => {
    const reply = await replyOf(await post(rpc("initialize"), FIXTURE_MCP_API_KEY_SECRET));
    expect(reply.error).toBeUndefined();
  });
});

describe("protocol", () => {
  it("initialize declares serverInfo and tools capability", async () => {
    const { secret } = await mintKey();
    const reply = await replyOf(await post(rpc("initialize"), secret));
    const result = reply.result ?? {};
    expect(result.protocolVersion).toBe("2025-06-18");
    expect((result.serverInfo as { name: string }).name).toContain("MCP");
    expect((result.capabilities as { tools: unknown }).tools).toBeDefined();
  });

  it("notifications get 202 with no body", async () => {
    const { secret } = await mintKey();
    const res = await post({ jsonrpc: "2.0", method: "notifications/initialized" }, secret);
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });

  it("unknown method → -32601", async () => {
    const { secret } = await mintKey();
    const reply = await replyOf(await post(rpc("resources/list"), secret));
    expect(reply.error?.code).toBe(-32601);
  });

  it("malformed JSON → -32700", async () => {
    const { secret } = await mintKey();
    const reply = await replyOf(await post("{not json", secret));
    expect(reply.error?.code).toBe(-32700);
  });

  it("batch arrays are rejected (2025-06-18 removed batching)", async () => {
    const { secret } = await mintKey();
    const reply = await replyOf(await post([rpc("ping")], secret));
    expect(reply.error?.code).toBe(-32600);
  });
});

describe("tools/list", () => {
  it("lists all 8 tools with object schemas for a fully-scoped key", async () => {
    const { secret } = await mintKey();
    const reply = await replyOf(await post(rpc("tools/list"), secret));
    const tools = (reply.result?.tools ?? []) as {
      name: string;
      description: string;
      inputSchema: { type: string; properties: Record<string, unknown>; required?: string[] };
    }[];
    expect(tools.map((t) => t.name)).toEqual([...MCP_TOOL_NAMES]);
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.inputSchema.type).toBe("object");
      expect(Object.keys(tool.inputSchema.properties).length).toBeGreaterThan(0);
      for (const required of tool.inputSchema.required ?? []) {
        expect(tool.inputSchema.properties).toHaveProperty(required);
      }
    }
  });

  it("is filtered to the key's scopes", async () => {
    const { secret } = await mintKey({ scopes: ["get_script", "get_project_status"] });
    const reply = await replyOf(await post(rpc("tools/list"), secret));
    const tools = (reply.result?.tools ?? []) as { name: string }[];
    expect(tools.map((t) => t.name)).toEqual(["get_script", "get_project_status"]);
  });
});

describe("tools/call", () => {
  it("get_project_status end to end (fixture project)", async () => {
    const { secret } = await mintKey();
    const result = await callTool(secret, "get_project_status", {
      project_id: fixtureProject.id,
    });
    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>;
    expect(payload.projectId).toBe(fixtureProject.id);
    expect(payload.title).toBe(fixtureProject.title);
    expect(payload.status).toBe(fixtureProject.status);
    expect(payload.channelId).toBe(FIXTURE_IDS.channel);
  });

  it("unknown tool → -32602", async () => {
    const { secret } = await mintKey();
    const reply = await replyOf(
      await post(rpc("tools/call", { name: "drop_database", arguments: {} }), secret),
    );
    expect(reply.error?.code).toBe(-32602);
  });

  it("bad arguments → -32602 with details", async () => {
    const { secret } = await mintKey();
    const reply = await replyOf(
      await post(
        rpc("tools/call", { name: "get_project_status", arguments: { project_id: "nope" } }),
        secret,
      ),
    );
    expect(reply.error?.code).toBe(-32602);
  });

  it("a tool outside the key's scopes is a domain error (isError)", async () => {
    const { secret } = await mintKey({ scopes: ["get_project_status"] });
    const reply = await replyOf(
      await post(
        rpc("tools/call", {
          name: "generate_script",
          arguments: { project_id: fixtureProject.id, frame_id: fixtureFrame.id },
        }),
        secret,
      ),
    );
    expect(reply.error).toBeUndefined();
    const result = reply.result as unknown as ToolCallResult;
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("not scoped");
  });

  it("a channel outside the key's channel_ids reads as not found", async () => {
    const foreign = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const secret = await plantForeignScopedKey(foreign);

    // The fixture channel EXISTS in the workspace, but this key is not
    // scoped for it → indistinguishable from a missing channel.
    const stats = await callTool(secret, "get_channel_stats", {
      channel_id: FIXTURE_IDS.channel,
    });
    expect(stats.isError).toBe(true);
    expect(stats.content[0]?.text).toContain("NOT_FOUND");

    // Same for a project that lives on the out-of-scope channel.
    const status = await callTool(secret, "get_project_status", {
      project_id: fixtureProject.id,
    });
    expect(status.isError).toBe(true);
    expect(status.content[0]?.text).toContain("NOT_FOUND");

    // A fully-scoped key on the same rows succeeds — the denial above was
    // the key's scope, not the data.
    const { secret: fullSecret } = await mintKey();
    const ok = await callTool(fullSecret, "get_project_status", {
      project_id: fixtureProject.id,
    });
    expect(ok.isError).toBeUndefined();
  });

  it("generate_script charges 6 credits through the shared pipeline (idempotency keys set)", async () => {
    const { secret } = await mintKey();
    const result = await callTool(secret, "generate_script", {
      project_id: fixtureProject.id,
      frame_id: fixtureFrame.id,
    });
    expect(result.isError).toBeUndefined();
    const accepted = JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>;
    expect(accepted.status).toBe("queued");
    expect(typeof accepted.scriptId).toBe("string");
    // Fixture mode runs the pipeline inline — the charges landed. Wave C
    // (C1): `script.generate` is the staged ORCHESTRATOR, so MCP rides the
    // same itemized per-stage metering (outline 1 + hooks 1 + draft 4 = 6,
    // each idempotency-keyed) — no MCP bypass of stage metering.
    const charges = deps.store.creditEntries.filter((e) => e.reason === "script_generation");
    expect(charges.map((e) => e.delta)).toEqual([-1, -1, -4]);
    expect(charges.reduce((sum, e) => sum + e.delta, 0)).toBe(-6);
    for (const charge of charges) {
      expect(charge.idempotencyKey).toMatch(/^(outline|hooks|draft):/);
      expect(charge.actorUserId).toBe(FIXTURE_IDS.user);
    }
  });

  it("generate_script is refused with a domain error at 0 credits", async () => {
    const workspace = getSharedWorkspaceStore().workspaces.find(
      (w) => w.id === FIXTURE_IDS.workspace,
    );
    expect(workspace).toBeDefined();
    if (workspace !== undefined) workspace.creditBalance = 0;
    const { secret } = await mintKey();
    const result = await callTool(secret, "generate_script", {
      project_id: fixtureProject.id,
      frame_id: fixtureFrame.id,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("PRECONDITION_FAILED");
    expect(deps.store.creditEntries).toHaveLength(0);
  });

  it("get_script joins script → project → channel scope", async () => {
    const { secret } = await mintKey();
    const result = await callTool(secret, "get_script", { script_id: FIXTURE_IDS.script });
    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      script: { id: string };
      sections: unknown[];
    };
    expect(payload.script.id).toBe(FIXTURE_IDS.script);
    expect(payload.sections.length).toBeGreaterThan(0);
  });

  it("generate_thumbnail returns a text brief and flags the image-gen cut", async () => {
    const { secret } = await mintKey();
    const result = await callTool(secret, "generate_thumbnail", {
      project_id: fixtureProject.id,
      composition_pattern: "big-text",
      subject_description: "A cracked hourglass on a desk",
    });
    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("THUMBNAIL BRIEF");
    expect(text).toContain("big-text");
    expect(text).toContain("TEXT BRIEF");
  });

  it("updates the key's last_used_at on every call", async () => {
    const { secret, apiKey } = await mintKey();
    await callTool(secret, "get_project_status", { project_id: fixtureProject.id });
    const listed = await apiKeysImpl.list({
      ctx: fixtureCtx,
      input: { workspaceId: fixtureCtx.workspaceId },
    });
    const row = listed.find((k) => k.id === apiKey.id);
    expect(row?.lastUsedAt).toBeInstanceOf(Date);
  });
});

describe("rate limiting", () => {
  it("the general policy (100/min) applies per key", async () => {
    setRateLimiterForTests(new RateLimiter(new MemorySlidingWindowStore(), () => 1_000_000));
    const { secret } = await mintKey();
    for (let i = 0; i < 100; i++) {
      const res = await post(rpc("ping"), secret);
      expect(res.status).toBe(200);
    }
    const denied = await post(rpc("ping"), secret);
    expect(denied.status).toBe(429);
    expect(denied.headers.get("RateLimit-Remaining")).toBe("0");
    expect(Number(denied.headers.get("Retry-After"))).toBeGreaterThan(0);

    // A different key has its own budget.
    const other = await mintKey();
    expect((await post(rpc("ping"), other.secret)).status).toBe(200);
  });
});
