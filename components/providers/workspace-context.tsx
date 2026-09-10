"use client";

import { skipToken } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Channel, Workspace } from "@/lib/types/entities";
import type { Role } from "@/lib/types/enums";
import type { ChannelId, WorkspaceId } from "@/lib/types/ids";
import { trpc } from "./trpc";

/**
 * Current workspace + channel selection, shared by every app screen.
 * Selection is persisted per-browser and validated against the live lists.
 */

const WS_KEY = "gr.currentWorkspace";
const CH_KEY = "gr.currentChannel";

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable (private mode) — selection just won't persist.
  }
}

export interface WorkspaceContextValue {
  workspaces: (Workspace & { role: Role })[];
  workspacesLoading: boolean;
  workspaceId: WorkspaceId | null;
  workspace: (Workspace & { role: Role }) | null;
  selectWorkspace: (id: WorkspaceId) => void;
  channels: Channel[];
  /** null = "all channels". */
  channelId: ChannelId | null;
  channel: Channel | null;
  selectChannel: (id: ChannelId | null) => void;
}

const Ctx = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [storedWs, setStoredWs] = useState<string | null>(null);
  const [storedCh, setStoredCh] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setStoredWs(readStored(WS_KEY));
    setStoredCh(readStored(CH_KEY));
    setHydrated(true);
  }, []);

  const workspacesQuery = trpc.workspace.list.useQuery(undefined, { enabled: hydrated });
  const workspaces = useMemo(() => workspacesQuery.data ?? [], [workspacesQuery.data]);

  // A stored selection that is missing from a fresh list is NOT silently
  // replaced by workspaces[0] — that would route writes (e.g. channel
  // connects) to the wrong workspace. Instead: refetch once (the workspace
  // may have just been created), and only if it is still missing clear the
  // stale selection explicitly.
  const storedWsMissing =
    hydrated &&
    workspacesQuery.isSuccess &&
    storedWs !== null &&
    !workspaces.some((w) => (w.id as string) === storedWs);
  const missingRetriedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!storedWsMissing || workspacesQuery.isFetching) return;
    if (missingRetriedForRef.current !== storedWs) {
      missingRetriedForRef.current = storedWs;
      void workspacesQuery.refetch();
      return;
    }
    // Refetched and still missing — the stored selection is stale; clear it.
    setStoredWs(null);
    writeStored(WS_KEY, null);
  }, [storedWsMissing, storedWs, workspacesQuery]);

  const workspace = useMemo(() => {
    if (workspaces.length === 0) return null;
    if (storedWs !== null) {
      // While the stored workspace is unresolved, expose no workspace (the
      // effect above refetches once, then clears the stale key).
      return workspaces.find((w) => (w.id as string) === storedWs) ?? null;
    }
    return workspaces[0] ?? null;
  }, [workspaces, storedWs]);
  const workspaceId = workspace?.id ?? null;

  const channelsQuery = trpc.channel.list.useQuery(
    workspaceId !== null ? { workspaceId } : skipToken,
  );
  const channels = useMemo(() => channelsQuery.data ?? [], [channelsQuery.data]);

  const channel = useMemo(() => {
    if (storedCh === null) return null;
    return channels.find((c) => (c.id as string) === storedCh) ?? null;
  }, [channels, storedCh]);

  const value: WorkspaceContextValue = useMemo(
    () => ({
      workspaces,
      workspacesLoading: !hydrated || workspacesQuery.isLoading || storedWsMissing,
      workspaceId,
      workspace,
      selectWorkspace: (id) => {
        missingRetriedForRef.current = null;
        setStoredWs(id);
        writeStored(WS_KEY, id);
        setStoredCh(null);
        writeStored(CH_KEY, null);
      },
      channels,
      channelId: channel?.id ?? null,
      channel,
      selectChannel: (id) => {
        setStoredCh(id);
        writeStored(CH_KEY, id);
      },
    }),
    [
      workspaces,
      hydrated,
      workspacesQuery.isLoading,
      storedWsMissing,
      workspaceId,
      workspace,
      channels,
      channel,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(Ctx);
  if (ctx === null) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return ctx;
}

/** For screens that require a selected workspace; render nothing until ready. */
export function useRequiredWorkspaceId(): WorkspaceId | null {
  return useWorkspace().workspaceId;
}
