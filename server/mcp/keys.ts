import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getDb, hasDb, schema } from "@/db";
import { FIXTURE_IDS, fixtureApiKey } from "@/lib/fixtures";
import { apiKeySchema, type ApiKey } from "@/lib/types/entities";
import { apiKeyIdSchema, type ApiKeyId, type ChannelId, type WorkspaceId } from "@/lib/types/ids";
import { API_KEY_SECRET_PREFIX, apiKeyIdFragment } from "./key-format";

/**
 * API-key store — generation, hashing, lookup, revocation (build spec §6).
 *
 * Secrets are minted from 32 random bytes, shown exactly once, and stored
 * only as a SHA-256 hex hash in api_keys.hashed_key. Drizzle-backed when a
 * database is configured; a shared in-memory store otherwise (fixture mode /
 * tests), seeded with the fixture key so zero-env MCP calls work out of the
 * box with FIXTURE_MCP_API_KEY_SECRET.
 */

/** An api_keys row: the public entity plus the stored hash. */
export interface StoredApiKey extends ApiKey {
  hashedKey: string;
}

export interface NewApiKey {
  id: ApiKeyId;
  workspaceId: WorkspaceId;
  hashedKey: string;
  scopes: string[];
  channelIds: ChannelId[];
}

export interface ApiKeyStore {
  insert(record: NewApiKey): Promise<ApiKey>;
  /** All keys for the workspace, newest first. Never returns hashes. */
  list(workspaceId: WorkspaceId): Promise<ApiKey[]>;
  /** Sets revoked_at (idempotent); null when the key is not in the workspace. */
  revoke(workspaceId: WorkspaceId, apiKeyId: ApiKeyId): Promise<ApiKey | null>;
  /** Auth lookup by hash — includes revoked keys so callers can 401 them explicitly. */
  findByHash(hashedKey: string): Promise<StoredApiKey | null>;
  touchLastUsed(apiKeyId: ApiKeyId, when: Date): Promise<void>;
}

// ---------------------------------------------------------------------------
// Key material
// ---------------------------------------------------------------------------

export function hashApiKeySecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** ≥32 bytes of entropy, base64url; the id fragment makes the UI prefix true. */
export function mintApiKeySecret(apiKeyId: string): string {
  return `${API_KEY_SECRET_PREFIX}${apiKeyIdFragment(apiKeyId)}_${randomBytes(32).toString("base64url")}`;
}

/**
 * The plaintext secret of the seeded fixture key — fixture/demo mode ONLY
 * (the in-memory store below is never used when a database is configured).
 * Lets `Authorization: Bearer <this>` exercise /api/mcp with zero env.
 */
export const FIXTURE_MCP_API_KEY_SECRET = `${API_KEY_SECRET_PREFIX}${apiKeyIdFragment(FIXTURE_IDS.apiKey)}_fixture_mcp_secret_do_not_use_in_production`;

/** Mint + hash + insert; returns the row and the show-once plaintext secret. */
export async function createApiKey(params: {
  workspaceId: WorkspaceId;
  scopes: string[];
  channelIds: ChannelId[];
}): Promise<{ apiKey: ApiKey; secret: string }> {
  const id = apiKeyIdSchema.parse(randomUUID());
  const secret = mintApiKeySecret(id);
  const apiKey = await getApiKeyStore().insert({
    id,
    workspaceId: params.workspaceId,
    hashedKey: hashApiKeySecret(secret),
    scopes: params.scopes,
    channelIds: params.channelIds,
  });
  return { apiKey, secret };
}

// ---------------------------------------------------------------------------
// In-memory store (fixture mode / tests)
// ---------------------------------------------------------------------------

function toEntity(row: StoredApiKey): ApiKey {
  const { hashedKey: _hashedKey, ...entity } = row;
  return apiKeySchema.parse(entity);
}

export class InMemoryApiKeyStore implements ApiKeyStore {
  private readonly rows: StoredApiKey[] = [];

  constructor() {
    // Seed the fixture key so zero-env mode has a working, scoped MCP key.
    this.rows.push({ ...fixtureApiKey, hashedKey: hashApiKeySecret(FIXTURE_MCP_API_KEY_SECRET) });
  }

  insert(record: NewApiKey): Promise<ApiKey> {
    const now = new Date();
    const row: StoredApiKey = {
      id: record.id,
      workspaceId: record.workspaceId,
      hashedKey: record.hashedKey,
      scopes: [...record.scopes],
      channelIds: [...record.channelIds],
      lastUsedAt: null,
      revokedAt: null,
      createdAt: now,
    };
    this.rows.push(row);
    return Promise.resolve(toEntity(row));
  }

  list(workspaceId: WorkspaceId): Promise<ApiKey[]> {
    return Promise.resolve(
      this.rows
        .filter((r) => r.workspaceId === workspaceId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map(toEntity),
    );
  }

  revoke(workspaceId: WorkspaceId, apiKeyId: ApiKeyId): Promise<ApiKey | null> {
    const row = this.rows.find((r) => r.id === apiKeyId && r.workspaceId === workspaceId);
    if (row === undefined) return Promise.resolve(null);
    row.revokedAt ??= new Date();
    return Promise.resolve(toEntity(row));
  }

  findByHash(hashedKey: string): Promise<StoredApiKey | null> {
    const row = this.rows.find((r) => r.hashedKey === hashedKey);
    return Promise.resolve(row === undefined ? null : { ...row });
  }

  touchLastUsed(apiKeyId: ApiKeyId, when: Date): Promise<void> {
    const row = this.rows.find((r) => r.id === apiKeyId);
    if (row !== undefined) row.lastUsedAt = when;
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Drizzle store (production)
// ---------------------------------------------------------------------------

export class DrizzleApiKeyStore implements ApiKeyStore {
  async insert(record: NewApiKey): Promise<ApiKey> {
    const rows = await getDb()
      .insert(schema.apiKeys)
      .values({
        id: record.id,
        workspaceId: record.workspaceId,
        hashedKey: record.hashedKey,
        scopes: record.scopes,
        channelIds: record.channelIds,
      })
      .returning();
    return apiKeySchema.parse(rows[0]);
  }

  async list(workspaceId: WorkspaceId): Promise<ApiKey[]> {
    const rows = await getDb()
      .select()
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.workspaceId, workspaceId))
      .orderBy(desc(schema.apiKeys.createdAt));
    return rows.map((r) => apiKeySchema.parse(r));
  }

  async revoke(workspaceId: WorkspaceId, apiKeyId: ApiKeyId): Promise<ApiKey | null> {
    const db = getDb();
    const existing = await db
      .select()
      .from(schema.apiKeys)
      .where(and(eq(schema.apiKeys.id, apiKeyId), eq(schema.apiKeys.workspaceId, workspaceId)))
      .limit(1);
    const row = existing[0];
    if (row === undefined) return null;
    if (row.revokedAt !== null) return apiKeySchema.parse(row);
    const updated = await db
      .update(schema.apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.apiKeys.id, apiKeyId), eq(schema.apiKeys.workspaceId, workspaceId)))
      .returning();
    return apiKeySchema.parse(updated[0]);
  }

  async findByHash(hashedKey: string): Promise<StoredApiKey | null> {
    const rows = await getDb()
      .select()
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.hashedKey, hashedKey))
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    return { ...apiKeySchema.parse(row), hashedKey: row.hashedKey };
  }

  async touchLastUsed(apiKeyId: ApiKeyId, when: Date): Promise<void> {
    await getDb()
      .update(schema.apiKeys)
      .set({ lastUsedAt: when })
      .where(eq(schema.apiKeys.id, apiKeyId));
  }
}

// ---------------------------------------------------------------------------
// Selection (mirrors getEngineStore / getSharedWorkspaceStore)
// ---------------------------------------------------------------------------

let cached: ApiKeyStore | undefined;

export function getApiKeyStore(): ApiKeyStore {
  cached ??= hasDb() ? new DrizzleApiKeyStore() : new InMemoryApiKeyStore();
  return cached;
}

/** Test hook: swap in a fresh store (or a specific instance). */
export function setApiKeyStoreForTests(store: ApiKeyStore | undefined): void {
  cached = store;
}
