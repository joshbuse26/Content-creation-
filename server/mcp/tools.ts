import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { Session } from "next-auth";
import { z } from "zod";
import { getConfig } from "@/lib/config";
import { logger } from "@/lib/logger";
import { IDEA_STATUSES } from "@/lib/types/enums";
import type { ApiKey, Project } from "@/lib/types/entities";
import {
  asChannelId,
  asProjectId,
  asScriptId,
  frameIdSchema,
  voiceProfileIdSchema,
} from "@/lib/types/ids";
import {
  buildThumbnailBrief,
  COMPOSITION_PATTERN_NOTES,
  loadPackagingContext,
} from "@/pipelines/packaging";
import { getEngineDeps } from "@/pipelines/script/deps";
import { appRouter } from "@/server/routers";
import { s3ConfigFromEnv } from "@/server/storage";
import { createCallerFactory, createContext } from "@/server/trpc";
import type { McpAuthContext } from "./auth";
import {
  JSON_RPC_ERRORS,
  McpProtocolError,
  type McpToolDefinition,
  type McpToolResult,
} from "./protocol";
import { isMcpToolName, MCP_TOOL_NAMES, type McpToolName } from "./tool-names";

/**
 * The 8 MCP tools (build spec §6), dispatched to the SAME handlers the tRPC
 * routers run: each call builds a tRPC caller for the key's workspace owner,
 * so authz, per-procedure rate limits, credit gating (requireCredits at
 * dispatch) and the idempotent completion charges in the pipelines are
 * shared with the web app — zero duplicated business logic.
 *
 * On top of that, every call is checked against the API key's OWN scopes:
 * `scopes` (tool names) gates which tools the key may call, `channel_ids`
 * gates which channels the call may touch (empty = all channels in the
 * workspace). Projects and scripts are resolved to their channel before
 * dispatch; an out-of-scope or cross-tenant id reads as "not found" either
 * way, so tenancy stays unprobeable.
 */

// ---------------------------------------------------------------------------
// Argument schemas (zod, local to MCP) + JSON Schemas (for tools/list)
// ---------------------------------------------------------------------------

const uuidArg = z.uuid();

const ARG_SCHEMAS = {
  get_channel_stats: z.object({ channel_id: uuidArg }),
  get_idea_feed: z.object({
    channel_id: uuidArg,
    status: z.enum(IDEA_STATUSES).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  run_research: z.object({ project_id: uuidArg, query: z.string().min(3).max(500) }),
  generate_script: z.object({
    project_id: uuidArg,
    frame_id: uuidArg,
    voice_profile_id: uuidArg.nullable().optional(),
  }),
  get_script: z.object({ script_id: uuidArg }),
  generate_titles: z.object({ project_id: uuidArg }),
  generate_thumbnail: z.object({
    project_id: uuidArg,
    composition_pattern: z.string().min(1).max(60),
    subject_description: z.string().min(1).max(500),
  }),
  get_project_status: z.object({ project_id: uuidArg }),
} as const satisfies Record<McpToolName, z.ZodType>;

const UUID_SCHEMA = { type: "string", format: "uuid" } as const;

const TOOL_DEFINITIONS: Record<McpToolName, McpToolDefinition> = {
  get_channel_stats: {
    name: "get_channel_stats",
    description:
      "Read a connected YouTube channel and its latest stats snapshot (subscribers, views, median performance).",
    inputSchema: {
      type: "object",
      properties: { channel_id: { ...UUID_SCHEMA, description: "Channel id (UUID)" } },
      required: ["channel_id"],
      additionalProperties: false,
    },
  },
  get_idea_feed: {
    name: "get_idea_feed",
    description: "Read the scored video-idea feed for a channel.",
    inputSchema: {
      type: "object",
      properties: {
        channel_id: { ...UUID_SCHEMA, description: "Channel id (UUID)" },
        status: {
          type: "string",
          enum: [...IDEA_STATUSES],
          description: "Filter by idea status",
        },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Max ideas (default 20)" },
      },
      required: ["channel_id"],
      additionalProperties: false,
    },
  },
  run_research: {
    name: "run_research",
    description:
      "Start the research agent for a project (web + transcript research). Charges 1 credit on completion.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { ...UUID_SCHEMA, description: "Project id (UUID)" },
        query: { type: "string", minLength: 3, maxLength: 500, description: "Research query" },
      },
      required: ["project_id", "query"],
      additionalProperties: false,
    },
  },
  generate_script: {
    name: "generate_script",
    description:
      "Run the 7-stage script pipeline for a project's chosen frame. Charges 6 credits on completion. Returns a job acceptance with the new script_id; poll get_script for the result.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { ...UUID_SCHEMA, description: "Project id (UUID)" },
        frame_id: { ...UUID_SCHEMA, description: "Frame id (UUID) to script against" },
        voice_profile_id: {
          ...UUID_SCHEMA,
          description: "Optional voice profile id (UUID); omit for the default voice",
        },
      },
      required: ["project_id", "frame_id"],
      additionalProperties: false,
    },
  },
  get_script: {
    name: "get_script",
    description:
      "Read a script: status, stats, ordered sections, quality-gate report and hook candidates.",
    inputSchema: {
      type: "object",
      properties: { script_id: { ...UUID_SCHEMA, description: "Script id (UUID)" } },
      required: ["script_id"],
      additionalProperties: false,
    },
  },
  generate_titles: {
    name: "generate_titles",
    description:
      "Generate a scored title set (25 options across pattern families) for a project. Charges 1 credit on completion.",
    inputSchema: {
      type: "object",
      properties: { project_id: { ...UUID_SCHEMA, description: "Project id (UUID)" } },
      required: ["project_id"],
      additionalProperties: false,
    },
  },
  generate_thumbnail: {
    name: "generate_thumbnail",
    description: `Generate thumbnail concepts for a project (3 images, 1 credit each) via the shared thumbnails pipeline. When image generation is not configured for this deployment (no image key / object storage), returns a thumbnail TEXT BRIEF instead with no credits charged. composition_pattern is one of the library patterns (${Object.keys(COMPOSITION_PATTERN_NOTES).join(", ")}) or free-form.`,
    inputSchema: {
      type: "object",
      properties: {
        project_id: { ...UUID_SCHEMA, description: "Project id (UUID)" },
        composition_pattern: {
          type: "string",
          minLength: 1,
          maxLength: 60,
          description: "Composition pattern name",
        },
        subject_description: {
          type: "string",
          minLength: 1,
          maxLength: 500,
          description: "What the thumbnail should show",
        },
      },
      required: ["project_id", "composition_pattern", "subject_description"],
      additionalProperties: false,
    },
  },
  get_project_status: {
    name: "get_project_status",
    description: "Read a project's current pipeline status and metadata.",
    inputSchema: {
      type: "object",
      properties: { project_id: { ...UUID_SCHEMA, description: "Project id (UUID)" } },
      required: ["project_id"],
      additionalProperties: false,
    },
  },
};

/** tools/list is filtered to the key's scopes — agents only see what they can call. */
export function listToolsForKey(key: ApiKey): McpToolDefinition[] {
  return MCP_TOOL_NAMES.filter((name) => key.scopes.includes(name)).map(
    (name) => TOOL_DEFINITIONS[name],
  );
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

function toolText(value: unknown): McpToolResult {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }] };
}

function toolError(message: string): McpToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function trpcErrorToToolResult(err: TRPCError, tool: McpToolName): McpToolResult {
  if (err.code === "INTERNAL_SERVER_ERROR") {
    // Generic message to clients; details to server logs only (spec §6).
    logger.error({ tool, message: err.message }, "mcp tool internal error");
    return toolError("Something went wrong");
  }
  return toolError(`${err.code}: ${err.message}`);
}

const createCaller = createCallerFactory(appRouter);

function callerFor(auth: McpAuthContext) {
  const session: Session = {
    user: { id: auth.actorUserId },
    expires: new Date(Date.now() + 60_000).toISOString(),
  };
  return createCaller(createContext({ session, requestId: `mcp_${randomUUID()}` }));
}

function channelInScope(key: ApiKey, channelId: string): boolean {
  return key.channelIds.length === 0 || key.channelIds.some((c) => (c as string) === channelId);
}

const OUT_OF_SCOPE_CHANNEL =
  "NOT_FOUND: channel not found (or outside this API key's channel scope)";
const OUT_OF_SCOPE_PROJECT =
  "NOT_FOUND: project not found (or outside this API key's channel scope)";

/**
 * Resolve a project and enforce the key's channel scope. Returns null when
 * the project is missing, cross-tenant, or on an out-of-scope channel —
 * indistinguishable cases by design.
 */
async function projectInScope(auth: McpAuthContext, projectId: string): Promise<Project | null> {
  const deps = await getEngineDeps();
  const project = await deps.store.getProject(auth.key.workspaceId, asProjectId(projectId));
  if (project === null || !channelInScope(auth.key, project.channelId)) return null;
  return project;
}

/**
 * generate_thumbnail dispatches to the real thumbnails pipeline only when
 * the deployment can actually produce and persist images: an image API key
 * plus S3-compatible object storage. Otherwise (fixture/keyless boots
 * included) the tool keeps its zero-cost TEXT BRIEF fallback.
 */
function thumbnailImageGenAvailable(): boolean {
  const config = getConfig();
  return config.IMAGE_API_KEY !== undefined && s3ConfigFromEnv() !== null;
}

export async function callMcpTool(
  auth: McpAuthContext,
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  if (!isMcpToolName(name)) {
    throw new McpProtocolError(JSON_RPC_ERRORS.INVALID_PARAMS, `Unknown tool: ${name}`);
  }
  if (!auth.key.scopes.includes(name)) {
    return toolError(
      `FORBIDDEN: this API key is not scoped for ${name}. Its scopes: ${auth.key.scopes.join(", ")}.`,
    );
  }
  const schema: z.ZodType = ARG_SCHEMAS[name];
  const parsedArgs = schema.safeParse(args);
  if (!parsedArgs.success) {
    throw new McpProtocolError(
      JSON_RPC_ERRORS.INVALID_PARAMS,
      `Invalid arguments for ${name}`,
      z.treeifyError(parsedArgs.error),
    );
  }

  const workspaceId = auth.key.workspaceId;
  const caller = callerFor(auth);

  try {
    switch (name) {
      case "get_channel_stats": {
        const input = parsedArgs.data as z.output<(typeof ARG_SCHEMAS)["get_channel_stats"]>;
        if (!channelInScope(auth.key, input.channel_id)) return toolError(OUT_OF_SCOPE_CHANNEL);
        const channel = await caller.channel.get({
          workspaceId,
          channelId: asChannelId(input.channel_id),
        });
        return toolText(channel);
      }
      case "get_idea_feed": {
        const input = parsedArgs.data as z.output<(typeof ARG_SCHEMAS)["get_idea_feed"]>;
        if (!channelInScope(auth.key, input.channel_id)) return toolError(OUT_OF_SCOPE_CHANNEL);
        const ideas = await caller.ideas.feed({
          workspaceId,
          channelId: asChannelId(input.channel_id),
          ...(input.status === undefined ? {} : { status: input.status }),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
        });
        return toolText(ideas);
      }
      case "run_research": {
        const input = parsedArgs.data as z.output<(typeof ARG_SCHEMAS)["run_research"]>;
        const project = await projectInScope(auth, input.project_id);
        if (project === null) return toolError(OUT_OF_SCOPE_PROJECT);
        const accepted = await caller.research.search({
          workspaceId,
          projectId: project.id,
          query: input.query,
        });
        return toolText(accepted);
      }
      case "generate_script": {
        const input = parsedArgs.data as z.output<(typeof ARG_SCHEMAS)["generate_script"]>;
        const project = await projectInScope(auth, input.project_id);
        if (project === null) return toolError(OUT_OF_SCOPE_PROJECT);
        const accepted = await caller.script.generate({
          workspaceId,
          projectId: project.id,
          frameId: frameIdSchema.parse(input.frame_id),
          voiceProfileId:
            input.voice_profile_id === undefined || input.voice_profile_id === null
              ? null
              : voiceProfileIdSchema.parse(input.voice_profile_id),
        });
        return toolText(accepted);
      }
      case "get_script": {
        const input = parsedArgs.data as z.output<(typeof ARG_SCHEMAS)["get_script"]>;
        const deps = await getEngineDeps();
        const script = await deps.store.getScript(workspaceId, asScriptId(input.script_id));
        if (script === null) {
          return toolError("NOT_FOUND: script not found (or outside this API key's channel scope)");
        }
        const project = await projectInScope(auth, script.projectId);
        if (project === null) {
          return toolError("NOT_FOUND: script not found (or outside this API key's channel scope)");
        }
        const result = await caller.script.get({ workspaceId, scriptId: script.id });
        return toolText(result);
      }
      case "generate_titles": {
        const input = parsedArgs.data as z.output<(typeof ARG_SCHEMAS)["generate_titles"]>;
        const project = await projectInScope(auth, input.project_id);
        if (project === null) return toolError(OUT_OF_SCOPE_PROJECT);
        const accepted = await caller.titles.generate({ workspaceId, projectId: project.id });
        return toolText(accepted);
      }
      case "generate_thumbnail": {
        const input = parsedArgs.data as z.output<(typeof ARG_SCHEMAS)["generate_thumbnail"]>;
        const project = await projectInScope(auth, input.project_id);
        if (project === null) return toolError(OUT_OF_SCOPE_PROJECT);
        if (thumbnailImageGenAvailable()) {
          // Same caller-dispatch as generate_titles — the 3-credit gate and
          // idempotent completion charge come from the shared pipeline.
          const accepted = await caller.thumbnails.generate({
            workspaceId,
            projectId: project.id,
            compositionPattern: input.composition_pattern,
            subjectDescription: input.subject_description,
          });
          return toolText(accepted);
        }
        // Fallback: image key / object storage not configured — text brief.
        const ctx = await loadPackagingContext(workspaceId, project.id);
        const brief = buildThumbnailBrief(ctx, {
          compositionPattern: input.composition_pattern,
          subjectDescription: input.subject_description,
        });
        return toolText(
          `${brief}\n\n[Note: image generation is not configured for this deployment (image key / object storage missing) — this is a thumbnail TEXT BRIEF only. No credits were charged.]`,
        );
      }
      case "get_project_status": {
        const input = parsedArgs.data as z.output<(typeof ARG_SCHEMAS)["get_project_status"]>;
        const project = await projectInScope(auth, input.project_id);
        if (project === null) return toolError(OUT_OF_SCOPE_PROJECT);
        const fresh = await caller.project.get({ workspaceId, projectId: project.id });
        return toolText({
          projectId: fresh.id,
          title: fresh.title,
          status: fresh.status,
          channelId: fresh.channelId,
          targetPublishDate: fresh.targetPublishDate,
          publishedVideoId: fresh.publishedVideoId,
          updatedAt: fresh.updatedAt,
        });
      }
    }
  } catch (err) {
    if (err instanceof TRPCError) return trpcErrorToToolResult(err, name);
    throw err;
  }
}

/** Test/introspection hook — full definitions regardless of key scope. */
export function allToolDefinitions(): McpToolDefinition[] {
  return MCP_TOOL_NAMES.map((name) => TOOL_DEFINITIONS[name]);
}
