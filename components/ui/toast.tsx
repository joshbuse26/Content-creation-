"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { IconWarning, IconX } from "./icons";

/**
 * Minimal toast system (no deps): ToastProvider renders a fixed stack in the
 * corner; useToast().toast("message") queues one. Used to surface mutation
 * failures that would otherwise be silent — pair with a state rollback where
 * the UI updated optimistically.
 */

export type ToastTone = "error" | "success" | "info";

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  toast: (message: string, tone?: ToastTone) => void;
}

const Ctx = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 6000;
const MAX_VISIBLE = 4;

const toneClasses: Record<ToastTone, string> = {
  error:
    "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200",
  success:
    "border-accent-300 bg-accent-50 text-accent-900 dark:border-accent-800 dark:bg-accent-950 dark:text-accent-200",
  info: "border-zinc-300 bg-white text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextIdRef = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, tone: ToastTone = "error") => {
      const id = nextIdRef.current;
      nextIdRef.current += 1;
      setToasts((prev) => [...prev.slice(-(MAX_VISIBLE - 1)), { id, message, tone }]);
      window.setTimeout(() => {
        dismiss(id);
      }, AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className={`pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-lg ${toneClasses[t.tone]}`}
          >
            {t.tone === "error" ? <IconWarning size={14} className="mt-0.5 shrink-0" /> : null}
            <span className="min-w-0 flex-1">{t.message}</span>
            <button
              type="button"
              aria-label="Dismiss notification"
              className="shrink-0 cursor-pointer rounded p-0.5 opacity-60 hover:opacity-100"
              onClick={() => {
                dismiss(t.id);
              }}
            >
              <IconX size={12} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(Ctx);
  if (ctx === null) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
