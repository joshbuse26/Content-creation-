"use client";

import { useState } from "react";
import { skipToken } from "@tanstack/react-query";
import type { ChannelId } from "@/lib/types/ids";
import { SOPHISTICATION_LEVELS, type Sophistication } from "@/lib/types/enums";
import { trpc } from "@/components/providers/trpc";
import { useWorkspace } from "@/components/providers/workspace-context";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Select, TextArea, TextInput } from "@/components/ui/field";
import {
  IconCheck,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconX,
} from "@/components/ui/icons";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/state";
import { PipelineStatusNote } from "@/components/ui/pipeline-note";
import { fmtDateTime } from "@/components/lib/format";
import { usePipelinePoll } from "@/components/lib/use-pipeline-poll";

/**
 * The avatar review screen: every field editable inline, per-field regenerate
 * (clear the field, then a fill-empty-fields regeneration — user edits win,
 * per spec §5.2) and a "regenerate all" that overwrites everything.
 */

type AvatarFieldKey =
  | "ageRange"
  | "genderSplit"
  | "geo"
  | "sophistication"
  | "pains"
  | "motivations"
  | "vocabularyNotes";

export function AvatarReview({ channelId }: { channelId: ChannelId }) {
  const { workspaceId } = useWorkspace();
  const utils = trpc.useUtils();

  const avatarQuery = trpc.avatar.get.useQuery(
    workspaceId !== null ? { workspaceId, channelId } : skipToken,
  );

  const updateMutation = trpc.avatar.update.useMutation({
    onSuccess: (avatar) => {
      if (workspaceId !== null) {
        utils.avatar.get.setData({ workspaceId, channelId }, avatar);
      }
    },
  });
  const invalidateAvatar = () => {
    if (workspaceId !== null) void utils.avatar.get.invalidate({ workspaceId, channelId });
  };
  // Avatar generation is a queued pipeline — poll until fields land.
  const regenPoll = usePipelinePoll(invalidateAvatar, avatarQuery.data);
  const regenMutation = trpc.avatar.regenerate.useMutation({
    onSuccess: () => {
      invalidateAvatar();
      regenPoll.begin();
    },
  });

  const [confirmAll, setConfirmAll] = useState(false);

  if (workspaceId === null || avatarQuery.isLoading) {
    return <LoadingState label="Loading audience avatar…" />;
  }
  if (avatarQuery.isError) {
    return (
      <ErrorState
        onRetry={() => {
          void avatarQuery.refetch();
        }}
      />
    );
  }
  const avatar = avatarQuery.data ?? null;
  if (avatar === null) {
    if (regenPoll.pending) {
      return (
        <EmptyState
          title="Generating your audience avatar…"
          hint="Analyzing your channel's videos, titles, and stats — fields appear here automatically."
        />
      );
    }
    if (regenMutation.isError || regenPoll.timedOut) {
      return (
        <EmptyState
          title={
            regenPoll.timedOut
              ? "Avatar generation is taking longer than usual"
              : "Avatar generation failed"
          }
          hint={
            regenPoll.timedOut
              ? "It may still finish in the background — retry if nothing appears."
              : "Something went wrong starting the run — try again."
          }
          action={
            <Button
              variant="primary"
              busy={regenMutation.isPending}
              onClick={() => {
                regenMutation.mutate({ workspaceId, channelId, regenerateAll: true });
              }}
            >
              <IconRefresh size={14} /> Retry
            </Button>
          }
        />
      );
    }
    return (
      <EmptyState
        title="No audience avatar yet"
        hint="Generate one from your channel's videos, titles, and stats. You can edit every field afterwards."
        action={
          <Button
            variant="primary"
            busy={regenMutation.isPending}
            onClick={() => {
              regenMutation.mutate({ workspaceId, channelId, regenerateAll: true });
            }}
          >
            <IconRefresh size={14} /> Generate avatar
          </Button>
        }
      />
    );
  }

  const saveField = (fields: Parameters<typeof updateMutation.mutate>[0]["fields"]) => {
    updateMutation.mutate({ workspaceId, channelId, fields });
  };

  const regenerateField = (key: AvatarFieldKey) => {
    // Clear the field, then run a fill-empty-fields regeneration.
    const cleared: Record<string, unknown> = {
      ageRange: { ageRange: null },
      genderSplit: { genderSplit: null },
      geo: { geo: [] },
      sophistication: { sophistication: null },
      pains: { pains: [] },
      motivations: { motivations: [] },
      vocabularyNotes: { vocabularyNotes: null },
    };
    updateMutation.mutate(
      {
        workspaceId,
        channelId,
        fields: cleared[key] as Parameters<typeof updateMutation.mutate>[0]["fields"],
      },
      {
        onSuccess: () => {
          regenMutation.mutate({ workspaceId, channelId, regenerateAll: false });
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader
        title="Audience avatar"
        subtitle={
          avatar.aiGeneratedAt !== null
            ? `AI-generated ${fmtDateTime(avatar.aiGeneratedAt)}${avatar.lastEditedBy !== null ? " · edited by you — your edits win over regeneration" : ""}`
            : "Describe who actually watches this channel"
        }
        actions={
          confirmAll ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">Overwrite your edits too?</span>
              <Button
                size="sm"
                variant="danger"
                busy={regenMutation.isPending}
                onClick={() => {
                  setConfirmAll(false);
                  regenMutation.mutate({ workspaceId, channelId, regenerateAll: true });
                }}
              >
                Regenerate all
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setConfirmAll(false);
                }}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              onClick={() => {
                setConfirmAll(true);
              }}
            >
              <IconRefresh size={13} /> Regenerate all
            </Button>
          )
        }
      />
      <CardBody className="space-y-5">
        <PipelineStatusNote
          poll={regenPoll}
          working="Regeneration queued — fields refresh when the pipeline finishes."
        />

        <div className="grid gap-5 sm:grid-cols-2">
          <InlineTextField
            label="Age range"
            value={avatar.ageRange ?? ""}
            placeholder="e.g. 25–40"
            onSave={(v) => {
              saveField({ ageRange: v === "" ? null : v });
            }}
            onRegenerate={() => {
              regenerateField("ageRange");
            }}
          />
          <InlineTextField
            label="Gender split"
            value={avatar.genderSplit ?? ""}
            placeholder="e.g. 70% male / 30% female"
            onSave={(v) => {
              saveField({ genderSplit: v === "" ? null : v });
            }}
            onRegenerate={() => {
              regenerateField("genderSplit");
            }}
          />
          <InlineTextField
            label="Top regions"
            value={avatar.geo.join(", ")}
            placeholder="e.g. US, UK, CA"
            hint="Comma-separated"
            onSave={(v) => {
              saveField({
                geo: v
                  .split(",")
                  .map((s) => s.trim())
                  .filter((s) => s !== ""),
              });
            }}
            onRegenerate={() => {
              regenerateField("geo");
            }}
          />
          <div>
            <FieldHead
              label="Sophistication"
              onRegenerate={() => {
                regenerateField("sophistication");
              }}
            />
            <Select
              value={avatar.sophistication ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                saveField({
                  sophistication: v === "" ? null : (v as Sophistication),
                });
              }}
            >
              <option value="">—</option>
              {SOPHISTICATION_LEVELS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <EvidenceListField
          label="Pains"
          nounSingular="pain"
          rows={avatar.pains.map((p) => ({ text: p.pain, evidence: p.evidence }))}
          onSave={(rows) => {
            saveField({ pains: rows.map((r) => ({ pain: r.text, evidence: r.evidence })) });
          }}
          onRegenerate={() => {
            regenerateField("pains");
          }}
        />
        <EvidenceListField
          label="Motivations"
          nounSingular="motivation"
          rows={avatar.motivations.map((m) => ({ text: m.motivation, evidence: m.evidence }))}
          onSave={(rows) => {
            saveField({
              motivations: rows.map((r) => ({ motivation: r.text, evidence: r.evidence })),
            });
          }}
          onRegenerate={() => {
            regenerateField("motivations");
          }}
        />

        <InlineTextField
          label="Vocabulary notes"
          multiline
          value={avatar.vocabularyNotes ?? ""}
          placeholder="Terms the audience knows; terms to explain on first use."
          onSave={(v) => {
            saveField({ vocabularyNotes: v === "" ? null : v });
          }}
          onRegenerate={() => {
            regenerateField("vocabularyNotes");
          }}
        />

        {updateMutation.isError ? (
          <p className="text-xs text-red-600 dark:text-red-400">Save failed — try again.</p>
        ) : null}
      </CardBody>
    </Card>
  );
}

function FieldHead({ label, onRegenerate }: { label: string; onRegenerate: () => void }) {
  return (
    <div className="mb-1 flex items-center justify-between">
      <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{label}</span>
      <IconButton
        label={`Regenerate ${label.toLowerCase()}`}
        onClick={onRegenerate}
        className="h-5 w-5"
      >
        <IconRefresh size={11} />
      </IconButton>
    </div>
  );
}

function InlineTextField({
  label,
  value,
  placeholder,
  hint,
  multiline = false,
  onSave,
  onRegenerate,
}: {
  label: string;
  value: string;
  placeholder?: string;
  hint?: string;
  multiline?: boolean;
  onSave: (value: string) => void;
  onRegenerate: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onSave(draft);
  };

  return (
    <div>
      <FieldHead label={label} onRegenerate={onRegenerate} />
      {editing ? (
        multiline ? (
          <TextArea
            autoFocus
            value={draft}
            placeholder={placeholder}
            onChange={(e) => {
              setDraft(e.target.value);
            }}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setDraft(value);
                setEditing(false);
              }
            }}
          />
        ) : (
          <TextInput
            autoFocus
            value={draft}
            placeholder={placeholder}
            onChange={(e) => {
              setDraft(e.target.value);
            }}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setDraft(value);
                setEditing(false);
              }
            }}
          />
        )
      ) : (
        <button
          type="button"
          onClick={() => {
            setDraft(value);
            setEditing(true);
          }}
          className="group flex w-full cursor-text items-start justify-between gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-sm hover:border-zinc-300 hover:bg-zinc-50 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/60"
        >
          <span className={value === "" ? "text-zinc-400 italic" : "whitespace-pre-wrap"}>
            {value === "" ? (placeholder ?? "Empty — click to edit") : value}
          </span>
          <IconPencil
            size={12}
            className="mt-0.5 shrink-0 text-zinc-300 group-hover:text-zinc-500"
          />
        </button>
      )}
      {hint !== undefined ? <p className="mt-1 text-[11px] text-zinc-400">{hint}</p> : null}
    </div>
  );
}

function EvidenceListField({
  label,
  nounSingular,
  rows,
  onSave,
  onRegenerate,
}: {
  label: string;
  nounSingular: string;
  rows: { text: string; evidence: string }[];
  onSave: (rows: { text: string; evidence: string }[]) => void;
  onRegenerate: () => void;
}) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draftText, setDraftText] = useState("");
  const [draftEvidence, setDraftEvidence] = useState("");

  const startEdit = (i: number) => {
    const row = rows[i];
    setEditingIndex(i);
    setDraftText(row?.text ?? "");
    setDraftEvidence(row?.evidence ?? "");
  };

  const commit = () => {
    if (editingIndex === null) return;
    const next = [...rows];
    if (draftText.trim() === "") {
      next.splice(editingIndex, 1);
    } else if (editingIndex >= next.length) {
      next.push({ text: draftText.trim(), evidence: draftEvidence.trim() });
    } else {
      next[editingIndex] = { text: draftText.trim(), evidence: draftEvidence.trim() };
    }
    setEditingIndex(null);
    onSave(next);
  };

  return (
    <div>
      <FieldHead label={label} onRegenerate={onRegenerate} />
      <ul className="space-y-1.5">
        {rows.map((row, i) =>
          editingIndex === i ? (
            <li
              key={i}
              className="rounded-md border border-emerald-400 p-2 dark:border-emerald-700"
            >
              <RowEditor
                nounSingular={nounSingular}
                text={draftText}
                evidence={draftEvidence}
                setText={setDraftText}
                setEvidence={setDraftEvidence}
                onCommit={commit}
                onCancel={() => {
                  setEditingIndex(null);
                }}
              />
            </li>
          ) : (
            <li
              key={i}
              className="group flex items-start justify-between gap-2 rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800"
            >
              <div className="min-w-0">
                <p className="text-sm">{row.text}</p>
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  Evidence: {row.evidence === "" ? "—" : row.evidence}
                </p>
              </div>
              <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <IconButton
                  label={`Edit ${nounSingular}`}
                  onClick={() => {
                    startEdit(i);
                  }}
                >
                  <IconPencil size={12} />
                </IconButton>
                <IconButton
                  label={`Remove ${nounSingular}`}
                  onClick={() => {
                    onSave(rows.filter((_, j) => j !== i));
                  }}
                >
                  <IconTrash size={12} />
                </IconButton>
              </div>
            </li>
          ),
        )}
        {editingIndex !== null && editingIndex >= rows.length ? (
          <li className="rounded-md border border-emerald-400 p-2 dark:border-emerald-700">
            <RowEditor
              nounSingular={nounSingular}
              text={draftText}
              evidence={draftEvidence}
              setText={setDraftText}
              setEvidence={setDraftEvidence}
              onCommit={commit}
              onCancel={() => {
                setEditingIndex(null);
              }}
            />
          </li>
        ) : null}
      </ul>
      <Button
        size="sm"
        variant="ghost"
        className="mt-1.5"
        onClick={() => {
          setEditingIndex(rows.length);
          setDraftText("");
          setDraftEvidence("");
        }}
      >
        <IconPlus size={12} /> Add {nounSingular}
      </Button>
    </div>
  );
}

function RowEditor({
  nounSingular,
  text,
  evidence,
  setText,
  setEvidence,
  onCommit,
  onCancel,
}: {
  nounSingular: string;
  text: string;
  evidence: string;
  setText: (v: string) => void;
  setEvidence: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <TextInput
        autoFocus
        placeholder={`The ${nounSingular}…`}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit();
          if (e.key === "Escape") onCancel();
        }}
      />
      <TextInput
        placeholder="Evidence (comments, search queries, retention data…)"
        value={evidence}
        onChange={(e) => {
          setEvidence(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit();
          if (e.key === "Escape") onCancel();
        }}
      />
      <div className="flex gap-1.5">
        <Button size="sm" variant="primary" onClick={onCommit}>
          <IconCheck size={12} /> Save
        </Button>
        <Button size="sm" onClick={onCancel}>
          <IconX size={12} /> Cancel
        </Button>
      </div>
    </div>
  );
}
