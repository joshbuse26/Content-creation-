"use client";

import { useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { ToastProvider } from "@/components/ui/toast";
import { createAppQueryClient } from "./query-client";
import { trpc } from "./trpc";
import { WorkspaceProvider } from "./workspace-context";

export function AppProviders({ children }: { children: ReactNode }) {
  // Retry/stale policy lives in query-client.ts (never retries a 429).
  const [queryClient] = useState(createAppQueryClient);
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: "/api/trpc",
          transformer: superjson,
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <WorkspaceProvider>{children}</WorkspaceProvider>
        </ToastProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
}
