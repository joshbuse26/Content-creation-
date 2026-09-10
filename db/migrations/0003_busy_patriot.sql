CREATE TABLE "stripe_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_events_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "billing_period_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "pending_plan" "plan";--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "payment_failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "overage_used" integer;--> statement-breakpoint
CREATE INDEX "stripe_events_type_idx" ON "stripe_events" USING btree ("type");