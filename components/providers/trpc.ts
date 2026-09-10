"use client";

import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@/server/routers";

/** The typed tRPC React hooks — every screen's data access goes through this. */
export const trpc = createTRPCReact<AppRouter>();
