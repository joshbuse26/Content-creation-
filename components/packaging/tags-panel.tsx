"use client";

import { useState } from "react";
import { skipToken } from "@tanstack/react-query";
import { trpc } from "@/components/providers/trpc";
import { useWorkspace } from "@/components/providers/workspace-context";
import { useProjectId } from "@/components/projects/project-frame";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/field";
import { IconCopy, IconSparkle, IconX } from "@/components/ui/icons";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/state";
import { useToast } from "@/components/ui/toast";

/** Tag set editor: chips with remove, add input, regenerate, copy-all. */
export function TagsPanel() {
  const { workspaceId } = useWorkspace();
  const projectId = useProjectId();
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const [newTag, setNewTag] = useState("");

  const latestQuery = trpc.tags.latest.useQuery(
    workspaceId !== null ? { workspaceId, projectId } : skipToken,
  );
  const invalidate = () => {
    if (workspaceId !== null) void utils.tags.latest.invalidate({ workspaceId, projectId });
  };
  const generateMutation = trpc.tags.generate.useMutation({
    onSuccess: invalidate,
    onError: () => {
      toast("Could not generate tags — try again.");
    },
  });
  const updateMutation = trpc.tags.update.useMutation({
    onSuccess: invalidate,
    onError: () => {
      invalidate();
      toast("Could not save the tag change — nothing was changed.");
    },
  });

  if (workspaceId === null || latestQuery.isLoading) return <LoadingState />;
  if (latestQuery.isError) {
    return (
      <ErrorState
        onRetry={() => {
          void latestQuery.refetch();
        }}
      />
    );
  }

  const tagSet = latestQuery.data ?? null;

  const save = (tags: string[]) => {
    if (tagSet === null) return;
    updateMutation.mutate({ workspaceId, tagSetId: tagSet.id, tags: tags.slice(0, 30) });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {tagSet !== null
            ? `${tagSet.tags.length} tags · ${tagSet.tags.join(",").length} characters (YouTube cap: 500)`
            : "Generate 15–25 tags from the script and niche keywords."}
        </p>
        <div className="flex gap-2">
          {tagSet !== null ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void navigator.clipboard.writeText(tagSet.tags.join(", ")).catch(() => undefined);
              }}
            >
              <IconCopy size={12} /> Copy all
            </Button>
          ) : null}
          <Button
            size="sm"
            busy={generateMutation.isPending}
            onClick={() => {
              generateMutation.mutate({ workspaceId, projectId });
            }}
          >
            <IconSparkle size={12} /> {tagSet !== null ? "Regenerate" : "Generate tags"}
          </Button>
        </div>
      </div>

      {tagSet === null ? (
        <EmptyState
          title="No tags yet"
          hint="Generate a set from the script and your niche keywords, then prune or add by hand."
        />
      ) : (
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-wrap gap-1.5">
            {tagSet.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-full bg-zinc-100 py-1 pr-1 pl-2.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
              >
                {tag}
                <button
                  type="button"
                  aria-label={`Remove tag ${tag}`}
                  className="cursor-pointer rounded-full p-0.5 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
                  onClick={() => {
                    save(tagSet.tags.filter((t) => t !== tag));
                  }}
                >
                  <IconX size={10} />
                </button>
              </span>
            ))}
          </div>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const tag = newTag.trim();
              if (tag === "" || tagSet.tags.includes(tag)) return;
              save([...tagSet.tags, tag]);
              setNewTag("");
            }}
          >
            <TextInput
              className="h-8 max-w-56 text-xs"
              placeholder="Add a tag…"
              value={newTag}
              onChange={(e) => {
                setNewTag(e.target.value);
              }}
            />
            <Button type="submit" size="sm" busy={updateMutation.isPending}>
              Add
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
