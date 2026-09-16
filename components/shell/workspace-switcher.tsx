"use client";

import { useRouter } from "next/navigation";
import { Dropdown, DropdownItem } from "@/components/ui/dropdown";
import { IconPlus } from "@/components/ui/icons";
import { useWorkspace } from "@/components/providers/workspace-context";

export function WorkspaceSwitcher() {
  const { workspaces, workspace, selectWorkspace } = useWorkspace();
  const router = useRouter();

  return (
    <Dropdown
      buttonClassName="w-full justify-between border-transparent bg-zinc-100 dark:bg-zinc-800/60"
      trigger={
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-accent-700 text-[10px] font-bold text-white dark:bg-accent-600"
          >
            {(workspace?.name ?? "?").slice(0, 1).toUpperCase()}
          </span>
          <span className="truncate text-sm font-medium">
            {workspace?.name ?? "Select workspace"}
          </span>
        </span>
      }
    >
      {(close) => (
        <>
          {workspaces.map((w) => (
            <DropdownItem
              key={w.id}
              selected={w.id === workspace?.id}
              onSelect={() => {
                selectWorkspace(w.id);
                close();
              }}
            >
              <span className="truncate">{w.name}</span>
              <span className="ml-auto text-[10px] text-zinc-500 uppercase dark:text-zinc-400">
                {w.role}
              </span>
            </DropdownItem>
          ))}
          <div className="my-1 border-t border-zinc-200 dark:border-zinc-800" />
          <DropdownItem
            onSelect={() => {
              close();
              router.push("/onboarding");
            }}
          >
            <IconPlus size={13} /> New workspace
          </DropdownItem>
        </>
      )}
    </Dropdown>
  );
}
