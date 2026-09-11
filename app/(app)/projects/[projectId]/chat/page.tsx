"use client";

import { useProjectId } from "@/components/projects/project-frame";
import { ChatPanel } from "@/components/chat/chat-panel";

/** The default project surface: a project-scoped coaching chat. */
export default function ProjectChatPage() {
  const projectId = useProjectId();
  return <ChatPanel projectId={projectId} />;
}
