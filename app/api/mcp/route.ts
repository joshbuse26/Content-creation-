import { PRODUCT_NAME } from "@/lib/branding";
import { authenticateApiKey, McpAuthError } from "@/server/mcp/auth";
import {
  handleJsonRpcMessage,
  JSON_RPC_ERRORS,
  jsonRpcError,
  type McpRequestHandlers,
} from "@/server/mcp/protocol";
import { callMcpTool, listToolsForKey } from "@/server/mcp/tools";
import { enforceRateLimitHttp } from "@/server/ratelimit";

/**
 * /api/mcp — MCP server, streamable-HTTP transport (build spec §6).
 *
 * Auth: `Authorization: Bearer <api_key>` (SHA-256 lookup, workspace +
 * channel scoped, owner-issued via Settings → API keys). Rate limited with
 * the "general" policy PER KEY. JSON-RPC 2.0 over POST: initialize,
 * notifications/*, ping, tools/list, tools/call. No server-initiated SSE
 * stream (GET is 405) — every response is a single JSON body, which the
 * streamable-HTTP spec permits.
 *
 * CORS: deliberately none (spec §9 — the MCP endpoint is key-authed and
 * server-to-server; browsers have no business here).
 */

export const dynamic = "force-dynamic";

const SERVER_INFO = { name: `${PRODUCT_NAME} MCP`, version: "1.1.0" };

const INSTRUCTIONS =
  `${PRODUCT_NAME} — AI YouTube scriptwriting. Tools are scoped per API key ` +
  `(tool scopes + channel ids); generation tools charge workspace credits on ` +
  `completion exactly like the web app. generate_script returns a job ` +
  `acceptance — poll get_script / get_project_status for results.`;

function unauthorized(message: string): Response {
  return Response.json(
    { error: message },
    {
      status: 401,
      headers: { "WWW-Authenticate": 'Bearer realm="mcp", error="invalid_token"' },
    },
  );
}

export async function POST(req: Request): Promise<Response> {
  let auth;
  try {
    auth = await authenticateApiKey(req.headers.get("authorization"));
  } catch (err) {
    if (err instanceof McpAuthError) return unauthorized(err.message);
    throw err;
  }

  const limited = await enforceRateLimitHttp("general", `mcp-key:${auth.key.id}`);
  if (limited !== null) return limited;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json(jsonRpcError(null, JSON_RPC_ERRORS.PARSE_ERROR, "Parse error"));
  }

  const handlers: McpRequestHandlers = {
    serverInfo: SERVER_INFO,
    instructions: INSTRUCTIONS,
    listTools: () => listToolsForKey(auth.key),
    callTool: (name, args) => callMcpTool(auth, name, args),
  };

  const response = await handleJsonRpcMessage(raw, handlers);
  if (response === null) return new Response(null, { status: 202 });
  return Response.json(response);
}

/** No server-initiated stream in this build; POST is the only transport leg. */
export function GET(): Response {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}

export function DELETE(): Response {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
