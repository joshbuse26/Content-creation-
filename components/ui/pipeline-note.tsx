"use client";

import type { PipelinePoll } from "@/components/lib/use-pipeline-poll";
import { Spinner } from "./spinner";

/**
 * Status line for queued pipeline work driven by usePipelinePoll: a spinner
 * note while polling, a "check back" note after the poll gives up, nothing
 * otherwise.
 */
export function PipelineStatusNote({
  poll,
  working = "Working — results refresh automatically.",
}: {
  poll: PipelinePoll;
  working?: string;
}) {
  if (poll.pending) {
    return (
      <p className="flex items-center gap-2 rounded-md bg-accent-50 px-3 py-2 text-xs text-accent-800 dark:bg-accent-950 dark:text-accent-300">
        <Spinner size={12} /> {working}
      </p>
    );
  }
  if (poll.timedOut) {
    return (
      <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
        Still working — this is taking longer than usual. Check back shortly; results appear once
        the pipeline finishes.
      </p>
    );
  }
  return null;
}
