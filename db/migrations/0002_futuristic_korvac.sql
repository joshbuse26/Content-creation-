ALTER TABLE "credit_ledger" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_idempotency_uq" ON "credit_ledger" USING btree ("idempotency_key") WHERE "credit_ledger"."idempotency_key" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_credit_balance_floor" CHECK ("workspaces"."credit_balance" >= 0);