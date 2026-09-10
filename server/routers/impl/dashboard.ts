import { and, count, desc, eq, isNotNull } from "drizzle-orm";
import type { z } from "zod";
import { getDb, hasDb, schema } from "@/db";
import { fixturePipelineRun, fixtureProject, fixtureWorkspace } from "@/lib/fixtures";
import type { dashboardContracts } from "@/lib/types/api";
import { pipelineRunSchema, projectSchema } from "@/lib/types/entities";
import type { ProjectStatus } from "@/lib/types/enums";
import type { UserId, WorkspaceId } from "@/lib/types/ids";

/**
 * dashboard router implementation — A4. Handlers keyed by procedure name,
 * matching the frozen dashboardContracts schemas.
 *
 * v1 scope (sprint plan §1): flat project overview; post-publish tracking is
 * cut to v1.1, so tracking rows carry projectedScore (from the promoted
 * idea) with actualViews/capturedAt null until the nightly tracking job
 * ships.
 *
 * Integrator: `.query(({ ctx, input }) => dashboardHandlers.overview({ ctx, input }))`
 * (and likewise for tracking) in _contracts.ts.
 */

interface HandlerCtx {
  userId: UserId;
  workspaceId: WorkspaceId;
}

type OverviewInput = z.output<typeof dashboardContracts.overview.input>;
type TrackingInput = z.output<typeof dashboardContracts.tracking.input>;
type OverviewOutput = z.output<typeof dashboardContracts.overview.output>;
type TrackingOutput = z.output<typeof dashboardContracts.tracking.output>;

const RECENT_LIMIT = 10;

export const dashboardHandlers = {
  async overview(opts: { ctx: HandlerCtx; input: OverviewInput }): Promise<OverviewOutput> {
    const { workspaceId } = opts.ctx;
    if (!hasDb()) {
      return {
        creditBalance: fixtureWorkspace.creditBalance,
        projectCounts: { [fixtureProject.status]: 1 },
        recentProjects: [fixtureProject],
        recentRuns: [fixturePipelineRun],
      };
    }
    const db = getDb();

    const workspaceRows = await db
      .select({ creditBalance: schema.workspaces.creditBalance })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, workspaceId))
      .limit(1);
    const workspace = workspaceRows[0];
    if (workspace === undefined) throw new Error("workspace not found");

    const countRows = await db
      .select({ status: schema.projects.status, n: count() })
      .from(schema.projects)
      .where(eq(schema.projects.workspaceId, workspaceId))
      .groupBy(schema.projects.status);
    const projectCounts: Partial<Record<ProjectStatus, number>> = {};
    for (const row of countRows) {
      projectCounts[row.status] = row.n;
    }

    const projectRows = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.workspaceId, workspaceId))
      .orderBy(desc(schema.projects.updatedAt))
      .limit(RECENT_LIMIT);

    const runRows = await db
      .select()
      .from(schema.pipelineRuns)
      .where(eq(schema.pipelineRuns.workspaceId, workspaceId))
      .orderBy(desc(schema.pipelineRuns.createdAt))
      .limit(RECENT_LIMIT);

    return {
      creditBalance: workspace.creditBalance,
      projectCounts,
      recentProjects: projectRows.map((r) => projectSchema.parse(r)),
      recentRuns: runRows.map((r) => pipelineRunSchema.parse(r)),
    };
  },

  async tracking(opts: { ctx: HandlerCtx; input: TrackingInput }): Promise<TrackingOutput> {
    const { ctx, input } = opts;
    if (!hasDb()) {
      return [
        { project: fixtureProject, projectedScore: 87.5, actualViews: null, capturedAt: null },
      ];
    }
    const db = getDb();

    const conditions = [
      eq(schema.projects.workspaceId, ctx.workspaceId),
      isNotNull(schema.projects.publishedVideoId),
    ];
    if (input.channelId !== undefined) {
      conditions.push(eq(schema.projects.channelId, input.channelId));
    }

    const rows = await db
      .select({ project: schema.projects, ideaScore: schema.ideas.score })
      .from(schema.projects)
      .leftJoin(schema.ideas, eq(schema.projects.ideaId, schema.ideas.id))
      .where(and(...conditions))
      .orderBy(desc(schema.projects.updatedAt))
      .limit(50);

    return rows.map((row) => ({
      project: projectSchema.parse(row.project),
      projectedScore: row.ideaScore === null ? null : Number(row.ideaScore),
      // Post-publish stats collection is v1.1 (sprint plan §1).
      actualViews: null,
      capturedAt: null,
    }));
  },
} as const;
