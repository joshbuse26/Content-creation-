import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { z, ZodError } from "zod";
import type { Session } from "next-auth";
import { assertAccess, type Action, type Resource, type RoleResolver } from "@/lib/authz";
import { asUserId, workspaceIdSchema } from "@/lib/types/ids";
import { workspaceScopedSchema } from "@/lib/types/api";
import { getRoleResolver } from "@/server/membership";
import { logger } from "@/lib/logger";

/**
 * tRPC v11 initialization — context, error shaping, and the authz-enforcing
 * procedure builders every router uses.
 */

export interface TrpcContext {
  session: Session | null;
  resolveRole: RoleResolver;
  requestId: string;
}

export function createContext(opts: { session: Session | null; requestId: string }): TrpcContext {
  return {
    session: opts.session,
    resolveRole: getRoleResolver(),
    requestId: opts.requestId,
  };
}

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    // Generic messages to clients; details go to server logs only (spec §6).
    const isZod = error.cause instanceof ZodError;
    if (error.code === "INTERNAL_SERVER_ERROR") {
      logger.error({ code: error.code, message: error.message }, "trpc internal error");
      return {
        ...shape,
        message: "Something went wrong",
        data: { ...shape.data, zodError: null },
      };
    }
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError: isZod ? z.treeifyError(error.cause) : null,
      },
    };
  },
});

export const router = t.router;
export const middleware = t.middleware;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (ctx.session?.user.id === undefined || ctx.session.user.id === "") {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
      userId: asUserId(ctx.session.user.id),
    },
  });
});

/**
 * Workspace-scoped procedure factory: parses `workspaceId` from the input and
 * enforces the role matrix via assertAccess BEFORE the handler runs. Chain
 * additional `.input()` calls for the procedure's own fields — tRPC merges
 * object schemas.
 */
export function workspaceProcedure(resource: Resource, action: Action) {
  return protectedProcedure.input(workspaceScopedSchema).use(async ({ ctx, input, next }) => {
    const workspaceId = workspaceIdSchema.parse(input.workspaceId);
    const role = await assertAccess(ctx.userId, workspaceId, resource, action, ctx.resolveRole);
    return next({ ctx: { ...ctx, workspaceId, role } });
  });
}
