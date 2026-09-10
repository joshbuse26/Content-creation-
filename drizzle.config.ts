import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    // drizzle-kit only needs a live connection for `migrate`/`push`, not `generate`.
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/gin_rummy",
  },
  strict: true,
  verbose: true,
});
