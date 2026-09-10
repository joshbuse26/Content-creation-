"use client";

import { useRouter } from "next/navigation";
import { Dropdown, DropdownItem } from "@/components/ui/dropdown";
import { IconChannel, IconPlus } from "@/components/ui/icons";
import { useWorkspace } from "@/components/providers/workspace-context";

export function ChannelSwitcher() {
  const { channels, channel, selectChannel } = useWorkspace();
  const router = useRouter();

  return (
    <Dropdown
      buttonClassName="w-full justify-between border-transparent"
      trigger={
        <span className="flex min-w-0 items-center gap-2">
          <IconChannel size={14} className="shrink-0 text-zinc-400" />
          <span className="truncate text-sm">{channel?.title ?? "All channels"}</span>
        </span>
      }
    >
      {(close) => (
        <>
          <DropdownItem
            selected={channel === null}
            onSelect={() => {
              selectChannel(null);
              close();
            }}
          >
            All channels
          </DropdownItem>
          {channels.map((c) => (
            <DropdownItem
              key={c.id}
              selected={c.id === channel?.id}
              onSelect={() => {
                selectChannel(c.id);
                close();
              }}
            >
              <span className="truncate">{c.title}</span>
              {c.handle !== null ? (
                <span className="ml-auto truncate text-[10px] text-zinc-500 dark:text-zinc-400">
                  {c.handle}
                </span>
              ) : null}
            </DropdownItem>
          ))}
          <div className="my-1 border-t border-zinc-200 dark:border-zinc-800" />
          <DropdownItem
            onSelect={() => {
              close();
              router.push("/onboarding?step=channel");
            }}
          >
            <IconPlus size={13} /> Connect channel
          </DropdownItem>
        </>
      )}
    </Dropdown>
  );
}
