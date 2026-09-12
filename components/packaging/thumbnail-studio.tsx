"use client";

import { useState } from "react";
import { Tabs } from "@/components/ui/tabs";
import { ThumbsPanel } from "@/components/packaging/thumbs-panel";
import { ThumbnailBoard } from "@/components/packaging/thumbnail-board";

type StudioMode = "whiteboard" | "one_shot";

/**
 * Thumbnail surface (WAVE-D / E2). Additive wrapper: the Whiteboard Studio
 * (compare a board of concepts, tweak, favorite, pick a winner) is the
 * default, with the original one-shot generator kept a click away so nothing
 * regresses for power users who just want three quick candidates.
 */
export function ThumbnailStudio() {
  const [mode, setMode] = useState<StudioMode>("whiteboard");
  return (
    <div className="space-y-4">
      <Tabs
        tabs={[
          { id: "whiteboard" as const, label: "Whiteboard" },
          { id: "one_shot" as const, label: "Quick 3" },
        ]}
        active={mode}
        onChange={setMode}
      />
      {mode === "whiteboard" ? <ThumbnailBoard /> : <ThumbsPanel />}
    </div>
  );
}
