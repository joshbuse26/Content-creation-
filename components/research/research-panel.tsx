"use client";

import Link from "next/link";
import { useState } from "react";
import { skipToken } from "@tanstack/react-query";
import { trpc } from "@/components/providers/trpc";
import { useWorkspace } from "@/components/providers/workspace-context";
import { useProjectId } from "@/components/projects/project-frame";
import { Button, IconButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { TextInput, Label } from "@/components/ui/field";
import { IconDoc, IconLink, IconSearch, IconTrash } from "@/components/ui/icons";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/state";
import { PipelineStatusNote } from "@/components/ui/pipeline-note";
import { useToast } from "@/components/ui/toast";
import { fmtDateTime, fmtNumber } from "@/components/lib/format";
import { usePipelinePoll } from "@/components/lib/use-pipeline-poll";
import { UploadResearchCard } from "./upload-research-card";

/**
 * Research screen: three source intakes (agent search, transcript import,
 * file upload) and the source list with kind attribution.
 */
export function ResearchPanel() {
  const { workspaceId } = useWorkspace();
  const projectId = useProjectId();
  const utils = trpc.useUtils();
  const { toast } = useToast();

  const listQuery = trpc.research.list.useQuery(
    workspaceId !== null ? { workspaceId, projectId } : skipToken,
  );

  const invalidate = () => {
    if (workspaceId !== null) void utils.research.list.invalidate({ workspaceId, projectId });
  };

  // The research agent runs as a queued pipeline — poll the list until the
  // brief lands (or give up visibly after a few minutes).
  const searchPoll = usePipelinePoll(invalidate, listQuery.data);

  const searchMutation = trpc.research.search.useMutation({
    onSuccess: () => {
      invalidate();
      searchPoll.begin();
    },
  });
  const transcriptMutation = trpc.research.importTranscript.useMutation({ onSuccess: invalidate });
  const uploadMutation = trpc.research.upload.useMutation({ onSuccess: invalidate });
  const removeMutation = trpc.research.remove.useMutation({
    onSuccess: invalidate,
    onError: () => {
      toast("Could not remove the source — it is still in the list.");
    },
  });

  const [query, setQuery] = useState("");
  const [transcriptUrl, setTranscriptUrl] = useState("");

  if (workspaceId === null) return <LoadingState />;

  // Text files (.txt/.md) ride the existing tRPC upload procedure; PDFs go
  // through the binary /api/research-upload route inside UploadResearchCard.
  const handleTextFile = (file: File) => {
    file
      .text()
      .then((text) => {
        uploadMutation.mutate({
          workspaceId,
          projectId,
          filename: file.name,
          kind: "upload",
          content: text.slice(0, 200_000),
        });
      })
      .catch(() => {
        toast("Could not read that file.");
      });
  };

  const docs = listQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Agent search */}
        <Card>
          <CardHeader
            title="Research agent"
            subtitle="Search the web, compile a cited brief. 1 credit."
          />
          <CardBody>
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (query.trim().length < 3) return;
                searchMutation.mutate({ workspaceId, projectId, query: query.trim() });
                setQuery("");
              }}
            >
              <Label htmlFor="rs-query">Search query</Label>
              <TextInput
                id="rs-query"
                placeholder="e.g. budget espresso machine blind tests"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                }}
              />
              <Button type="submit" variant="primary" size="sm" busy={searchMutation.isPending}>
                <IconSearch size={13} /> Run research
              </Button>
              <PipelineStatusNote
                poll={searchPoll}
                working="Research queued — the brief appears below when ready."
              />
              {searchMutation.isError ? (
                <p className="text-xs text-red-600 dark:text-red-400">Could not start the run.</p>
              ) : null}
            </form>
          </CardBody>
        </Card>

        {/* Transcript import */}
        <Card>
          <CardHeader
            title="Video transcript"
            subtitle="Import any public video's transcript by URL."
          />
          <CardBody>
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (transcriptUrl.trim() === "") return;
                transcriptMutation.mutate({
                  workspaceId,
                  projectId,
                  youtubeVideoUrl: transcriptUrl.trim(),
                });
                setTranscriptUrl("");
              }}
            >
              <Label htmlFor="rs-url">Video URL</Label>
              <TextInput
                id="rs-url"
                type="url"
                placeholder="https://www.youtube.com/watch?v=…"
                value={transcriptUrl}
                onChange={(e) => {
                  setTranscriptUrl(e.target.value);
                }}
              />
              <Button type="submit" variant="primary" size="sm" busy={transcriptMutation.isPending}>
                <IconLink size={13} /> Import transcript
              </Button>
              {transcriptMutation.isError ? (
                <p className="text-xs text-red-600 dark:text-red-400">
                  Import failed — check the URL.
                </p>
              ) : null}
            </form>
          </CardBody>
        </Card>

        {/* Upload (PDF via the binary route, .txt/.md via tRPC) */}
        <UploadResearchCard
          workspaceId={workspaceId}
          projectId={projectId}
          onUploaded={invalidate}
          onTextFile={handleTextFile}
          textBusy={uploadMutation.isPending}
          textError={uploadMutation.isError}
        />
      </div>

      {/* Source list */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-zinc-600 dark:text-zinc-400">
          Sources ({docs.length})
        </h2>
        {listQuery.isLoading ? (
          <LoadingState label="Loading sources…" />
        ) : listQuery.isError ? (
          <ErrorState
            message="Couldn't load your sources — check your connection and retry."
            onRetry={() => {
              void listQuery.refetch();
            }}
          />
        ) : docs.length === 0 ? (
          <EmptyState
            title="No sources yet"
            hint="Run the research agent, import a transcript, or upload notes. Every fact in your script will cite one of these."
          />
        ) : (
          <ul className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {docs.map((doc) => (
              <li key={doc.id} className="flex items-center gap-3 px-4 py-3">
                <IconDoc size={16} className="shrink-0 text-zinc-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{doc.title}</p>
                  <p className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                    <Badge
                      tone={
                        doc.kind === "web"
                          ? "blue"
                          : doc.kind === "transcript"
                            ? "purple"
                            : "neutral"
                      }
                    >
                      {doc.kind}
                    </Badge>
                    {fmtNumber(doc.wordCount)} words · fetched {fmtDateTime(doc.fetchedAt)}
                    {doc.sourceUrl !== null ? (
                      <a
                        href={doc.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate text-accent-700 hover:underline dark:text-accent-400"
                      >
                        {doc.sourceUrl}
                      </a>
                    ) : null}
                  </p>
                </div>
                <IconButton
                  label="Remove source"
                  onClick={() => {
                    removeMutation.mutate({ workspaceId, researchDocId: doc.id });
                  }}
                >
                  <IconTrash size={13} />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          Done gathering?{" "}
          <Link
            href={`/projects/${projectId}/framing`}
            className="font-medium text-accent-700 hover:underline dark:text-accent-400"
          >
            Continue to framing →
          </Link>
        </p>
      </div>
    </div>
  );
}
