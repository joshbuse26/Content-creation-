"use client";

import { useState } from "react";
import type { Channel } from "@/lib/types/entities";
import type { WorkspaceId } from "@/lib/types/ids";
import { trpc } from "@/components/providers/trpc";
import { useWorkspace } from "@/components/providers/workspace-context";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, TextInput } from "@/components/ui/field";
import { IconChannel, IconGoogle, IconLock } from "@/components/ui/icons";

/**
 * Channel connect. The PRIMARY, default way to connect is pasting a public
 * @handle or URL (public metadata — works for anyone, no sign-in). Verifying
 * ownership over Google OAuth is a SECONDARY option, only useful for training
 * on your own channel, and is hidden behind a friendly not-configured
 * empty-state when the deployment has no Google OAuth credentials — the user
 * must never be dropped onto the raw JSON error the start route returns.
 */

/**
 * Whether ownership verification (Google OAuth) is available in this build.
 * Gated on a public build flag the operator sets ALONGSIDE GOOGLE_CLIENT_ID;
 * unset (the playtest default) means "not configured", so we show the friendly
 * empty-state instead of linking to a route that would answer with JSON.
 * Read at call time so it stays test-controllable.
 */
export function isGoogleOauthConfigured(): boolean {
  const flag = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED;
  return flag === "1" || flag === "true";
}

/**
 * Secondary "verify ownership" affordance. Presentational + config-aware so it
 * can be unit-tested without the workspace/trpc providers. When not configured
 * it renders a friendly inline note; when configured it starts the OAuth flow,
 * degrading to the same friendly note if the start route reports it is not set
 * up (defense-in-depth against a flag/secret mismatch) rather than navigating
 * to a JSON error page.
 */
export function OwnershipVerifyCard({
  configured,
  workspaceId,
}: {
  configured: boolean;
  workspaceId: WorkspaceId | null;
}) {
  const [unavailable, setUnavailable] = useState(false);
  const startHref =
    workspaceId !== null
      ? `/api/channels/oauth/start?workspaceId=${encodeURIComponent(workspaceId)}`
      : null;

  const notConfigured = !configured || unavailable;

  return (
    <Card>
      <CardHeader
        title="Verify ownership"
        subtitle="Optional — for training a voice on a channel you own."
      />
      <CardBody>
        {notConfigured ? (
          <div className="flex items-start gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
            <IconLock size={15} className="mt-0.5 shrink-0 text-zinc-400" />
            <span>
              Ownership verification isn&rsquo;t set up yet — connect a public channel above to get
              started.
            </span>
          </div>
        ) : (
          <button
            type="button"
            disabled={startHref === null}
            onClick={() => {
              if (startHref === null) return;
              // Probe first so a not-configured server surfaces inline instead
              // of navigating the user to a JSON error page.
              void (async () => {
                try {
                  const res = await fetch(startHref, { redirect: "manual" });
                  const isRedirect =
                    res.type === "opaqueredirect" ||
                    res.status === 0 ||
                    (res.status >= 300 && res.status < 400);
                  if (isRedirect || res.ok) {
                    window.location.assign(startHref);
                    return;
                  }
                } catch {
                  // fall through to the friendly inline state
                }
                setUnavailable(true);
              })();
            }}
            className="flex h-9 w-full items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white text-sm font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
          >
            <IconGoogle size={15} />
            Verify with Google
          </button>
        )}
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          We request the <code>youtube.readonly</code> scope only — read-only access that unlocks
          captions and full stats for training.
        </p>
      </CardBody>
    </Card>
  );
}

/**
 * Demo-channel CTA. The fastest path for someone who has no channel of their
 * own (or is just kicking the tires): one click seeds a rich, ready-made demo
 * channel — with an audience avatar, niche outliers, and sample videos — so the
 * whole product (Discovery, voice training, generation) can be explored right
 * away. It is clearly labeled as demo data and needs no sign-in or keys.
 */
export function DemoChannelCard({
  workspaceId,
  onConnected,
}: {
  workspaceId: WorkspaceId | null;
  onConnected?: (channel: Channel) => void;
}) {
  const { selectChannel } = useWorkspace();
  const utils = trpc.useUtils();
  const noWorkspace = workspaceId === null;

  const demoMutation = trpc.channel.connectDemo.useMutation({
    onSuccess: (channel) => {
      if (workspaceId !== null) void utils.channel.list.invalidate({ workspaceId });
      selectChannel(channel.id);
      if (onConnected !== undefined) onConnected(channel);
    },
  });

  return (
    <Card>
      <CardHeader
        title="No channel yet? Try a demo channel"
        subtitle="One click loads a ready-made sample channel — audience, outliers, and videos — so you can explore everything without connecting your own."
      />
      <CardBody>
        <Button
          type="button"
          variant="primary"
          disabled={noWorkspace}
          busy={demoMutation.isPending}
          onClick={() => {
            if (workspaceId === null) return;
            demoMutation.mutate({ workspaceId });
          }}
        >
          <IconChannel size={14} /> Use a demo channel
        </Button>
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          Sample data for exploring the product — you can connect your real channel above any time.
        </p>
        {demoMutation.isError ? (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">
            Could not load the demo channel — please try again.
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

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
    <div className="space-y-4">
      {noWorkspace ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          No workspace selected — create or pick a workspace first, then connect a channel.
        </p>
      ) : null}

      {/* Playtest fast-path: try everything with a seeded demo channel. */}
      <DemoChannelCard workspaceId={workspaceId} onConnected={onConnected} />

      {/* PRIMARY: paste a public @handle or URL. Works for any channel. */}
      <Card>
        <CardHeader
          title="Connect a channel"
          subtitle="Paste a channel URL or @handle — the fastest way to get started. Works for any public channel."
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

      {/* SECONDARY: verify ownership of your own channel (optional). */}
      <OwnershipVerifyCard configured={isGoogleOauthConfigured()} workspaceId={workspaceId} />
    </div>
  );
}
