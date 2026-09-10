import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { UserId, WorkspaceId } from "@/lib/types/ids";

/**
 * Shared plumbing for A2's router implementations.
 *
 * Each impl module exports an object keyed by procedure name whose handlers
 * take ({ ctx, input }) with the shapes the frozen contracts produce — the
 * integrator (A0) swaps the stub bodies in _contracts.ts for calls like:
 *
 *   search: workspaceProcedure("research", "create")
 *     .input(researchContracts.search.input)
 *     .output(researchContracts.search.output)
 *     .mutation((opts) => researchImpl.search(opts)),
 *
 * The ctx here is a structural subset of the real tRPC context after
 * workspaceProcedure ran (authz already enforced).
 */

export interface WorkspaceHandlerCtx {
  userId: UserId;
  workspaceId: WorkspaceId;
}

export interface HandlerOpts<TInput> {
  ctx: WorkspaceHandlerCtx;
  input: TInput;
}

export function notFound(what: string): never {
  throw new TRPCError({ code: "NOT_FOUND", message: `${what} not found` });
}

export function badRequest(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

/**
 * jobAccepted responses carry an opaque dispatch token — pipeline_runs rows
 * are created inside the PipelineRunner as stages start, so their ids are
 * not known at enqueue time (see REQUESTS-A2.md).
 */
export function jobAccepted(): { pipelineRunIds: string[]; status: "queued" } {
  return { pipelineRunIds: [randomUUID()], status: "queued" };
}
