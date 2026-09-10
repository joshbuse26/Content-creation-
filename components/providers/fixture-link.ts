import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { AppRouter } from "@/server/routers";
import { resolveFixtureResponse } from "./fixture-data";

/**
 * tRPC link that answers UNAUTHORIZED responses with fixture data.
 *
 * The real request is always attempted first, so as soon as a session exists
 * (or A0 lands the server-side fixture session — REQUESTS-A3.md #1) this link
 * becomes a no-op passthrough. Never active in production builds.
 */
const ENABLED = process.env.NODE_ENV !== "production";

export const fixtureFallbackLink: TRPCLink<AppRouter> = () => {
  return ({ next, op }) =>
    observable((observer) => {
      const sub = next(op).subscribe({
        next(value) {
          observer.next(value);
        },
        error(err) {
          if (ENABLED && err instanceof TRPCClientError && isUnauthorized(err)) {
            const fallback = resolveFixtureResponse(op.path, op.input);
            if (fallback.hit) {
              observer.next({ result: { type: "data", data: fallback.data } });
              observer.complete();
              return;
            }
          }
          observer.error(err);
        },
        complete() {
          observer.complete();
        },
      });
      return () => {
        sub.unsubscribe();
      };
    });
};

function isUnauthorized(err: TRPCClientError<AppRouter>): boolean {
  const data: unknown = err.data;
  if (typeof data !== "object" || data === null) return false;
  return (data as { code?: unknown }).code === "UNAUTHORIZED";
}
