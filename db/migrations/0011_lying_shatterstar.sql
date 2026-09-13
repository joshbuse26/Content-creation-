CREATE TYPE "public"."content_pack_kind" AS ENUM('outline', 'hook_pack');--> statement-breakpoint
CREATE TABLE "content_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"channel_id" uuid,
	"kind" "content_pack_kind" NOT NULL,
	"name" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "section_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"script_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_templates" ADD CONSTRAINT "content_templates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_templates" ADD CONSTRAINT "content_templates_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_comments" ADD CONSTRAINT "section_comments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_comments" ADD CONSTRAINT "section_comments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_comments" ADD CONSTRAINT "section_comments_script_id_scripts_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."scripts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_comments" ADD CONSTRAINT "section_comments_section_id_script_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."script_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_comments" ADD CONSTRAINT "section_comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_templates_workspace_idx" ON "content_templates" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "content_templates_channel_idx" ON "content_templates" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "content_templates_kind_idx" ON "content_templates" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "section_comments_section_idx" ON "section_comments" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "section_comments_script_idx" ON "section_comments" USING btree ("script_id");--> statement-breakpoint
CREATE INDEX "section_comments_workspace_idx" ON "section_comments" USING btree ("workspace_id");