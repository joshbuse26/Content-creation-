"use client";

import { useProjectId } from "@/components/projects/project-frame";
import { ChatPanel } from "@/components/chat/chat-panel";
import { ChatThreadsProvider } from "@/components/chat/chat-threads-context";

/** The default project surface: a project-scoped coaching chat. */
export default function ProjectChatPage() {
  const projectId = useProjectId();
  return (
    // One chat.listThreads query for the whole surface (F0).
    <ChatThreadsProvider projectId={projectId}>
      <ChatPanel projectId={projectId} />
    </ChatThreadsProvider>
  );
}
