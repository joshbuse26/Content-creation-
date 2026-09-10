import type { ReactNode } from "react";
import { Spinner } from "./spinner";
import { IconWarning } from "./icons";

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-zinc-500 justify-center dark:text-zinc-400">
      <Spinner /> {label}
    </div>
  );
}

export function ErrorState({
  message = "Something went wrong loading this view.",
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <IconWarning size={20} className="text-red-500" />
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{message}</p>
      {onRetry !== undefined ? (
        <button
          type="button"
          onClick={() => {
            onRetry();
          }}
          className="cursor-pointer text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-zinc-300 py-12 text-center dark:border-zinc-700">
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{title}</p>
      {hint !== undefined ? (
        <p className="max-w-sm text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>
      ) : null}
      {action !== undefined ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
