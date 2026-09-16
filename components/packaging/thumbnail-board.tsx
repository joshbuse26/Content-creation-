"use client";

import { useMemo, useState } from "react";
import { skipToken } from "@tanstack/react-query";
import { ARCHETYPE_SEEDS } from "@/lib/archetypes";
import type { ThumbnailConcept } from "@/lib/types/entities";
import { COLOR_MOODS, SUBJECT_MODES, type ColorMood, type SubjectMode } from "@/lib/types/enums";
import { COMPOSITION_PATTERNS } from "@/pipelines/thumbnails/patterns";
import { trpc } from "@/components/providers/trpc";
import { useWorkspace } from "@/components/providers/workspace-context";
import { useProjectId } from "@/components/projects/project-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field, Select, TextArea } from "@/components/ui/field";
import { IconCheck, IconDownload, IconPencil, IconSparkle } from "@/components/ui/icons";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/state";
import { useToast } from "@/components/ui/toast";

/** Per-image credit rate (spec §7); a board of N costs N credits. */
export const BOARD_PER_IMAGE_CREDIT = 1;
const COUNT_OPTIONS = [3, 4, 5, 6] as const;

const SUBJECT_LABELS: Record<SubjectMode, string> = {
  face: "Face",
  no_face: "No face",
  object: "Object",
};
const MOOD_LABELS: Record<ColorMood, string> = {
  warm: "Warm",
  cool: "Cool",
  neutral: "Neutral",
  vibrant: "Vibrant",
  moody: "Moody",
};

export interface BoardBaseParams {
  count: number;
  overlayText: string;
  preset: string | null;
  subject: SubjectMode | null;
  mood: ColorMood | null;
}

export interface TweakValues {
  compositionPattern: string;
  overlayText: string;
  preset: string | null;
  subject: SubjectMode | null;
  mood: ColorMood | null;
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested without trpc)
// ---------------------------------------------------------------------------

/** Sort a board's concepts, optionally floating favorites to the front. */
export function sortConcepts(
  concepts: readonly ThumbnailConcept[],
  opts: { favoritesFirst: boolean },
): ThumbnailConcept[] {
  const base = [...concepts].sort(
    (a, b) => a.sort - b.sort || a.createdAt.getTime() - b.createdAt.getTime(),
  );
  if (!opts.favoritesFirst) return base;
  return base.sort((a, b) => Number(b.favorited) - Number(a.favorited));
}

/** Keep only favorited concepts when `favoritesOnly` is on. */
export function filterConcepts(
  concepts: readonly ThumbnailConcept[],
  opts: { favoritesOnly: boolean },
): ThumbnailConcept[] {
  return opts.favoritesOnly ? concepts.filter((c) => c.favorited) : [...concepts];
}

/** Client-side export: fetch the authed stored image and save it. */
export async function exportConceptImage(
  workspaceId: string,
  concept: ThumbnailConcept,
): Promise<void> {
  if (concept.imageKey === null) return;
  const res = await fetch(
    `/api/thumbnail-image?workspaceId=${workspaceId}&conceptId=${concept.id}`,
  );
  if (!res.ok) throw new Error("image download failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `thumbnail-${concept.compositionPattern}-${concept.id.slice(0, 8)}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Tweak panel (presentational)
// ---------------------------------------------------------------------------

export function TweakPanel({
  concept,
  busy,
  onSubmit,
  onCancel,
}: {
  concept: ThumbnailConcept;
  busy: boolean;
  onSubmit: (values: TweakValues) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<TweakValues>({
    compositionPattern: concept.compositionPattern,
    overlayText: concept.overlayText ?? "",
    preset: concept.presetId,
    subject: concept.subjectMode,
    mood: (concept.colorMood as ColorMood | null) ?? null,
  });
  const fieldId = `tweak-${concept.id}`;

  return (
    <form
      className="space-y-3 border-t border-zinc-200 pt-3 dark:border-zinc-800"
      aria-label="Tweak this concept"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ ...values, overlayText: values.overlayText.trim() });
      }}
    >
      <Field label="Composition pattern" htmlFor={`${fieldId}-pattern`}>
        <Select
          id={`${fieldId}-pattern`}
          value={values.compositionPattern}
          onChange={(e) => {
            setValues((v) => ({ ...v, compositionPattern: e.target.value }));
          }}
        >
          {COMPOSITION_PATTERNS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Overlay text" htmlFor={`${fieldId}-overlay`}>
        <TextArea
          id={`${fieldId}-overlay`}
          className="min-h-10 resize-y"
          value={values.overlayText}
          onChange={(e) => {
            setValues((v) => ({ ...v, overlayText: e.target.value }));
          }}
        />
      </Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Preset" htmlFor={`${fieldId}-preset`}>
          <Select
            id={`${fieldId}-preset`}
            value={values.preset ?? ""}
            onChange={(e) => {
              setValues((v) => ({ ...v, preset: e.target.value === "" ? null : e.target.value }));
            }}
          >
            <option value="">Generic</option>
            {ARCHETYPE_SEEDS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.displayName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Subject" htmlFor={`${fieldId}-subject`}>
          <Select
            id={`${fieldId}-subject`}
            value={values.subject ?? ""}
            onChange={(e) => {
              setValues((v) => ({
                ...v,
                subject: e.target.value === "" ? null : (e.target.value as SubjectMode),
              }));
            }}
          >
            <option value="">Auto</option>
            {SUBJECT_MODES.map((s) => (
              <option key={s} value={s}>
                {SUBJECT_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Mood" htmlFor={`${fieldId}-mood`}>
          <Select
            id={`${fieldId}-mood`}
            value={values.mood ?? ""}
            onChange={(e) => {
              setValues((v) => ({
                ...v,
                mood: e.target.value === "" ? null : (e.target.value as ColorMood),
              }));
            }}
          >
            <option value="">Auto</option>
            {COLOR_MOODS.map((m) => (
              <option key={m} value={m}>
                {MOOD_LABELS[m]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" variant="primary" busy={busy}>
          <IconSparkle size={12} /> Regenerate this one
        </Button>
        <Button type="button" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          1 credit — charged when the new image is ready.
        </span>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Concept card (presentational)
// ---------------------------------------------------------------------------

export function ConceptCard({
  concept,
  workspaceId,
  favoriteBusy,
  chooseBusy,
  tweakBusy,
  tweakOpen,
  onToggleFavorite,
  onChooseWinner,
  onOpenTweak,
  onCloseTweak,
  onSubmitTweak,
  onExport,
}: {
  concept: ThumbnailConcept;
  workspaceId: string;
  favoriteBusy: boolean;
  chooseBusy: boolean;
  tweakBusy: boolean;
  tweakOpen: boolean;
  onToggleFavorite: () => void;
  onChooseWinner: () => void;
  onOpenTweak: () => void;
  onCloseTweak: () => void;
  onSubmitTweak: (values: TweakValues) => void;
  onExport: () => void;
}) {
  const chosen = concept.status === "chosen";
  return (
    <div data-testid="concept-card">
      <Card className={chosen ? "ring-2 ring-accent-600 dark:ring-accent-500" : ""}>
        <div className="relative">
          {concept.imageKey !== null ? (
            // Plain <img>: bytes come from our authed object-storage route.
            <img
              src={`/api/thumbnail-image?workspaceId=${workspaceId}&conceptId=${concept.id}`}
              alt={`Thumbnail concept — ${concept.compositionPattern}`}
              width={1280}
              height={720}
              className="aspect-video w-full rounded-t-lg border-b border-zinc-200 object-cover dark:border-zinc-800"
            />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center rounded-t-lg border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
              No image yet
            </div>
          )}
          <button
            type="button"
            aria-label={concept.favorited ? "Unfavorite concept" : "Favorite concept"}
            aria-pressed={concept.favorited}
            disabled={favoriteBusy}
            onClick={onToggleFavorite}
            className={`absolute right-2 top-2 rounded-full border px-2 py-1 text-sm leading-none shadow-sm transition-colors ${
              concept.favorited
                ? "border-amber-400 bg-amber-100 text-amber-700 dark:border-amber-500 dark:bg-amber-950/60 dark:text-amber-300"
                : "border-zinc-200 bg-white/90 text-zinc-500 hover:text-amber-600 dark:border-zinc-700 dark:bg-zinc-900/90 dark:text-zinc-400"
            }`}
          >
            <span aria-hidden>{concept.favorited ? "★" : "☆"}</span>
          </button>
        </div>
        <CardBody className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="purple">{concept.compositionPattern}</Badge>
            {concept.subjectMode !== null ? <Badge>{concept.subjectMode}</Badge> : null}
            {concept.colorMood !== null ? <Badge>{concept.colorMood}</Badge> : null}
            {chosen ? (
              <Badge tone="accent">
                <IconCheck size={10} /> chosen
              </Badge>
            ) : null}
          </div>
          {concept.overlayText !== null && concept.overlayText !== "" ? (
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
              “{concept.overlayText}”
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {!chosen ? (
              <Button size="sm" variant="primary" busy={chooseBusy} onClick={onChooseWinner}>
                Pick winner
              </Button>
            ) : null}
            <Button size="sm" onClick={tweakOpen ? onCloseTweak : onOpenTweak}>
              <IconPencil size={12} /> Tweak
            </Button>
            <Button
              size="sm"
              onClick={onExport}
              disabled={concept.imageKey === null}
              aria-label="Export concept image"
            >
              <IconDownload size={12} /> Export
            </Button>
          </div>
          {tweakOpen ? (
            <TweakPanel
              concept={concept}
              busy={tweakBusy}
              onSubmit={onSubmitTweak}
              onCancel={onCloseTweak}
            />
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Board container (trpc-wired)
// ---------------------------------------------------------------------------

export function ThumbnailBoard() {
  const { workspaceId } = useWorkspace();
  const projectId = useProjectId();
  const utils = trpc.useUtils();
  const { toast } = useToast();

  const [base, setBase] = useState<BoardBaseParams>({
    count: 4,
    overlayText: "",
    preset: null,
    subject: null,
    mood: null,
  });
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [openTweakId, setOpenTweakId] = useState<string | null>(null);

  const listQuery = trpc.thumbnails.listBoard.useQuery(
    workspaceId !== null ? { workspaceId, projectId } : skipToken,
  );
  const invalidate = () => {
    if (workspaceId !== null) {
      void utils.thumbnails.listBoard.invalidate({ workspaceId, projectId });
      void utils.thumbnails.list.invalidate({ workspaceId, projectId });
    }
  };

  const errorToast = (
    err: { data?: { code?: string } | null; message: string },
    fallback: string,
  ) => {
    toast(
      err.data?.code === "PRECONDITION_FAILED"
        ? "Not enough credits for this action."
        : err.data?.code === "BAD_REQUEST"
          ? err.message
          : fallback,
    );
  };

  const generateMutation = trpc.thumbnails.generateBoard.useMutation({
    onSuccess: () => {
      invalidate();
      toast("Board generated.", "success");
    },
    onError: (err) => {
      errorToast(err, "Could not generate the board — try again.");
    },
  });
  const tweakMutation = trpc.thumbnails.tweakConcept.useMutation({
    onSuccess: () => {
      invalidate();
      setOpenTweakId(null);
      toast("Concept regenerated.", "success");
    },
    onError: (err) => {
      errorToast(err, "Could not regenerate that concept.");
    },
  });
  const favoriteMutation = trpc.thumbnails.favorite.useMutation({ onSuccess: invalidate });
  const unfavoriteMutation = trpc.thumbnails.unfavorite.useMutation({ onSuccess: invalidate });
  const chooseMutation = trpc.thumbnails.chooseWinner.useMutation({
    onSuccess: () => {
      invalidate();
      toast("Winner attached to packaging.", "success");
    },
    onError: () => {
      invalidate();
      toast("Could not pick that winner — nothing changed.");
    },
  });

  const boards = listQuery.data ?? [];

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

  return (
    <div className="space-y-5">
      <Card>
        <CardBody className="space-y-4">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              generateMutation.mutate({
                workspaceId,
                projectId,
                count: base.count,
                overlayText: base.overlayText.trim() === "" ? null : base.overlayText.trim(),
                preset: base.preset,
                subject: base.subject,
                mood: base.mood,
              });
            }}
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="How many" htmlFor="board-count">
                <Select
                  id="board-count"
                  value={String(base.count)}
                  onChange={(e) => {
                    setBase((b) => ({ ...b, count: Number(e.target.value) }));
                  }}
                >
                  {COUNT_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n} concepts
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Preset" htmlFor="board-preset">
                <Select
                  id="board-preset"
                  value={base.preset ?? ""}
                  onChange={(e) => {
                    setBase((b) => ({
                      ...b,
                      preset: e.target.value === "" ? null : e.target.value,
                    }));
                  }}
                >
                  <option value="">Auto (from project)</option>
                  {ARCHETYPE_SEEDS.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.displayName}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Subject" htmlFor="board-subject">
                <Select
                  id="board-subject"
                  value={base.subject ?? ""}
                  onChange={(e) => {
                    setBase((b) => ({
                      ...b,
                      subject: e.target.value === "" ? null : (e.target.value as SubjectMode),
                    }));
                  }}
                >
                  <option value="">Auto</option>
                  {SUBJECT_MODES.map((s) => (
                    <option key={s} value={s}>
                      {SUBJECT_LABELS[s]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Mood" htmlFor="board-mood">
                <Select
                  id="board-mood"
                  value={base.mood ?? ""}
                  onChange={(e) => {
                    setBase((b) => ({
                      ...b,
                      mood: e.target.value === "" ? null : (e.target.value as ColorMood),
                    }));
                  }}
                >
                  <option value="">Auto</option>
                  {COLOR_MOODS.map((m) => (
                    <option key={m} value={m}>
                      {MOOD_LABELS[m]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Overlay text (optional)" htmlFor="board-overlay">
              <TextArea
                id="board-overlay"
                className="min-h-10 resize-y"
                placeholder="Shared across the board — presets cap the word count"
                value={base.overlayText}
                onChange={(e) => {
                  setBase((b) => ({ ...b, overlayText: e.target.value }));
                }}
              />
            </Field>
            <div className="flex items-center gap-3">
              <Button type="submit" variant="primary" busy={generateMutation.isPending}>
                <IconSparkle size={13} /> Generate board
              </Button>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {base.count} credits — {BOARD_PER_IMAGE_CREDIT} per concept, charged as each lands.
              </span>
            </div>
          </form>
        </CardBody>
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Concept boards
        </p>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={favoritesOnly}
            onChange={(e) => {
              setFavoritesOnly(e.target.checked);
            }}
          />
          Favorites only
        </label>
      </div>

      {boards.length === 0 ? (
        <EmptyState
          title="No concept boards yet"
          hint="Generate a board to compare several thumbnail directions side by side."
        />
      ) : (
        boards.map((board) => (
          <BoardGroup
            key={board.boardId ?? "legacy"}
            concepts={sortConcepts(filterConcepts(board.concepts, { favoritesOnly }), {
              favoritesFirst: true,
            })}
            workspaceId={workspaceId}
            openTweakId={openTweakId}
            favoriteBusyId={
              favoriteMutation.isPending
                ? favoriteMutation.variables.conceptId
                : unfavoriteMutation.isPending
                  ? unfavoriteMutation.variables.conceptId
                  : undefined
            }
            chooseBusyId={chooseMutation.isPending ? chooseMutation.variables.conceptId : undefined}
            tweakBusyId={tweakMutation.isPending ? tweakMutation.variables.conceptId : undefined}
            onToggleFavorite={(c) => {
              const mutation = c.favorited ? unfavoriteMutation : favoriteMutation;
              mutation.mutate({ workspaceId, conceptId: c.id });
            }}
            onChooseWinner={(c) => {
              chooseMutation.mutate({ workspaceId, conceptId: c.id });
            }}
            onOpenTweak={(c) => {
              setOpenTweakId(c.id);
            }}
            onCloseTweak={() => {
              setOpenTweakId(null);
            }}
            onSubmitTweak={(c, values) => {
              tweakMutation.mutate({
                workspaceId,
                conceptId: c.id,
                compositionPattern: values.compositionPattern,
                overlayText: values.overlayText === "" ? null : values.overlayText,
                preset: values.preset,
                subject: values.subject,
                mood: values.mood,
              });
            }}
            onExport={(c) => {
              void exportConceptImage(workspaceId, c).catch(() => {
                toast("Could not export that image.");
              });
            }}
          />
        ))
      )}
    </div>
  );
}

function BoardGroup({
  concepts,
  workspaceId,
  openTweakId,
  favoriteBusyId,
  chooseBusyId,
  tweakBusyId,
  onToggleFavorite,
  onChooseWinner,
  onOpenTweak,
  onCloseTweak,
  onSubmitTweak,
  onExport,
}: {
  concepts: ThumbnailConcept[];
  workspaceId: string;
  openTweakId: string | null;
  favoriteBusyId: string | undefined;
  chooseBusyId: string | undefined;
  tweakBusyId: string | undefined;
  onToggleFavorite: (c: ThumbnailConcept) => void;
  onChooseWinner: (c: ThumbnailConcept) => void;
  onOpenTweak: (c: ThumbnailConcept) => void;
  onCloseTweak: () => void;
  onSubmitTweak: (c: ThumbnailConcept, values: TweakValues) => void;
  onExport: (c: ThumbnailConcept) => void;
}) {
  const empty = useMemo(() => concepts.length === 0, [concepts]);
  if (empty) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="board-group">
      {concepts.map((c) => (
        <ConceptCard
          key={c.id}
          concept={c}
          workspaceId={workspaceId}
          favoriteBusy={favoriteBusyId === c.id}
          chooseBusy={chooseBusyId === c.id}
          tweakBusy={tweakBusyId === c.id}
          tweakOpen={openTweakId === c.id}
          onToggleFavorite={() => {
            onToggleFavorite(c);
          }}
          onChooseWinner={() => {
            onChooseWinner(c);
          }}
          onOpenTweak={() => {
            onOpenTweak(c);
          }}
          onCloseTweak={onCloseTweak}
          onSubmitTweak={(values) => {
            onSubmitTweak(c, values);
          }}
          onExport={() => {
            onExport(c);
          }}
        />
      ))}
    </div>
  );
}
