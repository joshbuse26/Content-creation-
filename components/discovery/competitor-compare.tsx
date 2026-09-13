"use client";

import { useState } from "react";
import type { CompetitorTheme } from "@/lib/types/entities";
import type { ChannelId, WorkspaceId } from "@/lib/types/ids";
import { trpc } from "@/components/providers/trpc";
import { useWorkspace } from "@/components/providers/workspace-context";
import { Button } from "@/components/ui/button";
import { IconSparkle } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { isUiCreditExempt } from "@/components/lib/credits-ui";

/**
 * Competitor compare (Wave-D E3). Paste 1-3 competitor channel handles/URLs;
 * we pull their top outliers and surface the SHARED patterns as ORIGINAL
 * concepts added to your feed. Costs 1 credit (idempotent on the same
 * competitors). Never clones a creator — only the abstract format/topic
 * pattern travels over.
 */
export function CompetitorCompare({
  workspaceId,
  channelId,
  onDone,
}: {
  workspaceId: WorkspaceId;
  channelId: ChannelId;
  onDone: () => void;
}) {
  const { workspace } = useWorkspace();
  const exempt = isUiCreditExempt(workspace?.role);
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState("");
  const [themes, setThemes] = useState<CompetitorTheme[] | null>(null);

  const handles = parseHandles(raw);

  const mutation = trpc.ideas.competitorCompare.useMutation({
    onSuccess: (result) => {
      setThemes(result.themes);
      if (result.ideas.length > 0) {
        toast(
          `Added ${result.ideas.length} original concept${result.ideas.length === 1 ? "" : "s"} to your feed.`,
          "success",
        );
      } else if (result.themes.length === 0) {
        toast("No shared pattern across those channels yet — try different competitors.");
      } else {
        toast("Those patterns are already in your feed.", "success");
      }
      onDone();
    },
    onError: (err) => {
      toast(
        err.data?.code === "PRECONDITION_FAILED"
          ? err.message
          : "Couldn't compare those channels — check the handles and try again.",
      );
    },
  });

  return (
    <section
      aria-label="Compare competitor channels"
      className="mt-8 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Compare competitor channels
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            Find the patterns 1–3 competitors are winning with — turned into original concepts for
            your channel.
          </p>
        </div>
        {!open ? (
          <Button
            size="sm"
            onClick={() => {
              setOpen(true);
            }}
          >
            Compare
          </Button>
        ) : null}
      </div>

      {open ? (
        <div className="mt-3">
          <label htmlFor="competitor-handles" className="sr-only">
            Competitor channel handles or URLs
          </label>
          <textarea
            id="competitor-handles"
            rows={2}
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value);
            }}
            placeholder="@channelone, @channeltwo, youtube.com/@three"
            className="w-full resize-none rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
          />
          <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            {handles.length === 0
              ? "Enter 1–3 channels, separated by commas."
              : `${handles.length} channel${handles.length === 1 ? "" : "s"} · ${exempt ? "included" : "1 credit"}`}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              busy={mutation.isPending}
              disabled={handles.length === 0 || handles.length > 3}
              onClick={() => {
                mutation.mutate({ workspaceId, channelId, channelHandles: handles });
              }}
            >
              <IconSparkle size={12} /> Find shared patterns
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={mutation.isPending}
              onClick={() => {
                setOpen(false);
                setThemes(null);
              }}
            >
              Cancel
            </Button>
          </div>

          {themes !== null && themes.length > 0 ? (
            <ul aria-label="Shared competitor patterns" className="mt-3 space-y-1.5">
              {themes.map((t) => (
                <li
                  key={t.formatTag}
                  className="flex items-center justify-between gap-2 rounded-md bg-zinc-50 px-3 py-1.5 text-xs dark:bg-zinc-800/60"
                >
                  <span className="text-zinc-700 dark:text-zinc-300">{t.theme}</span>
                  <span className="shrink-0 text-zinc-500 dark:text-zinc-400">
                    {t.sharedByChannels} channel{t.sharedByChannels === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** Parse up to 3 distinct handles from comma/space/newline separated input. */
export function parseHandles(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of raw.split(/[,\n]+/)) {
    const h = token.trim();
    if (h.length < 2) continue;
    const key = h.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
    if (out.length >= 3) break;
  }
  return out;
}
