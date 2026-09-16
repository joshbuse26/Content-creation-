"use client";

import { useState } from "react";
import { skipToken } from "@tanstack/react-query";
import { COMPOSITION_PATTERNS } from "@/pipelines/thumbnails/patterns";
import { trpc } from "@/components/providers/trpc";
import { useWorkspace } from "@/components/providers/workspace-context";
import { useProjectId } from "@/components/projects/project-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field, TextArea } from "@/components/ui/field";
import { IconCheck, IconSparkle } from "@/components/ui/icons";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/state";
import { PipelineStatusNote } from "@/components/ui/pipeline-note";
import { useToast } from "@/components/ui/toast";
import { usePipelinePoll } from "@/components/lib/use-pipeline-poll";

/** Spec §7: 1 credit per image, 3 images per run. */
const IMAGE_COUNT = 3;
const CREDIT_COST = 3;

export function ThumbsPanel() {
  const { workspaceId } = useWorkspace();
  const projectId = useProjectId();
  const utils = trpc.useUtils();
  const { toast } = useToast();
  // null = no explicit choice yet — defaults to the archetype preset
  // ("auto") when the project carries one, else the first library pattern.
  const [chosenPattern, setChosenPattern] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [overlay, setOverlay] = useState("");

  const projectQuery = trpc.project.get.useQuery(
    workspaceId !== null ? { workspaceId, projectId } : skipToken,
  );
  // The server resolves "auto" from the project row's mode fields — offer it
  // exactly when the row carries an archetype or crossover (REQUESTS-C3).
  const hasPreset =
    projectQuery.data?.generationMode === "archetype" ||
    projectQuery.data?.generationMode === "crossover";
  const pattern =
    chosenPattern ?? (hasPreset ? "auto" : (COMPOSITION_PATTERNS[0]?.id ?? "big-text"));

  const listQuery = trpc.thumbnails.list.useQuery(
    workspaceId !== null ? { workspaceId, projectId } : skipToken,
  );
  const invalidate = () => {
    if (workspaceId !== null) void utils.thumbnails.list.invalidate({ workspaceId, projectId });
  };
  // Image generation is a queued pipeline — poll until the concepts land.
  const generatePoll = usePipelinePoll(invalidate, listQuery.data);
  const generateMutation = trpc.thumbnails.generate.useMutation({
    onSuccess: () => {
      invalidate();
      generatePoll.begin();
    },
    onError: (err) => {
      toast(
        err.data?.code === "PRECONDITION_FAILED"
          ? "Not enough credits for a thumbnail run (3 needed)."
          : err.data?.code === "BAD_REQUEST"
            ? // Overlay word-cap / auto-pattern violations carry a clear message.
              err.message
            : "Could not start thumbnail generation — try again.",
      );
    },
  });
  const chooseMutation = trpc.thumbnails.choose.useMutation({
    onSuccess: () => {
      invalidate();
      toast("Thumbnail chosen.", "success");
    },
    onError: () => {
      invalidate();
      toast("Could not mark that thumbnail as chosen — nothing was changed.");
    },
  });

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
  const selected = COMPOSITION_PATTERNS.find((p) => p.id === pattern);

  return (
    <div className="space-y-5">
      <Card>
        <CardBody className="space-y-4">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Composition pattern
            </p>
            <div
              role="radiogroup"
              aria-label="Composition pattern"
              className="grid grid-cols-2 gap-2 sm:grid-cols-4"
            >
              {hasPreset ? (
                <button
                  type="button"
                  role="radio"
                  aria-checked={pattern === "auto"}
                  title="Use the composition pattern from this project's style preset."
                  onClick={() => {
                    setChosenPattern("auto");
                  }}
                  className={`rounded-md border px-2.5 py-2 text-left text-xs font-medium transition-colors ${
                    pattern === "auto"
                      ? "border-accent-600 bg-accent-50 text-accent-900 ring-1 ring-accent-600 dark:border-accent-500 dark:bg-accent-950/40 dark:text-accent-200 dark:ring-accent-500"
                      : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
                  }`}
                >
                  Auto (style preset)
                </button>
              ) : null}
              {COMPOSITION_PATTERNS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={p.id === pattern}
                  title={p.note}
                  onClick={() => {
                    setChosenPattern(p.id);
                  }}
                  className={`rounded-md border px-2.5 py-2 text-left text-xs font-medium transition-colors ${
                    p.id === pattern
                      ? "border-accent-600 bg-accent-50 text-accent-900 ring-1 ring-accent-600 dark:border-accent-500 dark:bg-accent-950/40 dark:text-accent-200 dark:ring-accent-500"
                      : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {pattern === "auto" ? (
              <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                The composition rule from this project&rsquo;s style preset is used automatically.
              </p>
            ) : selected !== undefined ? (
              <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{selected.note}</p>
            ) : null}
          </div>

          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (subject.trim() === "") return;
              generateMutation.mutate({
                workspaceId,
                projectId,
                compositionPattern: pattern,
                subjectDescription: subject.trim(),
                overlayText: overlay.trim() === "" ? null : overlay.trim(),
              });
            }}
          >
            <Field label="Subject" htmlFor="th-subject">
              <TextArea
                id="th-subject"
                className="min-h-16 resize-y"
                placeholder="e.g. shocked creator holding tiny espresso machine, luxury machine looming behind"
                value={subject}
                onChange={(e) => {
                  setSubject(e.target.value);
                }}
              />
            </Field>
            <Field label="Overlay text (optional)" htmlFor="th-overlay">
              <TextArea
                id="th-overlay"
                className="min-h-10 resize-y"
                placeholder="e.g. $200 vs $2000 — style presets cap the word count"
                value={overlay}
                onChange={(e) => {
                  setOverlay(e.target.value);
                }}
              />
            </Field>
            <div className="flex items-center gap-3">
              <Button
                type="submit"
                variant="primary"
                busy={generateMutation.isPending}
                disabled={subject.trim() === ""}
              >
                <IconSparkle size={13} /> Generate {IMAGE_COUNT} images
              </Button>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {CREDIT_COST} credits — 1 per image, charged when the run completes.
              </span>
            </div>
          </form>
        </CardBody>
      </Card>

      <PipelineStatusNote
        poll={generatePoll}
        working="Generating images — they appear below when the run finishes."
      />

      {concepts.length === 0 ? (
        <EmptyState
          title="No thumbnail concepts yet"
          hint="Pick a composition pattern, describe the subject, and generate three candidates."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {concepts.map((c) => (
            <Card
              key={c.id}
              className={c.status === "chosen" ? "ring-2 ring-accent-600 dark:ring-accent-500" : ""}
            >
              {c.imageKey !== null ? (
                // Plain <img>: bytes come from our authed object-storage
                // route; next/image's loader adds nothing here.
                <img
                  src={`/api/thumbnail-image?workspaceId=${workspaceId}&conceptId=${c.id}`}
                  alt={`Thumbnail candidate — ${c.compositionPattern}`}
                  width={1280}
                  height={720}
                  className="aspect-video w-full rounded-t-lg border-b border-zinc-200 object-cover dark:border-zinc-800"
                />
              ) : null}
              <CardBody className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge tone="purple">{c.compositionPattern}</Badge>
                  {c.status === "chosen" ? (
                    <Badge tone="accent">
                      <IconCheck size={10} /> chosen
                    </Badge>
                  ) : null}
                </div>
                {c.imageKey === null ? (
                  // Text-brief fallback — concepts generated before image
                  // generation was configured keep their designer brief.
                  <p className="whitespace-pre-line text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                    {c.promptUsed}
                  </p>
                ) : (
                  <p className="line-clamp-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                    {c.promptUsed}
                  </p>
                )}
                {c.status !== "chosen" ? (
                  <Button
                    size="sm"
                    busy={
                      chooseMutation.isPending &&
                      chooseMutation.variables.thumbnailConceptId === c.id
                    }
                    onClick={() => {
                      chooseMutation.mutate({ workspaceId, thumbnailConceptId: c.id });
                    }}
                  >
                    Use this one
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
