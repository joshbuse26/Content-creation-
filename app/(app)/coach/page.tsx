"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback } from "react";
import { ChatPanel } from "@/components/chat/chat-panel";
import { COACH_PROMPT_PARAM } from "@/components/chat/coach-launch";

/**
 * Workspace-level coach — a chat not scoped to any one project. The thread
 * list lives in the shell's left rail (one ChatThreadsProvider, mounted by
 * AppShell), so this page is the conversation alone, full height.
 */
export default function CoachPage() {
  // Suspense boundary: the launch prompt is read from useSearchParams.
  return (
    <Suspense>
      <CoachSurface />
    </Suspense>
  );
}

function CoachSurface() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const launchPrompt = params.get(COACH_PROMPT_PARAM);
  // Drop the prompt from the URL once it has opened its conversation, so a
  // refresh or back-navigation doesn't open another one.
  const onLaunchConsumed = useCallback(() => {
    router.replace(pathname);
  }, [router, pathname]);
  return (
    <ChatPanel
      projectId={null}
      threadRail="shell"
      launchPrompt={launchPrompt !== null && launchPrompt.trim() !== "" ? launchPrompt : null}
      onLaunchConsumed={onLaunchConsumed}
    />
  );
}
