"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { ChannelId } from "@/lib/types/ids";
import { trpc } from "@/components/providers/trpc";
import { useWorkspace } from "@/components/providers/workspace-context";
import { AvatarReview } from "@/components/avatar/avatar-review";
import { ConnectChannel } from "@/components/channels/connect-channel";
import { Wordmark } from "@/components/marketing/site-chrome";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { IconCheck } from "@/components/ui/icons";

type Step = "workspace" | "channel" | "avatar";
const STEPS: { id: Step; label: string }[] = [
  { id: "workspace", label: "Workspace" },
  { id: "channel", label: "Connect channel" },
  { id: "avatar", label: "Review avatar" },
];

export function OnboardingFlow() {
  const router = useRouter();
  const search = useSearchParams();
  const { selectWorkspace, channelId } = useWorkspace();

  const initialStep: Step = search.get("step") === "channel" ? "channel" : "workspace";
  const [step, setStep] = useState<Step>(initialStep);
  const [wsName, setWsName] = useState("");
  const [connectedChannelId, setConnectedChannelId] = useState<ChannelId | null>(null);

  const createWs = trpc.workspace.create.useMutation({
    onSuccess: (ws) => {
      selectWorkspace(ws.id);
      setStep("channel");
    },
  });

  const avatarChannelId = connectedChannelId ?? channelId;
  const stepIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <Link href="/projects" className="text-base">
          <Wordmark />
        </Link>
        <ol className="flex items-center gap-4">
          {STEPS.map((s, i) => (
            <li key={s.id} className="flex items-center gap-1.5 text-xs font-medium">
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                  i < stepIndex
                    ? "bg-emerald-600 text-white"
                    : i === stepIndex
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                }`}
              >
                {i < stepIndex ? <IconCheck size={10} /> : i + 1}
              </span>
              <span className={i === stepIndex ? "" : "text-zinc-400 dark:text-zinc-500"}>
                {s.label}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {step === "workspace" ? (
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Name your workspace</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            A workspace holds your channels, projects, and team. You can invite people later.
          </p>
          <form
            className="mt-6 flex max-w-md items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (wsName.trim() === "") return;
              createWs.mutate({ name: wsName.trim() });
            }}
          >
            <div className="flex-1">
              <Field label="Workspace name" htmlFor="ob-ws">
                <TextInput
                  id="ob-ws"
                  autoFocus
                  placeholder="e.g. Deep Dive Media"
                  value={wsName}
                  onChange={(e) => {
                    setWsName(e.target.value);
                  }}
                />
              </Field>
            </div>
            <Button type="submit" variant="primary" busy={createWs.isPending}>
              Continue
            </Button>
          </form>
          {createWs.isError ? (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">
              Could not create the workspace — try again.
            </p>
          ) : null}
          <button
            type="button"
            className="mt-6 cursor-pointer text-sm text-zinc-500 hover:underline dark:text-zinc-400"
            onClick={() => {
              setStep("channel");
            }}
          >
            I already have a workspace — skip
          </button>
        </div>
      ) : null}

      {step === "channel" ? (
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Connect your channel</h1>
          <p className="mt-1 mb-6 text-sm text-zinc-500 dark:text-zinc-400">
            We analyze your catalog to build your audience avatar and voice profile.
          </p>
          <ConnectChannel
            onConnected={(channel) => {
              setConnectedChannelId(channel.id);
              setStep("avatar");
            }}
          />
          <button
            type="button"
            className="mt-6 cursor-pointer text-sm text-zinc-500 hover:underline dark:text-zinc-400"
            onClick={() => {
              setStep("avatar");
            }}
          >
            Skip for now
          </button>
        </div>
      ) : null}

      {step === "avatar" ? (
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Meet your audience</h1>
          <p className="mt-1 mb-6 text-sm text-zinc-500 dark:text-zinc-400">
            This avatar steers every script. Fix anything that reads wrong — your edits always win
            over regeneration.
          </p>
          {avatarChannelId !== null ? (
            <AvatarReview channelId={avatarChannelId} />
          ) : (
            <p className="rounded-md border border-dashed border-zinc-300 p-6 text-sm text-zinc-500 dark:border-zinc-700">
              No channel connected yet — connect one to generate an avatar, or finish and do it
              later from the Channels page.
            </p>
          )}
          <div className="mt-6 flex justify-end">
            <Button
              variant="primary"
              onClick={() => {
                router.push("/projects");
              }}
            >
              Finish setup
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
