"use client";

import { useRef, useState, type ReactNode } from "react";
import type { ScriptSection, VoiceProfile } from "@/lib/types/entities";
import type { VoiceProfileId } from "@/lib/types/ids";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { TextArea, TextInput } from "@/components/ui/field";
import {
  IconArrowDown,
  IconArrowUp,
  IconCheck,
  IconCondense,
  IconExpand,
  IconLock,
  IconPencil,
  IconRefresh,
  IconUnlock,
  IconWarning,
  IconX,
} from "@/components/ui/icons";
import { fmtDuration } from "@/components/lib/format";
import { highlightClaims } from "./logic/claims";
import { computeLineDiff } from "./logic/diff";
import { estSecondsFromWords, wordCount } from "./logic/stats";

/** The before/after of a surgical regenerate awaiting accept/reject. */
export interface RegenPreview {
  before: string;
}

export interface SectionCardProps {
  section: ScriptSection;
  isFirst: boolean;
  isLast: boolean;
  regenBusy?: boolean;
  onMove: (direction: -1 | 1) => void;
  onToggleLock: () => void;
  onSaveEdit: (fields: { heading?: string; body?: string }) => void;
  onRegenerate: (guidance?: string) => void;
  /**
   * Surgical edit (E4): a steer note scoped to a HIGHLIGHTED span of the body.
   * Called instead of onRegenerate when the user has a selection. Omitted ⇒
   * the surgical affordance is unavailable and every regenerate is whole-section.
   */
  onSurgicalRegenerate?: (opts: { guidance?: string; selectionText: string }) => void;
  /**
   * Surgical diff review: when set, the section's current body is shown as a
   * before→after diff against `before` with accept/reject, instead of the
   * plain body.
   */
  regenPreview?: RegenPreview | null;
  onAcceptRegen?: () => void;
  onRejectRegen?: () => void;
  /** Multi-voice: workspace voice profiles for the per-section voice picker. */
  voiceProfiles?: VoiceProfile[];
  /** Multi-voice: assign (or clear, with null) this section's voice override. */
  onSetVoice?: (voiceProfileId: VoiceProfileId | null) => void;
  /** Rendered above the body for hook sections (the candidate switcher). */
  hookSlot?: ReactNode;
  /** Rendered below the body — the per-section comment thread (E4). */
  commentSlot?: ReactNode;
  /**
   * Role gate (E4): when false (viewer), every edit/regenerate/voice action is
   * disabled with a tooltip. Defaults true so writer+ and existing call sites
   * are unaffected.
   */
  canWrite?: boolean;
}

const EXPAND_GUIDANCE =
  "Expand this section: add concrete detail, examples, and connective tissue. Aim for roughly 40% more length without padding.";
const CONDENSE_GUIDANCE =
  "Condense this section: keep every load-bearing point and cut filler. Aim for roughly 60% of the current length.";

export function SectionCard({
  section,
  isFirst,
  isLast,
  regenBusy = false,
  onMove,
  onToggleLock,
  onSaveEdit,
  onRegenerate,
  onSurgicalRegenerate,
  regenPreview,
  onAcceptRegen,
  onRejectRegen,
  voiceProfiles,
  onSetVoice,
  hookSlot,
  commentSlot,
  canWrite = true,
}: SectionCardProps) {
  const [editing, setEditing] = useState(false);
  const [draftHeading, setDraftHeading] = useState(section.heading);
  const [draftBody, setDraftBody] = useState(section.body);
  const [steering, setSteering] = useState(false);
  const [steeringNote, setSteeringNote] = useState("");
  // Surgical edit (E4): the span the creator highlighted within this body.
  const [selection, setSelection] = useState("");
  const bodyRef = useRef<HTMLParagraphElement | null>(null);

  const words = wordCount(section.body);
  const computedSeconds = estSecondsFromWords(words);
  const { segments, unmatchedUnsupported } = highlightClaims(section.body, section.factRefs);
  const supportedRefs = section.factRefs.filter((f) => f.researchDocId !== null);
  const locked = section.locked;
  const editDisabled = locked || !canWrite;

  /** Capture the text the user highlighted inside THIS section's body. */
  const captureSelection = () => {
    const sel = typeof window !== "undefined" ? window.getSelection() : null;
    const text = sel?.toString().trim() ?? "";
    const node = bodyRef.current;
    if (
      text !== "" &&
      text.length <= 5000 &&
      node !== null &&
      sel !== null &&
      sel.rangeCount > 0 &&
      node.contains(sel.getRangeAt(0).commonAncestorContainer)
    ) {
      setSelection(text);
      setSteering(true);
    }
  };

  const startEdit = () => {
    setDraftHeading(section.heading);
    setDraftBody(section.body);
    setEditing(true);
  };

  const commitEdit = () => {
    setEditing(false);
    const fields: { heading?: string; body?: string } = {};
    if (draftHeading !== section.heading) fields.heading = draftHeading;
    if (draftBody !== section.body) fields.body = draftBody;
    if (Object.keys(fields).length > 0) onSaveEdit(fields);
  };

  return (
    <section
      data-testid={`section-${section.id}`}
      aria-label={section.heading}
      tabIndex={0}
      onKeyDown={(e) => {
        // Match the move buttons: locked sections cannot be reordered.
        if (e.altKey && e.key === "ArrowUp" && !isFirst && !editDisabled) {
          e.preventDefault();
          onMove(-1);
        }
        if (e.altKey && e.key === "ArrowDown" && !isLast && !editDisabled) {
          e.preventDefault();
          onMove(1);
        }
      }}
      className={`group rounded-lg border bg-white transition-colors dark:bg-zinc-900 ${
        locked
          ? "border-zinc-300 bg-zinc-50/80 dark:border-zinc-700 dark:bg-zinc-900/60"
          : "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      {/* Toolbar row */}
      <div className="flex items-center gap-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800/60">
        <div className="flex flex-col">
          <IconButton
            label="Move section up (Alt+↑)"
            disabled={isFirst || editDisabled}
            className="h-5 w-5"
            onClick={() => {
              onMove(-1);
            }}
          >
            <IconArrowUp size={11} />
          </IconButton>
          <IconButton
            label="Move section down (Alt+↓)"
            disabled={isLast || editDisabled}
            className="h-5 w-5"
            onClick={() => {
              onMove(1);
            }}
          >
            <IconArrowDown size={11} />
          </IconButton>
        </div>
        <Badge tone={section.kind === "hook" ? "emerald" : "neutral"}>{section.kind}</Badge>
        {editing ? (
          <TextInput
            aria-label="Section heading"
            className="h-7 max-w-xs text-sm font-semibold"
            value={draftHeading}
            onChange={(e) => {
              setDraftHeading(e.target.value);
            }}
          />
        ) : (
          <h3 className="truncate text-sm font-semibold">{section.heading}</h3>
        )}
        <span
          className="ml-auto text-xs text-zinc-500 tabular-nums dark:text-zinc-400"
          title="words · est runtime at 150 wpm (server estimate)"
        >
          {words}w · {fmtDuration(computedSeconds)}
          <span> / ~{fmtDuration(section.estSeconds)}</span>
        </span>

        {voiceProfiles !== undefined && onSetVoice !== undefined ? (
          <label className="flex items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            <span className="sr-only">Section voice</span>
            <select
              aria-label={`Voice for ${section.heading}`}
              title="Voice for this section — overrides the script voice"
              disabled={editDisabled}
              className="h-6 max-w-[9rem] rounded border border-zinc-200 bg-white px-1 text-[11px] text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
              value={section.voiceProfileId ?? ""}
              onChange={(e) => {
                const value = e.target.value;
                onSetVoice(value === "" ? null : (value as VoiceProfileId));
              }}
            >
              <option value="">Script voice</option>
              {voiceProfiles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="flex items-center gap-0.5">
          <IconButton
            label={locked ? "Unlock section" : "Lock section (regeneration skips it)"}
            disabled={!canWrite}
            onClick={onToggleLock}
            className={locked ? "text-amber-600 dark:text-amber-400" : ""}
          >
            {locked ? <IconLock size={13} /> : <IconUnlock size={13} />}
          </IconButton>
          {editing ? (
            <>
              <IconButton label="Save edits (Esc to cancel)" onClick={commitEdit}>
                <IconCheck size={13} />
              </IconButton>
              <IconButton
                label="Discard edits"
                onClick={() => {
                  setEditing(false);
                }}
              >
                <IconX size={13} />
              </IconButton>
            </>
          ) : (
            <>
              <IconButton label="Edit text" disabled={editDisabled} onClick={startEdit}>
                <IconPencil size={13} />
              </IconButton>
              <IconButton
                label="Expand section"
                disabled={editDisabled || regenBusy}
                onClick={() => {
                  onRegenerate(EXPAND_GUIDANCE);
                }}
              >
                <IconExpand size={13} />
              </IconButton>
              <IconButton
                label="Condense section"
                disabled={editDisabled || regenBusy}
                onClick={() => {
                  onRegenerate(CONDENSE_GUIDANCE);
                }}
              >
                <IconCondense size={13} />
              </IconButton>
              <IconButton
                label="Regenerate with a steering note"
                disabled={editDisabled || regenBusy}
                onClick={() => {
                  setSteering((v) => !v);
                }}
              >
                <IconRefresh size={13} className={regenBusy ? "animate-spin" : ""} />
              </IconButton>
            </>
          )}
        </div>
      </div>

      {/* Steering note (+ surgical selection scope) */}
      {steering && !editing ? (
        <form
          className="border-b border-zinc-100 bg-zinc-50 px-4 py-3 dark:border-zinc-800/60 dark:bg-zinc-800/40"
          onSubmit={(e) => {
            e.preventDefault();
            setSteering(false);
            const note = steeringNote.trim() === "" ? undefined : steeringNote.trim();
            // Surgical edit (E4): a highlighted span routes to the scoped path.
            if (selection !== "" && onSurgicalRegenerate !== undefined) {
              onSurgicalRegenerate({ guidance: note, selectionText: selection });
            } else {
              onRegenerate(note);
            }
            setSteeringNote("");
            setSelection("");
          }}
        >
          {selection !== "" ? (
            <p className="mb-2 rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
              Editing this part:{" "}
              <span className="italic">
                “{selection.length > 120 ? `${selection.slice(0, 120)}…` : selection}”
              </span>{" "}
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setSelection("");
                }}
              >
                clear
              </button>
            </p>
          ) : (
            <p className="mb-2 text-[11px] text-zinc-500 dark:text-zinc-400">
              Tip: highlight a sentence in the body first to steer just that part.
            </p>
          )}
          <div className="flex items-start gap-2">
            <TextInput
              autoFocus
              aria-label="Steering note"
              className="h-8 flex-1 text-xs"
              placeholder="Steer the rewrite — e.g. 'lead with the price reveal, drop the anecdote'"
              value={steeringNote}
              onChange={(e) => {
                setSteeringNote(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") setSteering(false);
              }}
            />
            <Button type="submit" size="sm" variant="primary">
              <IconRefresh size={12} /> {selection !== "" ? "Regen this part" : "Regenerate"}
            </Button>
          </div>
        </form>
      ) : null}

      {/* Surgical regenerate review: before→after diff + accept/reject */}
      {regenPreview != null && !editing ? (
        <div className="border-b border-zinc-100 dark:border-zinc-800/60">
          <div className="flex items-center gap-2 px-4 pt-3 pb-1">
            <Badge tone="emerald">Regenerated</Badge>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              Review the change, then keep or discard it.
            </span>
            <span className="flex-1" />
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                onAcceptRegen?.();
              }}
            >
              <IconCheck size={12} /> Keep
            </Button>
            <Button
              size="sm"
              onClick={() => {
                onRejectRegen?.();
              }}
            >
              <IconX size={12} /> Discard
            </Button>
          </div>
          <div className="px-4 pb-3 font-mono text-[13px] leading-relaxed">
            {computeLineDiff(regenPreview.before, section.body).map((row, i) => (
              <div
                key={i}
                className={`flex gap-2 px-1 py-0.5 whitespace-pre-wrap ${
                  row.type === "added"
                    ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200"
                    : row.type === "removed"
                      ? "bg-red-50 text-red-900 line-through decoration-red-400/60 dark:bg-red-950/40 dark:text-red-300"
                      : "text-zinc-500 dark:text-zinc-400"
                }`}
              >
                <span className="w-3 shrink-0 select-none">
                  {row.type === "added" ? "+" : row.type === "removed" ? "−" : " "}
                </span>
                <span>{row.text}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Body */}
      <div className="px-4 py-3">
        {hookSlot}
        {editing ? (
          <TextArea
            autoFocus
            aria-label="Section body"
            className="min-h-32 text-sm"
            value={draftBody}
            onChange={(e) => {
              setDraftBody(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(false);
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commitEdit();
            }}
          />
        ) : (
          <p
            ref={bodyRef}
            onMouseUp={
              canWrite && onSurgicalRegenerate !== undefined ? captureSelection : undefined
            }
            className="text-[15px] leading-relaxed whitespace-pre-wrap text-zinc-800 dark:text-zinc-200"
          >
            {segments.map((seg, i) =>
              seg.unsupported ? (
                <mark
                  key={i}
                  className="claim-unsupported"
                  title="Unsupported claim — no research source backs this. Edit it or add a source."
                >
                  {seg.text}
                </mark>
              ) : (
                <span key={i}>{seg.text}</span>
              ),
            )}
          </p>
        )}

        {/* Retention note + fact refs */}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {section.retentionNote !== null && section.retentionNote !== "" ? (
            <span className="text-[11px] text-violet-600 italic dark:text-violet-400">
              ◆ {section.retentionNote}
            </span>
          ) : null}
          <span className="flex-1" />
          {supportedRefs.length > 0 ? (
            <Badge tone="green" title={supportedRefs.map((r) => r.claim).join("\n")}>
              <IconCheck size={10} /> {supportedRefs.length} cited
            </Badge>
          ) : null}
          {unmatchedUnsupported.map((claim) => (
            <Badge key={claim} tone="yellow" title={claim}>
              <IconWarning size={10} /> unsupported claim
            </Badge>
          ))}
        </div>

        {commentSlot}
      </div>
    </section>
  );
}
