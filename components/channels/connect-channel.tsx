"use client";

import { useState } from "react";
import type { Channel } from "@/lib/types/entities";
import { trpc } from "@/components/providers/trpc";
import { useWorkspace } from "@/components/providers/workspace-context";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, TextInput } from "@/components/ui/field";
import { IconChannel, IconGoogle } from "@/components/ui/icons";

/**
 * Channel connect: OAuth (own channel — analytics + captions) or public mode
 * (any channel by URL/handle — metadata only). The OAuth consent flow itself
 * is owned by A1; the button targets the Auth.js signin route.
 */
export function ConnectChannel({ onConnected }: { onConnected?: (channel: Channel) => void }) {
  const { workspaceId, selectChannel } = useWorkspace();
  const utils = trpc.useUtils();
  const [url, setUrl] = useState("");
  const [keywords, setKeywords] = useState("");

  const connectMutation = trpc.channel.connectPublic.useMutation({
    onSuccess: (channel) => {
      if (workspaceId !== null) void utils.channel.list.invalidate({ workspaceId });
      selectChannel(channel.id);
      if (onConnected !== undefined) onConnected(channel);
    },
  });

  const noWorkspace = workspaceId === null;

  return (
    <div>
      {noWorkspace ? (
        <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          No workspace selected — create or pick a workspace first, then connect a channel.
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader
            title="Connect with Google"
            subtitle="Your own channel — read-only access unlocks captions and full stats."
          />
          <CardBody>
            {workspaceId !== null ? (
              <a
                href={`/api/channels/oauth/start?workspaceId=${encodeURIComponent(workspaceId)}`}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
              >
                <IconGoogle size={16} />
                Connect YouTube channel
              </a>
            ) : (
              <div
                aria-disabled="true"
                className="flex h-10 w-full cursor-not-allowed items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white text-sm font-medium opacity-50 dark:border-zinc-700 dark:bg-zinc-900"
              >
                <IconGoogle size={16} />
                Connect YouTube channel
              </div>
            )}
            <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
              We request the <code>youtube.readonly</code> scope only. During alpha, Google shows an
              &ldquo;unverified app&rdquo; notice — verification is in progress.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Track a public channel"
            subtitle="Any channel by URL or handle — public metadata only."
          />
          <CardBody>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (workspaceId === null || url.trim().length < 2) return;
                connectMutation.mutate({
                  workspaceId,
                  urlOrHandle: url.trim(),
                  nicheKeywords: keywords
                    .split(",")
                    .map((k) => k.trim())
                    .filter((k) => k !== "")
                    .slice(0, 6),
                });
              }}
            >
              <Field label="Channel URL or handle" htmlFor="cc-url">
                <TextInput
                  id="cc-url"
                  placeholder="youtube.com/@yourchannel or @yourchannel"
                  value={url}
                  disabled={noWorkspace}
                  onChange={(e) => {
                    setUrl(e.target.value);
                  }}
                />
              </Field>
              <Field
                label="Niche keywords"
                htmlFor="cc-keywords"
                hint="Up to 6, comma-separated — used for research and title patterns."
              >
                <TextInput
                  id="cc-keywords"
                  placeholder="home espresso, coffee gear"
                  value={keywords}
                  disabled={noWorkspace}
                  onChange={(e) => {
                    setKeywords(e.target.value);
                  }}
                />
              </Field>
              <Button
                type="submit"
                variant="primary"
                disabled={noWorkspace}
                busy={connectMutation.isPending}
              >
                <IconChannel size={14} /> Connect channel
              </Button>
              {connectMutation.isError ? (
                <p className="text-xs text-red-600 dark:text-red-400">
                  Could not connect that channel — check the URL and try again.
                </p>
              ) : null}
            </form>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
