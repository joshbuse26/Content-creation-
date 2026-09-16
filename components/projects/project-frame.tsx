"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { skipToken } from "@tanstack/react-query";
import type { ProjectId } from "@/lib/types/ids";
import { trpc } from "@/components/providers/trpc";
import { useWorkspace } from "@/components/providers/workspace-context";
import { ErrorState } from "@/components/ui/state";
import { ProjectStatusBadge } from "./status-badge";
import { ProjectStyleRow } from "./project-style";

const stageTabs = [
  // Chat is the primary surface (Wave D); the staged wizard stays reachable
  // for power users via the remaining tabs.
  { slug: "chat", label: "Chat" },
  { slug: "research", label: "Research" },
  { slug: "framing", label: "Framing" },
  { slug: "generate", label: "Generate" },
  { slug: "editor", label: "Editor" },
  { slug: "packaging", label: "Packaging" },
] as const;

export function useProjectId(): ProjectId {
  const params = useParams<{ projectId: string }>();
  return params.projectId as ProjectId;
}

/** Shared header + stage nav for all /projects/[projectId]/* screens. */
export function ProjectFrame({ children }: { children: ReactNode }) {
  const projectId = useProjectId();
  const pathname = usePathname();
  const { workspaceId } = useWorkspace();

  const projectQuery = trpc.project.get.useQuery(
    workspaceId !== null ? { workspaceId, projectId } : skipToken,
  );
  const project = projectQuery.data;

  return (
    <div>
      <div className="mb-1 text-xs">
        <Link
          href="/projects"
          className="text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          Projects
        </Link>
        <span className="mx-1 text-zinc-300 dark:text-zinc-600">/</span>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {project !== undefined ? (
          <>
            <h1 className="text-xl font-semibold tracking-tight">{project.title}</h1>
            <ProjectStatusBadge status={project.status} />
          </>
        ) : projectQuery.isError ? (
          <h1 className="text-xl font-semibold tracking-tight text-zinc-500 dark:text-zinc-400">
            Project unavailable
          </h1>
        ) : (
          <span
            aria-hidden="true"
            className="h-6 w-56 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800"
          />
        )}
      </div>
      <nav className="mb-6 flex flex-wrap items-center gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {stageTabs.map((tab) => {
          const href = `/projects/${projectId}/${tab.slug}`;
          const active = pathname.startsWith(href);
          return (
            <Link
              key={tab.slug}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "border-accent-600 text-accent-700 dark:border-accent-500 dark:text-accent-400"
                  : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      {projectQuery.isError ? (
        <ErrorState
          message="Couldn't load this project — it may have been deleted, or the connection dropped."
          onRetry={() => {
            void projectQuery.refetch();
          }}
        />
      ) : (
        <>
          <ProjectStyleRow projectId={projectId} />
          {children}
        </>
      )}
    </div>
  );
}
