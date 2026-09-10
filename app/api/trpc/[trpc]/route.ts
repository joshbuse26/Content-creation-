import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { randomUUID } from "node:crypto";
import { appRouter } from "@/server/routers";
import { createContext } from "@/server/trpc";
import { getSessionWithFixtureFallback } from "@/server/session";
import { logger } from "@/lib/logger";

const handler = async (req: Request) => {
  // Fixture mode synthesizes the fixture-user session (REQUESTS-A3 #1).
  const session = await getSessionWithFixtureFallback();
  const requestId = randomUUID();
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createContext({ session, requestId }),
    onError({ error, path }) {
      logger.error({ requestId, path, code: error.code, message: error.message }, "trpc error");
    },
  });
};

export { handler as GET, handler as POST };
