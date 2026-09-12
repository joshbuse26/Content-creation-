ALTER TABLE "thumbnail_concepts" ADD COLUMN "board_id" uuid;--> statement-breakpoint
ALTER TABLE "thumbnail_concepts" ADD COLUMN "overlay_text" text;--> statement-breakpoint
ALTER TABLE "thumbnail_concepts" ADD COLUMN "preset_id" text;--> statement-breakpoint
ALTER TABLE "thumbnail_concepts" ADD COLUMN "subject_mode" text;--> statement-breakpoint
ALTER TABLE "thumbnail_concepts" ADD COLUMN "color_mood" text;--> statement-breakpoint
ALTER TABLE "thumbnail_concepts" ADD COLUMN "favorited" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "thumbnail_concepts" ADD COLUMN "sort" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "thumbnail_concepts_board_idx" ON "thumbnail_concepts" USING btree ("board_id");