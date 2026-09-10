import { logger } from "@/lib/logger";

/**
 * MCP streamable-HTTP protocol layer — hand-rolled JSON-RPC 2.0 (the
 * official @modelcontextprotocol/sdk swap is deferred — see OPEN-ITEMS.md; this module is deliberately transport-only and dependency-free
 * so swapping the SDK in later touches nothing but this file and the route).
 *
 * Supported methods: initialize · notifications/* (acknowledged, no reply) ·
 * ping · tools/list · tools/call. Single messages only — the 2025-06-18 MCP
 * revision removed JSON-RPC batching, so arrays are INVALID_REQUEST.
 *
 * Error split (build spec §6): protocol failures are JSON-RPC errors
 * (-32601 unknown method, -32602 bad params, …); DOMAIN failures (missing
 * rows, out-of-scope channels, insufficient credits) are successful
 * tools/call responses whose result carries `isError: true`.
 */

export const MCP_PROTOCOL_VERSION = "2025-06-18";

export const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

/** Thrown by handlers for protocol-level failures (becomes a JSON-RPC error). */
export class McpProtocolError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "McpProtocolError";
  }
}

export type JsonRpcId = string | number | null;

export interface JsonRpcErrorShape {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: JsonRpcErrorShape;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export interface McpRequestHandlers {
  serverInfo: { name: string; version: string };
  instructions?: string;
  listTools(): McpToolDefinition[] | Promise<McpToolDefinition[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
}

export function jsonRpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

function jsonRpcResult(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

interface ParsedMessage {
  id: JsonRpcId | undefined;
  method: string;
  params: Record<string, unknown>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMessage(raw: unknown): ParsedMessage | JsonRpcResponse {
  if (Array.isArray(raw)) {
    return jsonRpcError(
      null,
      JSON_RPC_ERRORS.INVALID_REQUEST,
      "Batch requests are not supported by this MCP revision",
    );
  }
  if (!isPlainObject(raw)) {
    return jsonRpcError(null, JSON_RPC_ERRORS.INVALID_REQUEST, "Invalid JSON-RPC request");
  }
  const rawId: unknown = raw.id;
  const id: JsonRpcId | undefined =
    typeof rawId === "string" || typeof rawId === "number" || rawId === null ? rawId : undefined;
  if (raw.jsonrpc !== "2.0" || typeof raw.method !== "string") {
    return jsonRpcError(id ?? null, JSON_RPC_ERRORS.INVALID_REQUEST, "Invalid JSON-RPC request");
  }
  const params = isPlainObject(raw.params) ? raw.params : {};
  return { id, method: raw.method, params };
}

/**
 * Handle one JSON-RPC message. Returns null for notifications (the HTTP
 * layer answers 202 Accepted with no body).
 */
export async function handleJsonRpcMessage(
  raw: unknown,
  handlers: McpRequestHandlers,
): Promise<JsonRpcResponse | null> {
  const parsed = parseMessage(raw);
  if (!("method" in parsed)) return parsed;
  const { id, method, params } = parsed;
  const isNotification = id === undefined;

  try {
    if (method.startsWith("notifications/")) return null;

    switch (method) {
      case "initialize": {
        if (isNotification) return null;
        return jsonRpcResult(id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: handlers.serverInfo,
          ...(handlers.instructions === undefined ? {} : { instructions: handlers.instructions }),
        });
      }
      case "ping": {
        return isNotification ? null : jsonRpcResult(id, {});
      }
      case "tools/list": {
        if (isNotification) return null;
        const tools = await handlers.listTools();
        return jsonRpcResult(id, { tools });
      }
      case "tools/call": {
        if (isNotification) return null;
        const name = params.name;
        if (typeof name !== "string" || name === "") {
          return jsonRpcError(
            id,
            JSON_RPC_ERRORS.INVALID_PARAMS,
            "tools/call requires a string `name`",
          );
        }
        const args = isPlainObject(params.arguments) ? params.arguments : {};
        const result = await handlers.callTool(name, args);
        return jsonRpcResult(id, result);
      }
      default:
        return isNotification
          ? null
          : jsonRpcError(id, JSON_RPC_ERRORS.METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  } catch (err) {
    if (isNotification) return null;
    if (err instanceof McpProtocolError) {
      return jsonRpcError(id, err.code, err.message, err.data);
    }
    // Generic message to clients; details to server logs only (spec §6).
    logger.error(
      { method, err: err instanceof Error ? err.message : String(err) },
      "mcp internal error",
    );
    return jsonRpcError(id, JSON_RPC_ERRORS.INTERNAL_ERROR, "Something went wrong");
  }
}
