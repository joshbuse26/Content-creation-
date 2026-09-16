"use client";

import { useState } from "react";
import type { SectionComment } from "@/lib/types/entities";
import type { ScriptId, ScriptSectionId, WorkspaceId } from "@/lib/types/ids";
import { trpc } from "@/components/providers/trpc";
import { Button, IconButton } from "@/components/ui/button";
import { TextArea } from "@/components/ui/field";
import { IconCheck, IconX } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { fmtDate } from "@/components/lib/format";

/**
 * Light per-section comment thread (E4 — team collaboration). Not realtime:
 * it polls/invalidates on mutation. Role-gated by `canWrite` — a viewer reads
 * but the add box and the resolve/remove actions are hidden. The author-or-
 * admin remove rule is enforced server-side; the client shows the remove
 * affordance to writers+ and lets the server reject a non-author writer.
 */
export function CommentThread({
  workspaceId,
  scriptId,
  sectionId,
  canWrite,
}: {
  workspaceId: WorkspaceId;
  scriptId: ScriptId;
  sectionId: ScriptSectionId;
  canWrite: boolean;
}) {
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const [draft, setDraft] = useState("");

  const commentsQuery = trpc.comments.list.useQuery({ workspaceId, scriptId, sectionId });
  const comments = commentsQuery.data ?? [];

  const invalidate = () => {
    void utils.comments.list.invalidate({ workspaceId, scriptId, sectionId });
  };

  const addMutation = trpc.comments.add.useMutation({
    onSuccess: () => {
      setDraft("");
      invalidate();
    },
    onError: () => {
      toast("Could not post the comment — try again.");
    },
  });
  const resolveMutation = trpc.comments.resolve.useMutation({ onSuccess: invalidate });
  const unresolveMutation = trpc.comments.unresolve.useMutation({ onSuccess: invalidate });
  const removeMutation = trpc.comments.remove.useMutation({
    onSuccess: invalidate,
    onError: () => {
      toast("Could not remove the comment — only its author or an admin can.");
    },
  });

  const open = comments.filter((c) => !c.resolved);
  const resolved = comments.filter((c) => c.resolved);

  return (
    <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800/60">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-zinc-500 uppercase dark:text-zinc-400">
        Comments
        {comments.length > 0 ? (
          <span className="rounded-full bg-zinc-200 px-1.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
            {open.length} open
          </span>
        ) : null}
      </p>

      {comments.length === 0 ? (
        <p className="text-xs text-zinc-400 dark:text-zinc-500">No comments on this section yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {[...open, ...resolved].map((c) => (
            <CommentRow
              key={c.id}
              comment={c}
              canWrite={canWrite}
              busy={
                (resolveMutation.isPending && resolveMutation.variables.commentId === c.id) ||
                (unresolveMutation.isPending && unresolveMutation.variables.commentId === c.id) ||
                (removeMutation.isPending && removeMutation.variables.commentId === c.id)
              }
              onResolve={() => {
                resolveMutation.mutate({ workspaceId, commentId: c.id });
              }}
              onUnresolve={() => {
                unresolveMutation.mutate({ workspaceId, commentId: c.id });
              }}
              onRemove={() => {
                removeMutation.mutate({ workspaceId, commentId: c.id });
              }}
            />
          ))}
        </ul>
      )}

      {canWrite ? (
        <form
          className="mt-2 flex items-start gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const body = draft.trim();
            if (body === "") return;
            addMutation.mutate({ workspaceId, sectionId, body });
          }}
        >
          <TextArea
            aria-label="Add a comment"
            className="min-h-9 flex-1 text-xs"
            placeholder="Leave a note for the team…"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                const body = draft.trim();
                if (body !== "") addMutation.mutate({ workspaceId, sectionId, body });
              }
            }}
          />
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            busy={addMutation.isPending}
            disabled={draft.trim() === ""}
          >
            Comment
          </Button>
        </form>
      ) : (
        <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">
          You have view-only access — ask a writer or admin to comment.
        </p>
      )}
    </div>
  );
}

function CommentRow({
  comment,
  canWrite,
  busy,
  onResolve,
  onUnresolve,
  onRemove,
}: {
  comment: SectionComment;
  canWrite: boolean;
  busy: boolean;
  onResolve: () => void;
  onUnresolve: () => void;
  onRemove: () => void;
}) {
  return (
    <li
      className={`rounded-md border px-2.5 py-1.5 text-xs ${
        comment.resolved
          ? "border-zinc-200 bg-zinc-50/60 opacity-70 dark:border-zinc-800 dark:bg-zinc-900/40"
          : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
      }`}
    >
      <div className="flex items-start gap-2">
        <p className="flex-1 whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">
          {comment.resolved ? <span className="line-through">{comment.body}</span> : comment.body}
        </p>
        {canWrite ? (
          <div className="flex shrink-0 items-center gap-0.5">
            <IconButton
              label={comment.resolved ? "Reopen comment" : "Resolve comment"}
              disabled={busy}
              className={
                comment.resolved ? "text-zinc-400" : "text-accent-600 dark:text-accent-400"
              }
              onClick={comment.resolved ? onUnresolve : onResolve}
            >
              <IconCheck size={12} />
            </IconButton>
            <IconButton label="Remove comment" disabled={busy} onClick={onRemove}>
              <IconX size={12} />
            </IconButton>
          </div>
        ) : null}
      </div>
      <p className="mt-0.5 text-[10px] text-zinc-400 dark:text-zinc-500">
        {fmtDate(comment.createdAt)}
        {comment.resolved ? " · resolved" : ""}
      </p>
    </li>
  );
}
