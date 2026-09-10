"use client";

import { useState } from "react";
import { skipToken } from "@tanstack/react-query";
import { ROLES, type Role } from "@/lib/types/enums";
import { trpc } from "@/components/providers/trpc";
import { useWorkspace } from "@/components/providers/workspace-context";
import { Button, IconButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, TextInput, Label } from "@/components/ui/field";
import { IconPlus, IconTrash } from "@/components/ui/icons";
import { ErrorState, LoadingState } from "@/components/ui/state";

const roleHelp: Record<Role, string> = {
  owner: "billing + everything",
  admin: "channels, members, templates",
  writer: "create + edit content",
  viewer: "read-only",
};

export function MembersPanel() {
  const { workspaceId, workspace } = useWorkspace();
  const utils = trpc.useUtils();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("writer");

  const membersQuery = trpc.workspace.members.useQuery(
    workspaceId !== null ? { workspaceId } : skipToken,
  );
  const invalidate = () => {
    if (workspaceId !== null) void utils.workspace.members.invalidate({ workspaceId });
  };
  const inviteMutation = trpc.workspace.invite.useMutation({
    onSuccess: () => {
      setEmail("");
      invalidate();
    },
  });
  const setRoleMutation = trpc.workspace.setRole.useMutation({ onSuccess: invalidate });
  const removeMutation = trpc.workspace.removeMember.useMutation({ onSuccess: invalidate });

  if (workspaceId === null || membersQuery.isLoading) return <LoadingState />;
  if (membersQuery.isError) {
    return (
      <ErrorState
        onRetry={() => {
          void membersQuery.refetch();
        }}
      />
    );
  }

  const members = membersQuery.data ?? [];
  const canManage = workspace !== null && (workspace.role === "owner" || workspace.role === "admin");

  return (
    <div className="space-y-6">
      <ul className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        {members.map((m) => (
          <li key={m.id} className="flex items-center gap-3 px-4 py-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-200 text-xs font-bold text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
              {(m.user.name ?? m.user.email).slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{m.user.name ?? m.user.email}</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{m.user.email}</p>
            </div>
            {canManage && m.role !== "owner" ? (
              <Select
                aria-label={`Role for ${m.user.email}`}
                className="w-28"
                value={m.role}
                onChange={(e) => {
                  setRoleMutation.mutate({
                    workspaceId,
                    userId: m.userId,
                    role: e.target.value as Role,
                  });
                }}
              >
                {ROLES.filter((r) => r !== "owner").map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            ) : (
              <Badge tone={m.role === "owner" ? "emerald" : "neutral"} title={roleHelp[m.role]}>
                {m.role}
              </Badge>
            )}
            {canManage && m.role !== "owner" ? (
              <IconButton
                label="Remove member"
                onClick={() => {
                  removeMutation.mutate({ workspaceId, userId: m.userId });
                }}
              >
                <IconTrash size={13} />
              </IconButton>
            ) : null}
          </li>
        ))}
      </ul>

      {canManage ? (
        <form
          className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
          onSubmit={(e) => {
            e.preventDefault();
            if (email.trim() === "") return;
            inviteMutation.mutate({ workspaceId, email: email.trim(), role });
          }}
        >
          <div className="min-w-56 flex-1">
            <Label htmlFor="inv-email">Invite by email</Label>
            <TextInput
              id="inv-email"
              type="email"
              placeholder="teammate@studio.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
            />
          </div>
          <div>
            <Label htmlFor="inv-role">Role</Label>
            <Select
              id="inv-role"
              value={role}
              onChange={(e) => {
                setRole(e.target.value as Role);
              }}
            >
              {ROLES.filter((r) => r !== "owner").map((r) => (
                <option key={r} value={r}>
                  {r} — {roleHelp[r]}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="primary" busy={inviteMutation.isPending}>
            <IconPlus size={13} /> Invite
          </Button>
          {inviteMutation.isError ? (
            <p className="w-full text-xs text-red-600 dark:text-red-400">Invite failed.</p>
          ) : null}
          {inviteMutation.isSuccess ? (
            <p className="w-full text-xs text-emerald-700 dark:text-emerald-400">Invitation sent.</p>
          ) : null}
        </form>
      ) : (
        <p className="text-xs text-zinc-400">Admins and owners manage members.</p>
      )}
    </div>
  );
}
