import { Badge, type BadgeTone } from "@/components/ui/badge";
import type { ProjectStatus, SyncStatus } from "@/lib/types/enums";

const projectTones: Record<ProjectStatus, BadgeTone> = {
  idea: "neutral",
  researching: "blue",
  framing: "purple",
  scripting: "accent",
  revising: "orange",
  packaging: "yellow",
  scheduled: "green",
  published: "green",
};

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return <Badge tone={projectTones[status]}>{status}</Badge>;
}

const syncTones: Record<SyncStatus, BadgeTone> = {
  never: "neutral",
  queued: "blue",
  syncing: "blue",
  synced: "green",
  failed: "red",
};

export function SyncStatusBadge({ status }: { status: SyncStatus }) {
  return <Badge tone={syncTones[status]}>{status === "never" ? "not synced" : status}</Badge>;
}
