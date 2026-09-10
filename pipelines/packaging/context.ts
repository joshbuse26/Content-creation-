import { and, asc, desc, eq } from "drizzle-orm";
import { getDb, hasDb, schema } from "@/db";
import { fixtureChannel, fixtureFrame, fixtureProject, fixtureSections } from "@/lib/fixtures";
import type { FrameFormat, FrameOutcome, SectionKind } from "@/lib/types/enums";

/**
 * Packaging context — the script + frame inputs every packaging artifact
 * (description, tags, chapters, thumbnail brief) is generated from.
 *
 * Loaded from the DB when one is configured; in fixture mode (zero env) the
 * deterministic fixture project is returned so the whole packaging pipeline
 * works with no secrets and no services.
 */

export interface PackagingSection {
  kind: SectionKind;
  heading: string;
  body: string;
  estSeconds: number;
}

export interface PackagingFrame {
  angle: string;
  format: FrameFormat;
  outcome: FrameOutcome;
  audienceSegment: string;
  tone: string;
  targetMinutes: number;
  keywords: string[];
}

export interface PackagingContext {
  projectTitle: string;
  frame: PackagingFrame | null;
  nicheKeywords: string[];
  sections: PackagingSection[];
}

export function fixturePackagingContext(): PackagingContext {
  return {
    projectTitle: fixtureProject.title,
    frame: {
      angle: fixtureFrame.angle,
      format: fixtureFrame.format,
      outcome: fixtureFrame.outcome,
      audienceSegment: fixtureFrame.audienceSegment,
      tone: fixtureFrame.tone,
      targetMinutes: fixtureFrame.targetMinutes,
      keywords: [...fixtureFrame.keywords],
    },
    nicheKeywords: [...fixtureChannel.nicheKeywords],
    sections: fixtureSections.map((s) => ({
      kind: s.kind,
      heading: s.heading,
      body: s.body,
      estSeconds: s.estSeconds,
    })),
  };
}

/**
 * Load the packaging context for a project. Every query is filtered by the
 * denormalized workspace_id (tenancy — spec §3/§4); a project outside the
 * workspace is indistinguishable from a missing one.
 */
export async function loadPackagingContext(
  workspaceId: string,
  projectId: string,
): Promise<PackagingContext> {
  if (!hasDb()) {
    return fixturePackagingContext();
  }
  const db = getDb();

  const projectRows = await db
    .select({ id: schema.projects.id, title: schema.projects.title })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.workspaceId, workspaceId)))
    .limit(1);
  const project = projectRows[0];
  if (project === undefined) {
    throw new Error("project not found in workspace");
  }

  const frameRows = await db
    .select()
    .from(schema.frames)
    .where(
      and(
        eq(schema.frames.projectId, projectId),
        eq(schema.frames.workspaceId, workspaceId),
        eq(schema.frames.chosen, true),
      ),
    )
    .orderBy(desc(schema.frames.updatedAt))
    .limit(1);
  const frameRow = frameRows[0];

  const scriptRows = await db
    .select({ id: schema.scripts.id })
    .from(schema.scripts)
    .where(
      and(eq(schema.scripts.projectId, projectId), eq(schema.scripts.workspaceId, workspaceId)),
    )
    .orderBy(desc(schema.scripts.version))
    .limit(1);
  const scriptRow = scriptRows[0];

  const sectionRows =
    scriptRow === undefined
      ? []
      : await db
          .select({
            kind: schema.scriptSections.kind,
            heading: schema.scriptSections.heading,
            body: schema.scriptSections.body,
            estSeconds: schema.scriptSections.estSeconds,
          })
          .from(schema.scriptSections)
          .where(
            and(
              eq(schema.scriptSections.scriptId, scriptRow.id),
              eq(schema.scriptSections.workspaceId, workspaceId),
            ),
          )
          .orderBy(asc(schema.scriptSections.position));

  const channelRows = await db
    .select({ nicheKeywords: schema.channels.nicheKeywords })
    .from(schema.channels)
    .innerJoin(schema.projects, eq(schema.projects.channelId, schema.channels.id))
    .where(and(eq(schema.projects.id, projectId), eq(schema.channels.workspaceId, workspaceId)))
    .limit(1);

  return {
    projectTitle: project.title,
    frame:
      frameRow === undefined
        ? null
        : {
            angle: frameRow.angle,
            format: frameRow.format,
            outcome: frameRow.outcome,
            audienceSegment: frameRow.audienceSegment,
            tone: frameRow.tone,
            targetMinutes: frameRow.targetMinutes,
            keywords: frameRow.keywords,
          },
    nicheKeywords: channelRows[0]?.nicheKeywords ?? [],
    sections: sectionRows,
  };
}
