import type { z } from "zod";
import { hasDb } from "@/db";
import type { apiKeysContracts } from "@/lib/types/api";
import type { ApiKey } from "@/lib/types/entities";
import type { ChannelId } from "@/lib/types/ids";
import { DrizzleChannelRepo, getSharedMemoryStore } from "@/server/channel/repo";
import { createApiKey, getApiKeyStore } from "@/server/mcp/keys";
import { MCP_TOOL_NAMES, isMcpToolName } from "@/server/mcp/tool-names";
import { badRequest, notFound, type HandlerOpts } from "./_shared";

/**
 * apiKeys router implementation (B2) — MCP access keys, build spec §6.
 *
 * Owner-only end to end: `workspaceProcedure("apiKey", …)` already restricts
 * every action (including read) to the workspace owner via the role matrix
 * in lib/authz.ts — the same gate billing uses, one level stricter.
 *
 * Show-once: `create` returns the plaintext secret exactly once; only its
 * SHA-256 hash is stored, and `list`/`revoke` return the public entity (no
 * hash, no secret). The UI derives a true display prefix from the row id
 * (see server/mcp/key-format.ts).
 *
 * INTEGRATOR WIRING (A0): in server/routers/_contracts.ts, replace the
 * apiKeysRouter stub bodies with:
 *   .query(({ ctx, input }) => apiKeysImpl.list({ ctx, input }))
 *   .mutation(({ ctx, input }) => apiKeysImpl.create({ ctx, input }))
 *   .mutation(({ ctx, input }) => apiKeysImpl.revoke({ ctx, input }))
 */

type ListInput = z.output<typeof apiKeysContracts.list.input>;
type CreateInput = z.output<typeof apiKeysContracts.create.input>;
type CreateOutput = z.output<typeof apiKeysContracts.create.output>;
type RevokeInput = z.output<typeof apiKeysContracts.revoke.input>;

function channelRepo() {
  return hasDb() ? new DrizzleChannelRepo() : getSharedMemoryStore();
}

export const apiKeysImpl = {
  async list({ ctx }: HandlerOpts<ListInput>): Promise<ApiKey[]> {
    return getApiKeyStore().list(ctx.workspaceId);
  },

  async create({ ctx, input }: HandlerOpts<CreateInput>): Promise<CreateOutput> {
    const scopes = [...new Set(input.scopes)];
    const unknown = scopes.filter((s) => !isMcpToolName(s));
    if (unknown.length > 0) {
      badRequest(
        `Unknown scope${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}. Valid scopes are the MCP tool names: ${MCP_TOOL_NAMES.join(", ")}.`,
      );
    }
    const channelIds: ChannelId[] = [...new Set(input.channelIds)];
    const repo = channelRepo();
    for (const channelId of channelIds) {
      const channel = await repo.get(ctx.workspaceId, channelId);
      if (channel === null) {
        // Same shape as a missing row — cross-tenant ids are not probeable.
        badRequest("One of the selected channels is not in this workspace.");
      }
    }
    return createApiKey({ workspaceId: ctx.workspaceId, scopes, channelIds });
  },

  async revoke({ ctx, input }: HandlerOpts<RevokeInput>): Promise<ApiKey> {
    const revoked = await getApiKeyStore().revoke(ctx.workspaceId, input.apiKeyId);
    if (revoked === null) notFound("API key");
    return revoked;
  },
} as const;
