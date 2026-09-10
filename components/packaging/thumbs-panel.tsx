"use client";

import { useState } from "react";
import { skipToken } from "@tanstack/react-query";
import { trpc } from "@/components/providers/trpc";
import { useWorkspace } from "@/components/providers/workspace-context";
import { useProjectId } from "@/components/projects/project-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field, Select, TextArea } from "@/components/ui/field";
import { IconCheck, IconSparkle } from "@/components/ui/icons";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/state";

/** v1: text thumbnail briefs only — image generation ships in v1.1. */
const COMPOSITION_PATTERNS = [
  "face + object",
  "before / after",
  "big text",
  "split-screen",
  "arrow focus",
  "reaction inset",
  "object closeup",
  "versus grid",
  "number stack",
  "progress reveal",
];

export function ThumbsPanel() {
  const { workspaceId } = useWorkspace();
  const projectId = useProjectId();
  const utils = trpc.useUtils();
  const [pattern, setPattern] = useState(COMPOSITION_PATTERNS[0] ?? "big text");
  const [subject, setSubject] = useState("");

  const listQuery = trpc.thumbnails.list.useQuery(
    workspaceId !== null ? { workspaceId, projectId } : skipToken,
  );
  const invalidate = () => {
    if (workspaceId !== null) void utils.thumbnails.list.invalidate({ workspaceId, projectId });
  };
  const generateMutation = trpc.thumbnails.generate.useMutation({ onSuccess: invalidate });
  const chooseMutation = trpc.thumbnails.choose.useMutation({ onSuccess: invalidate });

  if (workspaceId === null || listQuery.isLoading) return <LoadingState />;
  if (listQuery.isError) {
    return (
      <ErrorState
        onRetry={() => {
          void listQuery.refetch();
        }}
      />
    );
  }

  const concepts = listQuery.data ?? [];

  return (
    <div className="space-y-5">
      <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        Thumbnail <strong>briefs</strong> for now — pick a composition pattern and describe the
        subject; image generation arrives in the next release.
      </p>

      <Card>
        <CardBody>
          <form
            className="grid gap-3 sm:grid-cols-[200px_1fr_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (subject.trim() === "") return;
              generateMutation.mutate({
                workspaceId,
                projectId,
                compositionPattern: pattern,
                subjectDescription: subject.trim(),
              });
              setSubject("");
            }}
          >
            <Field label="Composition pattern" htmlFor="th-pattern">
              <Select
                id="th-pattern"
                value={pattern}
                onChange={(e) => {
                  setPattern(e.target.value);
                }}
              >
                {COMPOSITION_PATTERNS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Subject" htmlFor="th-subject">
              <TextArea
                id="th-subject"
                className="min-h-9 h-9 resize-y py-1.5"
                placeholder="e.g. shocked creator holding tiny espresso machine, luxury machine looming behind"
                value={subject}
                onChange={(e) => {
                  setSubject(e.target.value);
                }}
              />
            </Field>
            <Button type="submit" variant="primary" busy={generateMutation.isPending}>
              <IconSparkle size={13} /> Draft brief
            </Button>
          </form>
        </CardBody>
      </Card>

      {concepts.length === 0 ? (
        <EmptyState title="No thumbnail briefs yet" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {concepts.map((c) => (
            <Card key={c.id} className={c.status === "chosen" ? "ring-2 ring-emerald-600 dark:ring-emerald-500" : ""}>
              <CardBody className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge tone="purple">{c.compositionPattern}</Badge>
                  {c.status === "chosen" ? (
                    <Badge tone="emerald">
                      <IconCheck size={10} /> chosen
                    </Badge>
                  ) : null}
                </div>
                <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{c.promptUsed}</p>
                {c.status !== "chosen" ? (
                  <Button
                    size="sm"
                    busy={chooseMutation.isPending && chooseMutation.variables.thumbnailConceptId === c.id}
                    onClick={() => {
                      chooseMutation.mutate({ workspaceId, thumbnailConceptId: c.id });
                    }}
                  >
                    Mark as chosen
                  </Button>
                ) : null}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
