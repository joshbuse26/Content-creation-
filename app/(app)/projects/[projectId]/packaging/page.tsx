"use client";

import { useState } from "react";
import { Tabs } from "@/components/ui/tabs";
import { TitlesPanel } from "@/components/packaging/titles-panel";
import { DescriptionsPanel } from "@/components/packaging/descriptions-panel";
import { TagsPanel } from "@/components/packaging/tags-panel";
import { ChaptersPanel } from "@/components/packaging/chapters-panel";
import { ThumbsPanel } from "@/components/packaging/thumbs-panel";

type PackTab = "titles" | "description" | "tags" | "chapters" | "thumbnail";

export default function PackagingPage() {
  const [tab, setTab] = useState<PackTab>("titles");
  return (
    <div className="space-y-5">
      <Tabs
        tabs={[
          { id: "titles" as const, label: "Titles" },
          { id: "description" as const, label: "Description" },
          { id: "tags" as const, label: "Tags" },
          { id: "chapters" as const, label: "Chapters" },
          { id: "thumbnail" as const, label: "Thumbnail" },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "titles" ? <TitlesPanel /> : null}
      {tab === "description" ? <DescriptionsPanel /> : null}
      {tab === "tags" ? <TagsPanel /> : null}
      {tab === "chapters" ? <ChaptersPanel /> : null}
      {tab === "thumbnail" ? <ThumbsPanel /> : null}
    </div>
  );
}
