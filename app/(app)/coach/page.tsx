"use client";

import { ChatPanel } from "@/components/chat/chat-panel";

/**
 * Workspace-level coach — a chat not scoped to any one project. The thread
 * list lives in the shell's left rail (one ChatThreadsProvider, mounted by
 * AppShell), so this page is the conversation alone, full height.
 */
export default function CoachPage() {
  return <ChatPanel projectId={null} threadRail="shell" />;
}
