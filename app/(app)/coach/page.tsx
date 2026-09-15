"use client";

import { COACH_NAME } from "@/lib/branding";
import { ChatPanel } from "@/components/chat/chat-panel";
import { ChatThreadsProvider } from "@/components/chat/chat-threads-context";
import { PageHeader } from "@/components/shell/app-shell";

/** Workspace-level coach — a chat not scoped to any one project. */
export default function CoachPage() {
  return (
    <div>
      <PageHeader
        title={COACH_NAME}
        subtitle="Your channel coach — plan videos, workshop angles, and run any studio tool."
      />
      {/* One chat.listThreads query for the whole surface (F0). */}
      <ChatThreadsProvider projectId={null}>
        <ChatPanel projectId={null} />
      </ChatThreadsProvider>
    </div>
  );
}
