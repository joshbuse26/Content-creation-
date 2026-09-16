"use client";

import type { Archetype } from "@/lib/types/entities";
import { Badge } from "@/components/ui/badge";
import {
  CONTRAST_RULE_LABELS,
  displayCopy,
  energyLabel,
  HOOK_STYLE_LABELS,
  hookTechniques,
  paceLabel,
  PALETTE_SWATCH_CLASSES,
  PALETTE_TEMPERATURE_LABELS,
} from "./presentation";

/** 1–5 energy meter rendered as bars, with a text label for screen readers. */
export function EnergyMeter({ energy }: { energy: number }) {
  return (
    <span
      className="inline-flex items-end gap-0.5"
      role="img"
      aria-label={`Energy ${energy} of 5 — ${energyLabel(energy)}`}
      title={`Energy: ${energyLabel(energy)}`}
    >
      {[1, 2, 3, 4, 5].map((level) => (
        <span
          key={level}
          aria-hidden="true"
          style={{ height: `${4 + level * 2}px` }}
          className={`w-1 rounded-sm ${
            level <= energy ? "bg-accent-600 dark:bg-accent-400" : "bg-zinc-200 dark:bg-zinc-700"
          }`}
        />
      ))}
    </span>
  );
}

/** Thumbnail-preset swatch — palette temperature + contrast rule as a chip. */
export function PresetSwatch({ preset }: { preset: Archetype["thumbnailPreset"] }) {
  const label = `${PALETTE_TEMPERATURE_LABELS[preset.paletteTemperature]} · ${CONTRAST_RULE_LABELS[preset.contrastRule]}`;
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400"
      title={`Thumbnail preset: ${label}`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-3.5 w-6 rounded-sm ring-1 ring-black/10 dark:ring-white/15 ${PALETTE_SWATCH_CLASSES[preset.paletteTemperature]}`}
      />
      <span className="sr-only">Thumbnail preset: </span>
      {label}
    </span>
  );
}

export interface ArchetypeCardProps {
  archetype: Archetype;
  selected: boolean;
  onSelect: () => void;
  /** Optional slot marker for crossover selection ("A" / "B"). */
  slot?: string;
  disabled?: boolean;
}

export function ArchetypeCard({
  archetype,
  selected,
  onSelect,
  slot,
  disabled,
}: ArchetypeCardProps) {
  const card = archetype.styleCard;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled === true}
      onClick={onSelect}
      className={`relative flex h-full cursor-pointer flex-col rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        selected
          ? "border-accent-600 bg-accent-50/60 ring-1 ring-accent-600 dark:border-accent-500 dark:bg-accent-950/40 dark:ring-accent-500"
          : "border-zinc-200 bg-white hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
      }`}
    >
      {slot !== undefined ? (
        <span className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-accent-700 text-[11px] font-bold text-white dark:bg-accent-600">
          {slot}
        </span>
      ) : null}
      <div className="flex items-center justify-between gap-2 pr-5">
        <span className="text-sm font-semibold">{archetype.displayName}</span>
        <EnergyMeter energy={card.energy} />
      </div>
      <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
        {displayCopy(archetype.pitch)}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <Badge tone="neutral" title={`${card.pacing.wpmTarget} words/min target`}>
          {paceLabel(card.pacing.wpmTarget)} pace
        </Badge>
        {hookTechniques(card).map((t) => (
          <Badge key={t} tone="blue">
            {HOOK_STYLE_LABELS[t]}
          </Badge>
        ))}
      </div>
      <div className="mt-auto pt-2">
        <PresetSwatch preset={archetype.thumbnailPreset} />
      </div>
    </button>
  );
}
