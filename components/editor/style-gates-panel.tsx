"use client";

import type { ReactNode } from "react";
import type { StyleGateReport } from "@/lib/types/pipeline";
import { IconCheck, IconWarning } from "@/components/ui/icons";

/**
 * Style-gate report (wave C2) — rendered next to the classic quality gate.
 *
 * Contract discipline (PRODUCT-CONTRACTS §6 / C0 handoff): a NULL sub-field
 * (hookPatternOk, readingLevelOk before C1 lands) renders as "Not
 * evaluated" — NEVER as a pass. Banned-claim hits are the hard fail and
 * render prominently with the flagged text.
 */

type GateVerdict = boolean | null;

function VerdictBadge({ verdict }: { verdict: GateVerdict }) {
  if (verdict === null) {
    return (
      <span className="inline-flex items-center rounded-full bg-zinc-200/70 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
        Not evaluated
      </span>
    );
  }
  return verdict ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
      <IconCheck size={11} /> Pass
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-800 dark:bg-red-950 dark:text-red-300">
      <IconWarning size={11} /> Fail
    </span>
  );
}

function GateRow({
  label,
  verdict,
  detail,
}: {
  label: string;
  verdict: GateVerdict;
  detail?: ReactNode;
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <span className="text-sm">{label}</span>
        {detail !== undefined ? (
          <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">{detail}</span>
        ) : null}
      </div>
      <VerdictBadge verdict={verdict} />
    </li>
  );
}

export function StyleGatesPanel({ report }: { report: StyleGateReport }) {
  return (
    <section
      aria-label="Style gates"
      className="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <p className="text-sm font-medium">Style gates</p>
      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
        Machine checks against this script&rsquo;s style card.
      </p>
      <ul className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800">
        <GateRow label="Hook pattern" verdict={report.hookPatternOk} />
        <GateRow
          label="CTA placement"
          verdict={report.ctaPlacementOk}
          detail={`${report.ctaCount} CTA${report.ctaCount === 1 ? "" : "s"}`}
        />
        <GateRow
          label="Reading level"
          verdict={report.readingLevelOk}
          detail={
            report.readingGrade !== null ? `grade ${report.readingGrade.toFixed(1)}` : undefined
          }
        />
        <GateRow
          label="Banned claims"
          verdict={report.bannedClaimsOk}
          detail={
            report.bannedClaimHits.length > 0
              ? `${report.bannedClaimHits.length} flagged`
              : undefined
          }
        />
      </ul>

      {report.bannedClaimHits.length > 0 ? (
        <div
          role="alert"
          className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950"
        >
          <p className="flex items-center gap-1.5 text-sm font-semibold text-red-800 dark:text-red-300">
            <IconWarning size={14} /> Banned claims found — this style must never make them
          </p>
          <ul className="mt-2 space-y-2">
            {report.bannedClaimHits.map((hit, i) => (
              <li key={`${hit.claimType}-${i}`} className="text-sm text-red-800 dark:text-red-300">
                <span className="rounded bg-red-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold dark:bg-red-900/60">
                  {hit.claimType.replace(/_/g, " ")}
                </span>
                {hit.sectionHeading !== "" ? (
                  <span className="ml-1.5 text-xs text-red-700 dark:text-red-400">
                    in “{hit.sectionHeading}”
                  </span>
                ) : null}
                <blockquote className="mt-1 border-l-2 border-red-400 pl-2 text-xs italic dark:border-red-700">
                  {hit.excerpt}
                </blockquote>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {report.notes.length > 0 ? (
        <ul className="mt-2 list-disc pl-5 text-xs text-zinc-500 dark:text-zinc-400">
          {report.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
