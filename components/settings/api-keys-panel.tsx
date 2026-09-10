"use client";

import { useState } from "react";
import { skipToken } from "@tanstack/react-query";
import { trpc } from "@/components/providers/trpc";
import { useWorkspace } from "@/components/providers/workspace-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { IconCopy, IconPlus, IconWarning } from "@/components/ui/icons";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/state";
import { useToast } from "@/components/ui/toast";
import { fmtDateTime } from "@/components/lib/format";
import { apiKeyDisplayPrefix } from "@/server/mcp/key-format";
import { MCP_TOOL_NAMES, MCP_TOOL_SUMMARIES, type McpToolName } from "@/server/mcp/tool-names";
import type { ChannelId } from "@/lib/types/ids";

/**
 * Settings → API keys (B2) — owner-only management of MCP access keys.
 *
 * Create shows the plaintext secret exactly ONCE (it is never stored, only
 * its hash); the list renders a true display prefix derived from the row id
 * plus created / last-used / scopes; revoke is two-step confirmed.
 *
 * INTEGRATOR WIRING (A0): add `app/(app)/settings/api-keys/page.tsx`
 * rendering <ApiKeysPanel />, and an "API keys" tab in
 * `app/(app)/settings/layout.tsx` (href "/settings/api-keys").
 */

export function ApiKeysPanel() {
  const { workspaceId, workspace } = useWorkspace();
  const utils = trpc.useUtils();
  const { toast } = useToast();

  const isOwner = workspace !== null && workspace.role === "owner";

  const [modalOpen, setModalOpen] = useState(false);
  const [selectedScopes, setSelectedScopes] = useState<McpToolName[]>([...MCP_TOOL_NAMES]);
  const [selectedChannels, setSelectedChannels] = useState<ChannelId[]>([]);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmingRevokeId, setConfirmingRevokeId] = useState<string | null>(null);

  const keysQuery = trpc.apiKeys.list.useQuery(
    workspaceId !== null && isOwner ? { workspaceId } : skipToken,
  );
  const channelsQuery = trpc.channel.list.useQuery(
    workspaceId !== null && isOwner ? { workspaceId } : skipToken,
  );

  const invalidate = () => {
    if (workspaceId !== null) void utils.apiKeys.list.invalidate({ workspaceId });
  };

  const createMutation = trpc.apiKeys.create.useMutation({
    onSuccess: ({ secret }) => {
      setCreatedSecret(secret);
      setCopied(false);
      invalidate();
      toast("API key created — copy it now, it won't be shown again.", "success");
    },
    onError: () => {
      toast("Could not create the API key — nothing was saved.");
    },
  });
  const revokeMutation = trpc.apiKeys.revoke.useMutation({
    onSuccess: () => {
      invalidate();
      toast("API key revoked — it stops working immediately.", "success");
    },
    onError: () => {
      invalidate();
      toast("Could not revoke that key — it is still active.");
    },
  });

  if (workspaceId === null || workspace === null) return <LoadingState />;

  if (!isOwner) {
    return (
      <Card>
        <CardHeader title="API keys" subtitle="MCP access for agents and integrations." />
        <CardBody>
          <p className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            <IconWarning size={14} className="text-amber-500" />
            Only the workspace owner can view or manage API keys.
          </p>
        </CardBody>
      </Card>
    );
  }

  if (keysQuery.isLoading) return <LoadingState label="Loading API keys…" />;
  if (keysQuery.isError || keysQuery.data === undefined) {
    return (
      <ErrorState
        message="Couldn't load your API keys — retry in a moment."
        onRetry={() => {
          void keysQuery.refetch();
        }}
      />
    );
  }

  const keys = keysQuery.data;
  const channels = channelsQuery.data ?? [];

  const toggleScope = (scope: McpToolName) => {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  };
  const toggleChannel = (channelId: ChannelId) => {
    setSelectedChannels((prev) =>
      prev.includes(channelId) ? prev.filter((c) => c !== channelId) : [...prev, channelId],
    );
  };

  const closeModal = () => {
    setModalOpen(false);
    setCreatedSecret(null);
    setCopied(false);
    setSelectedScopes([...MCP_TOOL_NAMES]);
    setSelectedChannels([]);
  };

  const copySecret = (secret: string) => {
    void navigator.clipboard.writeText(secret).then(
      () => {
        setCopied(true);
        toast("Copied to clipboard.", "success");
      },
      () => {
        toast("Copy failed — select the key text and copy it manually.");
      },
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">API keys</h2>
          <p className="mt-1 max-w-xl text-xs text-zinc-500 dark:text-zinc-400">
            Keys authenticate MCP calls to <code className="font-mono">/api/mcp</code>. Each key is
            limited to the tools and channels you pick; generation tools spend workspace credits
            exactly like the app.
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => {
            setModalOpen(true);
          }}
        >
          <IconPlus size={13} /> New key
        </Button>
      </div>

      {keys.length === 0 ? (
        <EmptyState
          title="No API keys yet"
          hint="Create a key to let an agent (e.g. Claude Code) read stats, run research, and generate scripts over MCP."
          action={
            <Button
              variant="primary"
              onClick={() => {
                setModalOpen(true);
              }}
            >
              <IconPlus size={13} /> Create your first key
            </Button>
          }
        />
      ) : (
        <ul className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {keys.map((key) => {
            const revoked = key.revokedAt !== null;
            return (
              <li key={key.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-sm text-zinc-800 dark:text-zinc-200">
                    {apiKeyDisplayPrefix(key.id)}…{" "}
                    {revoked ? (
                      <Badge tone="red">revoked</Badge>
                    ) : (
                      <Badge tone="emerald">active</Badge>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    Created {fmtDateTime(key.createdAt)} · Last used{" "}
                    {key.lastUsedAt === null ? "never" : fmtDateTime(key.lastUsedAt)} ·{" "}
                    {key.channelIds.length === 0
                      ? "all channels"
                      : `${key.channelIds.length} channel${key.channelIds.length === 1 ? "" : "s"}`}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-1">
                    {key.scopes.map((scope) => (
                      <Badge key={scope} tone="neutral">
                        {scope}
                      </Badge>
                    ))}
                  </p>
                </div>
                {revoked ? null : confirmingRevokeId === key.id ? (
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-zinc-600 dark:text-zinc-400">
                      Revoke this key? Agents using it stop working immediately.
                    </span>
                    <Button
                      variant="danger"
                      size="sm"
                      busy={revokeMutation.isPending}
                      onClick={() => {
                        revokeMutation.mutate(
                          { workspaceId, apiKeyId: key.id },
                          {
                            onSettled: () => {
                              setConfirmingRevokeId(null);
                            },
                          },
                        );
                      }}
                    >
                      Revoke
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setConfirmingRevokeId(null);
                      }}
                    >
                      Cancel
                    </Button>
                  </span>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setConfirmingRevokeId(key.id);
                    }}
                  >
                    Revoke…
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={createdSecret === null ? "Create API key" : "API key created"}
        >
          <div className="w-full max-w-lg rounded-lg border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
            {createdSecret === null ? (
              <>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Create API key
                </h3>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Pick the tools this key may call and (optionally) the channels it is limited to.
                </p>

                <fieldset className="mt-4">
                  <legend className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Tool scopes
                  </legend>
                  <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                    {MCP_TOOL_NAMES.map((tool) => (
                      <label
                        key={tool}
                        className="flex cursor-pointer items-start gap-2 text-sm text-zinc-800 dark:text-zinc-200"
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 accent-emerald-600"
                          checked={selectedScopes.includes(tool)}
                          onChange={() => {
                            toggleScope(tool);
                          }}
                        />
                        <span>
                          <span className="font-mono text-xs">{tool}</span>
                          <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">
                            {MCP_TOOL_SUMMARIES[tool]}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <fieldset className="mt-4">
                  <legend className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Channel scope{" "}
                    <span className="font-normal">(none selected = all channels)</span>
                  </legend>
                  {channelsQuery.isLoading ? (
                    <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                      Loading channels…
                    </p>
                  ) : channels.length === 0 ? (
                    <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                      No channels connected yet — the key will cover any channel connected later.
                    </p>
                  ) : (
                    <div className="mt-2 grid gap-1.5">
                      {channels.map((channel) => (
                        <label
                          key={channel.id}
                          className="flex cursor-pointer items-center gap-2 text-sm text-zinc-800 dark:text-zinc-200"
                        >
                          <input
                            type="checkbox"
                            className="accent-emerald-600"
                            checked={selectedChannels.includes(channel.id)}
                            onChange={() => {
                              toggleChannel(channel.id);
                            }}
                          />
                          {channel.title}
                        </label>
                      ))}
                    </div>
                  )}
                </fieldset>

                {createMutation.isError ? (
                  <p className="mt-3 text-xs text-red-600 dark:text-red-400">
                    Could not create the key — check the scopes and try again.
                  </p>
                ) : null}

                <div className="mt-5 flex justify-end gap-2">
                  <Button variant="ghost" onClick={closeModal}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    busy={createMutation.isPending}
                    disabled={selectedScopes.length === 0}
                    title={selectedScopes.length === 0 ? "Pick at least one tool scope" : undefined}
                    onClick={() => {
                      createMutation.mutate({
                        workspaceId,
                        scopes: selectedScopes,
                        channelIds: selectedChannels,
                      });
                    }}
                  >
                    Create key
                  </Button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Your new API key
                </h3>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                  <IconWarning size={13} />
                  Copy it now — you won&apos;t see this key again.
                </p>
                <div className="mt-3 flex items-center gap-2 rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950">
                  <code className="min-w-0 flex-1 font-mono text-xs break-all text-zinc-800 select-all dark:text-zinc-200">
                    {createdSecret}
                  </code>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      copySecret(createdSecret);
                    }}
                  >
                    <IconCopy size={13} /> {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
                <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                  Use it as <code className="font-mono">Authorization: Bearer &lt;key&gt;</code>{" "}
                  against <code className="font-mono">/api/mcp</code>. We store only a hash; if the
                  key is lost, revoke it and create a new one.
                </p>
                <div className="mt-5 flex justify-end">
                  <Button variant="primary" onClick={closeModal}>
                    Done
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
