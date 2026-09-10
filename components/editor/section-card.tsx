"use client";

import { useState, type ReactNode } from "react";
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
import { estSecondsFromWords, wordCount } from "./logic/stats";

export interface SectionCardProps {
  section: ScriptSection;
  isFirst: boolean;
  isLast: boolean;
  regenBusy?: boolean;
  onMove: (direction: -1 | 1) => void;
  onToggleLock: () => void;
  onSaveEdit: (fields: { heading?: string; body?: string }) => void;
  onRegenerate: (guidance?: string) => void;
  /** Multi-voice: workspace voice profiles for the per-section voice picker. */
  voiceProfiles?: VoiceProfile[];
  /** Multi-voice: assign (or clear, with null) this section's voice override. */
  onSetVoice?: (voiceProfileId: VoiceProfileId | null) => void;
  /** Rendered above the body for hook sections (the candidate switcher). */
  hookSlot?: ReactNode;
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
  voiceProfiles,
  onSetVoice,
  hookSlot,
}: SectionCardProps) {
  const [editing, setEditing] = useState(false);
  const [draftHeading, setDraftHeading] = useState(section.heading);
  const [draftBody, setDraftBody] = useState(section.body);
  const [steering, setSteering] = useState(false);
  const [steeringNote, setSteeringNote] = useState("");

  const words = wordCount(section.body);
  const computedSeconds = estSecondsFromWords(words);
  const { segments, unmatchedUnsupported } = highlightClaims(section.body, section.factRefs);
  const supportedRefs = section.factRefs.filter((f) => f.researchDocId !== null);
  const locked = section.locked;

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
        if (e.altKey && e.key === "ArrowUp" && !isFirst && !locked) {
          e.preventDefault();
          onMove(-1);
        }
        if (e.altKey && e.key === "ArrowDown" && !isLast && !locked) {
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
            disabled={isFirst || locked}
            className="h-5 w-5"
            onClick={() => {
              onMove(-1);
            }}
          >
            <IconArrowUp size={11} />
          </IconButton>
          <IconButton
            label="Move section down (Alt+↓)"
            disabled={isLast || locked}
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
              disabled={locked}
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
              <IconButton label="Edit text" disabled={locked} onClick={startEdit}>
                <IconPencil size={13} />
              </IconButton>
              <IconButton
                label="Expand section"
                disabled={locked || regenBusy}
                onClick={() => {
                  onRegenerate(EXPAND_GUIDANCE);
                }}
              >
                <IconExpand size={13} />
              </IconButton>
              <IconButton
                label="Condense section"
                disabled={locked || regenBusy}
                onClick={() => {
                  onRegenerate(CONDENSE_GUIDANCE);
                }}
              >
                <IconCondense size={13} />
              </IconButton>
              <IconButton
                label="Regenerate with a steering note"
                disabled={locked || regenBusy}
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

      {/* Steering note */}
      {steering && !editing ? (
        <form
          className="flex items-start gap-2 border-b border-zinc-100 bg-zinc-50 px-4 py-3 dark:border-zinc-800/60 dark:bg-zinc-800/40"
          onSubmit={(e) => {
            e.preventDefault();
            setSteering(false);
            onRegenerate(steeringNote.trim() === "" ? undefined : steeringNote.trim());
            setSteeringNote("");
          }}
        >
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
            <IconRefresh size={12} /> Regenerate
          </Button>
        </form>
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
          <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">
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
      </div>
    </section>
  );
}
