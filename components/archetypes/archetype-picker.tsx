"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { Archetype, GenerationTarget } from "@/lib/types/entities";
import type { ArchetypeId } from "@/lib/types/enums";
import { Badge } from "@/components/ui/badge";
import { Tabs, type TabDef } from "@/components/ui/tabs";
import { blendSummary, archetypeTarget, crossoverTarget } from "./blend";
import { ArchetypeCard, EnergyMeter } from "./archetype-card";
import { HOOK_STYLE_LABELS, paceLabel } from "./presentation";

/**
 * Archetype picker (wave C2) — the heart of project creation.
 *
 * Modes surfaced (PRODUCT-CONTRACTS §3): `archetype` (single-select gallery)
 * and `crossover` (two picks + weight slider with a client-side blend
 * preview; the server merge is authoritative). `partnered_named` renders
 * NOTHING unless the NEXT_PUBLIC feature flag is present at build time —
 * and the server rejects it regardless while FEATURE_PARTNERED_NAMED is
 * off. Trained voices (WAVE-D-PLAN §2c) surface as an optional "Trained
 * voices" tab when the host passes a `trainedSlot` (the TrainVoicePanel).
 */

/** Hidden-safe code path: no partnered UI exists unless this build flag is on. */
const PARTNERED_UI =
  process.env.NEXT_PUBLIC_FEATURE_PARTNERED_NAMED === "1" ||
  process.env.NEXT_PUBLIC_FEATURE_PARTNERED_NAMED === "true";

type PickerTab = "single" | "crossover" | "partnered" | "trained";

const DEFAULT_WEIGHT_A = 0.6;

export interface ArchetypePickerProps {
  archetypes: Archetype[];
  value: GenerationTarget | null;
  onChange: (target: GenerationTarget | null) => void;
  /** Offer an explicit "Channel voice" (no archetype) option. */
  allowNone?: boolean;
  disabled?: boolean;
  /** Trained-voice surface (WAVE-D-PLAN §2c). When set, a "Trained voices" tab appears. */
  trainedSlot?: ReactNode;
}

function initialTab(value: GenerationTarget | null, hasTrained: boolean): PickerTab {
  if (value?.mode === "crossover") return "crossover";
  if (value?.mode === "train_on_my_channel" && hasTrained) return "trained";
  return "single";
}

export function ArchetypePicker({
  archetypes,
  value,
  onChange,
  allowNone = false,
  disabled = false,
  trainedSlot,
}: ArchetypePickerProps) {
  const [tab, setTab] = useState<PickerTab>(initialTab(value, trainedSlot != null));
  const [slotA, setSlotA] = useState<ArchetypeId | null>(value?.crossover?.a ?? null);
  const [slotB, setSlotB] = useState<ArchetypeId | null>(value?.crossover?.b ?? null);
  const [weightA, setWeightA] = useState<number>(value?.crossover?.weightA ?? DEFAULT_WEIGHT_A);

  const sorted = useMemo(() => [...archetypes].sort((a, b) => a.sort - b.sort), [archetypes]);
  const byId = useMemo(() => new Map(sorted.map((a) => [a.id, a])), [sorted]);

  const tabs: TabDef<PickerTab>[] = [
    { id: "single", label: "Single style" },
    { id: "crossover", label: "Crossover" },
    ...(trainedSlot != null ? [{ id: "trained" as const, label: "Trained voices" }] : []),
    ...(PARTNERED_UI ? [{ id: "partnered" as const, label: "Partnered" }] : []),
  ];

  const emitCrossover = (a: ArchetypeId | null, b: ArchetypeId | null, w: number) => {
    if (a !== null && b !== null && a !== b) {
      onChange(crossoverTarget({ a, b, weightA: w }));
    }
  };

  const toggleCrossoverPick = (id: ArchetypeId) => {
    if (slotA === id) {
      // Deselect A; B (if any) becomes the new A.
      setSlotA(slotB);
      setSlotB(null);
      return;
    }
    if (slotB === id) {
      setSlotB(null);
      return;
    }
    if (slotA === null) {
      setSlotA(id);
      emitCrossover(id, slotB, weightA);
      return;
    }
    // Fill (or replace) B.
    setSlotB(id);
    emitCrossover(slotA, id, weightA);
  };

  const a = slotA !== null ? (byId.get(slotA) ?? null) : null;
  const b = slotB !== null ? (byId.get(slotB) ?? null) : null;
  const summary = a !== null && b !== null ? blendSummary(a, b, weightA) : null;

  return (
    <div>
      <Tabs tabs={tabs} active={tab} onChange={setTab} className="mb-3" />

      {tab === "single" ? (
        <div
          role="radiogroup"
          aria-label="Pick a style"
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          {allowNone ? (
            <button
              type="button"
              role="radio"
              aria-checked={value === null}
              disabled={disabled}
              onClick={() => {
                onChange(null);
              }}
              className={`flex h-full cursor-pointer flex-col rounded-lg border border-dashed p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                value === null
                  ? "border-emerald-600 bg-emerald-50/60 ring-1 ring-emerald-600 dark:border-emerald-500 dark:bg-emerald-950/40 dark:ring-emerald-500"
                  : "border-zinc-300 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-500"
              }`}
            >
              <span className="text-sm font-semibold">Channel voice</span>
              <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                No archetype — the script engine leans on your channel&rsquo;s own voice profile and
                frame settings, the way it worked before styles.
              </p>
            </button>
          ) : null}
          {sorted.map((archetype) => (
            <ArchetypeCard
              key={archetype.id}
              archetype={archetype}
              disabled={disabled}
              selected={value?.mode === "archetype" && value.archetypeId === archetype.id}
              onSelect={() => {
                onChange(archetypeTarget(archetype.id));
              }}
            />
          ))}
        </div>
      ) : null}

      {tab === "crossover" ? (
        <div className="space-y-4">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Pick two styles to blend. The first pick is the base (A), the second is the accent (B);
            drag the slider to weight them.
          </p>
          <div
            role="radiogroup"
            aria-label="Pick two styles to blend"
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            {sorted.map((archetype) => {
              const slot = slotA === archetype.id ? "A" : slotB === archetype.id ? "B" : undefined;
              return (
                <ArchetypeCard
                  key={archetype.id}
                  archetype={archetype}
                  disabled={disabled}
                  selected={slot !== undefined}
                  slot={slot}
                  onSelect={() => {
                    toggleCrossoverPick(archetype.id);
                  }}
                />
              );
            })}
          </div>

          {a !== null && b !== null && summary !== null ? (
            <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">Blend: {summary.label}</p>
                <EnergyMeter energy={summary.energy} />
              </div>
              <div className="mt-3">
                <label
                  htmlFor="crossover-weight"
                  className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400"
                >
                  Weight — {Math.round(weightA * 100)}% {a.displayName}
                </label>
                <input
                  id="crossover-weight"
                  type="range"
                  min={5}
                  max={95}
                  step={5}
                  disabled={disabled}
                  value={Math.round(weightA * 100)}
                  onChange={(e) => {
                    const w = Number(e.target.value) / 100;
                    setWeightA(w);
                    emitCrossover(slotA, slotB, w);
                  }}
                  className="w-full accent-emerald-600"
                  aria-valuetext={`${Math.round(weightA * 100)}% ${a.displayName}, ${
                    100 - Math.round(weightA * 100)
                  }% ${b.displayName}`}
                />
                <div className="flex justify-between text-[11px] text-zinc-500 dark:text-zinc-400">
                  <span>{a.displayName}</span>
                  <span>{b.displayName}</span>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                <Badge tone="neutral" title={`${summary.wpmTarget} words/min blended target`}>
                  {paceLabel(summary.wpmTarget)} pace · {summary.wpmTarget} wpm
                </Badge>
                <Badge tone="neutral">~{summary.sectionSeconds}s sections</Badge>
                <Badge tone="neutral">re-hook every ~{summary.rehookSeconds}s</Badge>
                {summary.hookTechniques.map((t) => (
                  <Badge key={t} tone="blue">
                    {HOOK_STYLE_LABELS[t]}
                  </Badge>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                Preview only — the server&rsquo;s deterministic style merge is what generation
                actually uses.
              </p>
            </div>
          ) : (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {a === null ? "Pick the base style (A)." : "Now pick the accent style (B)."}
            </p>
          )}
        </div>
      ) : null}

      {tab === "trained" && trainedSlot != null ? <div>{trainedSlot}</div> : null}

      {tab === "partnered" && PARTNERED_UI ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          Partnered creator voices require a signed license on file. The partner catalog is not
          available on this deployment yet.
        </div>
      ) : null}
    </div>
  );
}
