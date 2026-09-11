"use client";

import { useState } from "react";
import { skipToken } from "@tanstack/react-query";
import type { GenerationTarget, VoiceProfile } from "@/lib/types/entities";
import { trpc } from "@/components/providers/trpc";
import { useWorkspace } from "@/components/providers/workspace-context";
import { Button, IconButton } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { IconTrash } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { trainedTarget } from "./blend";

/**
 * Train-a-voice surface (WAVE-D-PLAN §2c) — trained StyleCards are first-class
 * alongside archetypes. Two derivations:
 *  - Own channel: learn the creator's own voice from their uploads.
 *  - Competitor remix: derive an ORIGINAL card from a competitor's STRUCTURE
 *    (pacing, hooks, energy) — never a clone or copy of their words or name.
 *
 * Trained cards are selectable for generation, and rename/delete-manageable
 * here. Training costs credits (shown before the confirm). Self-contained: it
 * owns its trpc + selection wiring and reports the chosen target via onChange.
 */

/** Mirrors CREDIT_COSTS.trainVoice (server/credits.ts) for the confirm copy. */
const TRAIN_VOICE_COST = 5;

export interface TrainVoicePanelProps {
  value: GenerationTarget | null;
  onChange: (target: GenerationTarget | null) => void;
  disabled?: boolean;
}

export function TrainVoicePanel({ value, onChange, disabled = false }: TrainVoicePanelProps) {
  const { workspaceId, channelId } = useWorkspace();
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const profilesQuery = trpc.voiceProfile.list.useQuery(
    workspaceId !== null ? { workspaceId } : skipToken,
  );
  const trained = (profilesQuery.data ?? []).filter((p) => p.source === "trained");

  const [sampleIds, setSampleIds] = useState("");
  const [ownName, setOwnName] = useState("");
  const [competitors, setCompetitors] = useState("");
  const [remixName, setRemixName] = useState("");

  const refresh = () => {
    if (workspaceId !== null) void utils.voiceProfile.list.invalidate({ workspaceId });
  };

  const trainMutation = trpc.voice.trainFromChannel.useMutation({
    onSuccess: (result) => {
      refresh();
      onChange(trainedTarget(result.voiceProfile.id));
      toast(
        result.remix
          ? "Remixed voice created — an original card inspired by structure."
          : "Voice trained from your channel.",
        "success",
      );
    },
    onError: (err) => {
      toast(err.message, "error");
    },
  });

  const renameMutation = trpc.voiceProfile.rename.useMutation({
    onSuccess: () => {
      refresh();
    },
    onError: (err) => {
      toast(err.message, "error");
    },
  });

  const removeMutation = trpc.voiceProfile.remove.useMutation({
    onSuccess: (_res, vars) => {
      refresh();
      if (value?.mode === "train_on_my_channel" && value.voiceProfileId === vars.voiceProfileId) {
        onChange(null);
      }
      toast("Trained voice deleted.", "info");
    },
    onError: (err) => {
      toast(err.message, "error");
    },
  });

  const busy = trainMutation.isPending;

  const parseList = (raw: string): string[] =>
    raw
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

  const trainOwn = () => {
    if (workspaceId === null || channelId === null) return;
    const ids = parseList(sampleIds);
    trainMutation.mutate({
      workspaceId,
      channelId,
      sampleVideoIds: ids.length > 0 ? ids : null,
      remixFrom: null,
      name: ownName.trim().length > 0 ? ownName.trim() : null,
    });
  };

  const trainRemix = () => {
    if (workspaceId === null || channelId === null) return;
    const from = parseList(competitors);
    if (from.length === 0) {
      toast("Add at least one competitor channel URL or handle.", "info");
      return;
    }
    trainMutation.mutate({
      workspaceId,
      channelId,
      sampleVideoIds: null,
      remixFrom: from,
      name: remixName.trim().length > 0 ? remixName.trim() : null,
    });
  };

  const noChannel = channelId === null;

  return (
    <div className="space-y-5">
      {/* Trained-voice gallery */}
      <div role="radiogroup" aria-label="Pick a trained voice">
        {profilesQuery.isLoading ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Loading trained voices…</p>
        ) : trained.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            No trained voices yet. Train one from your channel below, or remix a competitor&rsquo;s
            structure into an original card.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {trained.map((profile) => (
              <TrainedCard
                key={profile.id}
                profile={profile}
                selected={
                  value?.mode === "train_on_my_channel" && value.voiceProfileId === profile.id
                }
                disabled={disabled || busy}
                onSelect={() => {
                  onChange(trainedTarget(profile.id));
                }}
                onRename={(name) => {
                  if (workspaceId !== null) {
                    renameMutation.mutate({ workspaceId, voiceProfileId: profile.id, name });
                  }
                }}
                onDelete={() => {
                  if (
                    workspaceId !== null &&
                    window.confirm(`Delete the trained voice "${profile.name}"?`)
                  ) {
                    removeMutation.mutate({ workspaceId, voiceProfileId: profile.id });
                  }
                }}
              />
            ))}
          </div>
        )}
      </div>

      {noChannel ? (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Connect a channel to train a voice.
        </p>
      ) : null}

      {/* Train from own channel */}
      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold">Train from your channel</h4>
          <Badge tone="neutral">{TRAIN_VOICE_COST} credits</Badge>
        </div>
        <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
          Learns your own spoken voice from your recent uploads (transcripts only — never scraped).
          Leave the video list empty to use a representative sample.
        </p>
        <div className="space-y-3">
          <Field label="Voice name (optional)" htmlFor="train-own-name">
            <TextInput
              id="train-own-name"
              value={ownName}
              disabled={disabled || busy || noChannel}
              placeholder="My channel voice"
              onChange={(e) => {
                setOwnName(e.target.value);
              }}
            />
          </Field>
          <Field
            label="Specific video IDs (optional)"
            htmlFor="train-own-ids"
            hint="Comma-separated. Leave blank to auto-sample recent uploads."
          >
            <TextInput
              id="train-own-ids"
              value={sampleIds}
              disabled={disabled || busy || noChannel}
              placeholder="dQw4w9WgXcQ, 9bZkp7q19f0"
              onChange={(e) => {
                setSampleIds(e.target.value);
              }}
            />
          </Field>
          <Button
            variant="primary"
            busy={busy}
            disabled={disabled || noChannel}
            onClick={() => {
              if (
                window.confirm(`Train a voice from your channel for ${TRAIN_VOICE_COST} credits?`)
              )
                trainOwn();
            }}
          >
            Train voice
          </Button>
        </div>
      </div>

      {/* Competitor remix */}
      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold">Remix a competitor into an original card</h4>
          <Badge tone="neutral">{TRAIN_VOICE_COST} credits</Badge>
        </div>
        <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
          Creates an <strong>original</strong> StyleCard inspired by a competitor&rsquo;s structure
          — pacing, hook cadence, energy. It is never a clone or copy of their words, and it carries
          no creator&rsquo;s name.
        </p>
        <div className="space-y-3">
          <Field label="Remixed voice name (optional)" htmlFor="train-remix-name">
            <TextInput
              id="train-remix-name"
              value={remixName}
              disabled={disabled || busy || noChannel}
              placeholder="Remixed voice"
              onChange={(e) => {
                setRemixName(e.target.value);
              }}
            />
          </Field>
          <Field
            label="Competitor channel URL(s) or handle(s)"
            htmlFor="train-remix-from"
            hint="Comma-separated. Structure only — their wording is never reproduced."
          >
            <TextInput
              id="train-remix-from"
              value={competitors}
              disabled={disabled || busy || noChannel}
              placeholder="@somechannel, https://youtube.com/@another"
              onChange={(e) => {
                setCompetitors(e.target.value);
              }}
            />
          </Field>
          <Button
            variant="primary"
            busy={busy}
            disabled={disabled || noChannel}
            onClick={() => {
              if (
                window.confirm(
                  `Create an original remixed card for ${TRAIN_VOICE_COST} credits? It is inspired by structure, not a clone.`,
                )
              )
                trainRemix();
            }}
          >
            Create original remixed card
          </Button>
        </div>
      </div>
    </div>
  );
}

function TrainedCard({
  profile,
  selected,
  disabled,
  onSelect,
  onRename,
  onDelete,
}: {
  profile: VoiceProfile;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(profile.name);
  const isRemix = profile.trainedFromChannelId !== profile.channelId;

  return (
    <div
      className={`flex flex-col rounded-lg border p-3 transition-colors ${
        selected
          ? "border-emerald-600 bg-emerald-50/60 ring-1 ring-emerald-600 dark:border-emerald-500 dark:bg-emerald-950/40 dark:ring-emerald-500"
          : "border-zinc-300 dark:border-zinc-700"
      }`}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          role="radio"
          aria-checked={selected}
          disabled={disabled}
          onClick={onSelect}
          className="flex-1 cursor-pointer text-left disabled:cursor-not-allowed disabled:opacity-50"
        >
          {editing ? null : <span className="text-sm font-semibold">{profile.name}</span>}
        </button>
        <IconButton label={`Delete ${profile.name}`} disabled={disabled} onClick={onDelete}>
          <IconTrash size={13} />
        </IconButton>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <Badge tone={isRemix ? "blue" : "green"}>{isRemix ? "Remixed" : "From channel"}</Badge>
        <Badge tone="neutral" title="Energy 1–5">
          energy {profile.styleCard.energy}/5
        </Badge>
      </div>
      {editing ? (
        <div className="mt-2 flex items-center gap-1.5">
          <TextInput
            aria-label="Rename voice"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
            }}
          />
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              const name = draft.trim();
              if (name.length > 0 && name !== profile.name) onRename(name);
              setEditing(false);
            }}
          >
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft(profile.name);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setEditing(true);
          }}
          className="mt-2 cursor-pointer self-start text-[11px] text-zinc-500 underline-offset-2 hover:underline disabled:cursor-not-allowed dark:text-zinc-400"
        >
          Rename
        </button>
      )}
    </div>
  );
}
