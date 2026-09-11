"use client";

import { COACH_NAME } from "@/lib/branding";
import { ChatPanel } from "@/components/chat/chat-panel";
import { PageHeader } from "@/components/shell/app-shell";

/** Workspace-level coach — a chat not scoped to any one project. */
export default function CoachPage() {
  return (
    <div>
      <PageHeader
        title={COACH_NAME}
        subtitle="Your channel coach — plan videos, workshop angles, and run any studio tool."
      />
      <ChatPanel projectId={null} />
    </div>
  );
}
