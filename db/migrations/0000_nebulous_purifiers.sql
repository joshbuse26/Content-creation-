CREATE TYPE "public"."channel_mode" AS ENUM('oauth', 'public');--> statement-breakpoint
CREATE TYPE "public"."credit_reason" AS ENUM('script_generation', 'revision_pass', 'idea_batch', 'titles', 'thumbnail', 'research_run', 'avatar_regen', 'purchase', 'plan_grant', 'refund', 'adjustment', 'monthly_reset');--> statement-breakpoint
CREATE TYPE "public"."description_mode" AS ENUM('informative', 'narrative', 'seo');--> statement-breakpoint
CREATE TYPE "public"."frame_format" AS ENUM('listicle', 'essay', 'tutorial', 'challenge', 'doc', 'reaction', 'other');--> statement-breakpoint
CREATE TYPE "public"."frame_outcome" AS ENUM('subs', 'watch_time', 'conversion');--> statement-breakpoint
CREATE TYPE "public"."idea_status" AS ENUM('new', 'saved', 'dismissed', 'promoted');--> statement-breakpoint
CREATE TYPE "public"."pipeline_kind" AS ENUM('script', 'ideas', 'avatar', 'revision', 'thumbnail');--> statement-breakpoint
CREATE TYPE "public"."pipeline_run_status" AS ENUM('queued', 'running', 'failed', 'done');--> statement-breakpoint
CREATE TYPE "public"."plan" AS ENUM('free', 'starter', 'team', 'agency');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('idea', 'researching', 'framing', 'scripting', 'revising', 'packaging', 'scheduled', 'published');--> statement-breakpoint
CREATE TYPE "public"."research_kind" AS ENUM('web', 'transcript', 'upload');--> statement-breakpoint
CREATE TYPE "public"."revision_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('owner', 'admin', 'writer', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."script_status" AS ENUM('outlining', 'drafting', 'revising', 'final');--> statement-breakpoint
CREATE TYPE "public"."section_kind" AS ENUM('hook', 'intro', 'chapter', 'cta', 'outro');--> statement-breakpoint
CREATE TYPE "public"."sophistication" AS ENUM('beginner', 'intermediate', 'advanced', 'expert');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('never', 'queued', 'syncing', 'synced', 'failed');--> statement-breakpoint
CREATE TYPE "public"."thumbnail_status" AS ENUM('candidate', 'chosen');--> statement-breakpoint
CREATE TYPE "public"."voice_source" AS ENUM('own_channel', 'samples', 'licensed');--> statement-breakpoint
CREATE TABLE "accounts" (
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"hashed_key" text NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"channel_ids" uuid[] DEFAULT '{}' NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_hashed_key_unique" UNIQUE("hashed_key")
);
--> statement-breakpoint
CREATE TABLE "audience_avatars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"age_range" text,
	"gender_split" text,
	"geo" text[] DEFAULT '{}' NOT NULL,
	"sophistication" "sophistication",
	"pains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"motivations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"vocabulary_notes" text,
	"editable_by_user" boolean DEFAULT true NOT NULL,
	"ai_generated_at" timestamp with time zone,
	"last_edited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audience_avatars_channel_id_unique" UNIQUE("channel_id")
);
--> statement-breakpoint
CREATE TABLE "channel_stats_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"subs" integer NOT NULL,
	"total_views" integer NOT NULL,
	"median_views_90d" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"mode" "channel_mode" NOT NULL,
	"youtube_channel_id" text NOT NULL,
	"title" text NOT NULL,
	"handle" text,
	"oauth_refresh_token" text,
	"niche_keywords" text[] DEFAULT '{}' NOT NULL,
	"sync_status" "sync_status" DEFAULT 'never' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"entries" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" "credit_reason" NOT NULL,
	"actor_user_id" uuid,
	"project_id" uuid,
	"pipeline_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "description_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "descriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"mode" "description_mode" NOT NULL,
	"body" text NOT NULL,
	"template_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "frames" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"chosen" boolean DEFAULT false NOT NULL,
	"angle" text NOT NULL,
	"format" "frame_format" NOT NULL,
	"outcome" "frame_outcome" NOT NULL,
	"audience_segment" text NOT NULL,
	"tone" text NOT NULL,
	"target_minutes" integer NOT NULL,
	"keywords" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"title" text NOT NULL,
	"angle" text NOT NULL,
	"rationale" text NOT NULL,
	"evidence_video_ids" text[] DEFAULT '{}' NOT NULL,
	"score" numeric(5, 2) NOT NULL,
	"status" "idea_status" DEFAULT 'new' NOT NULL,
	"generated_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "role" DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "niche_videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"youtube_video_id" text NOT NULL,
	"channel_ytid" text NOT NULL,
	"title" text NOT NULL,
	"thumbnail_url" text,
	"published_at" timestamp with time zone NOT NULL,
	"view_count" integer NOT NULL,
	"channel_median_views" integer NOT NULL,
	"outlier_ratio" numeric(10, 2) NOT NULL,
	"format_tags" text[] DEFAULT '{}' NOT NULL,
	"niche_keywords" text[] DEFAULT '{}' NOT NULL,
	"last_refreshed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "niche_videos_youtube_video_id_unique" UNIQUE("youtube_video_id")
);
--> statement-breakpoint
CREATE TABLE "pipeline_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"kind" "pipeline_kind" NOT NULL,
	"stage" text NOT NULL,
	"status" "pipeline_run_status" DEFAULT 'queued' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"input_hash" text NOT NULL,
	"error" text,
	"credits_charged" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" "project_status" DEFAULT 'idea' NOT NULL,
	"idea_id" uuid,
	"target_publish_date" date,
	"published_video_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_docs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" "research_kind" NOT NULL,
	"source_url" text,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"word_count" integer NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"script_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"suggestion" text NOT NULL,
	"diff" jsonb NOT NULL,
	"status" "revision_status" DEFAULT 'pending' NOT NULL,
	"rationale" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "script_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"script_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" "section_kind" NOT NULL,
	"heading" text NOT NULL,
	"body" text NOT NULL,
	"voice_profile_id" uuid,
	"locked" boolean DEFAULT false NOT NULL,
	"est_seconds" integer DEFAULT 0 NOT NULL,
	"retention_note" text,
	"fact_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"voice_profile_id" uuid,
	"status" "script_status" DEFAULT 'outlining' NOT NULL,
	"stats" jsonb DEFAULT '{"words":0,"estRuntimeS":0,"readability":0}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tag_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thumbnail_concepts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"prompt_used" text NOT NULL,
	"composition_pattern" text NOT NULL,
	"image_key" text,
	"status" "thumbnail_status" DEFAULT 'candidate' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "title_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"options" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"email_verified" timestamp with time zone,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE "voice_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"name" text NOT NULL,
	"source" "voice_source" NOT NULL,
	"style_card" jsonb NOT NULL,
	"license_doc_url" text,
	"license_signed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voice_profiles_license_required" CHECK ("voice_profiles"."source" <> 'licensed' OR ("voice_profiles"."license_doc_url" IS NOT NULL AND "voice_profiles"."license_signed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"plan" "plan" DEFAULT 'free' NOT NULL,
	"stripe_customer_id" text,
	"credit_balance" integer DEFAULT 0 NOT NULL,
	"billing_cycle_anchor" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_avatars" ADD CONSTRAINT "audience_avatars_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_avatars" ADD CONSTRAINT "audience_avatars_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_avatars" ADD CONSTRAINT "audience_avatars_last_edited_by_users_id_fk" FOREIGN KEY ("last_edited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_stats_snapshots" ADD CONSTRAINT "channel_stats_snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_stats_snapshots" ADD CONSTRAINT "channel_stats_snapshots_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_pipeline_run_id_pipeline_runs_id_fk" FOREIGN KEY ("pipeline_run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "description_templates" ADD CONSTRAINT "description_templates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "descriptions" ADD CONSTRAINT "descriptions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "descriptions" ADD CONSTRAINT "descriptions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "descriptions" ADD CONSTRAINT "descriptions_template_id_description_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."description_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frames" ADD CONSTRAINT "frames_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frames" ADD CONSTRAINT "frames_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_docs" ADD CONSTRAINT "research_docs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_docs" ADD CONSTRAINT "research_docs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_script_id_scripts_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."scripts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_section_id_script_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."script_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_sections" ADD CONSTRAINT "script_sections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_sections" ADD CONSTRAINT "script_sections_script_id_scripts_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."scripts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_sections" ADD CONSTRAINT "script_sections_voice_profile_id_voice_profiles_id_fk" FOREIGN KEY ("voice_profile_id") REFERENCES "public"."voice_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_voice_profile_id_voice_profiles_id_fk" FOREIGN KEY ("voice_profile_id") REFERENCES "public"."voice_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_sets" ADD CONSTRAINT "tag_sets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_sets" ADD CONSTRAINT "tag_sets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thumbnail_concepts" ADD CONSTRAINT "thumbnail_concepts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thumbnail_concepts" ADD CONSTRAINT "thumbnail_concepts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "title_sets" ADD CONSTRAINT "title_sets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "title_sets" ADD CONSTRAINT "title_sets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_profiles" ADD CONSTRAINT "voice_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_profiles" ADD CONSTRAINT "voice_profiles_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "api_keys_workspace_idx" ON "api_keys" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "audience_avatars_workspace_idx" ON "audience_avatars" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "channel_stats_snapshots_channel_idx" ON "channel_stats_snapshots" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "channel_stats_snapshots_workspace_idx" ON "channel_stats_snapshots" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "channels_workspace_idx" ON "channels" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channels_workspace_ytid_uq" ON "channels" USING btree ("workspace_id","youtube_channel_id");--> statement-breakpoint
CREATE INDEX "chapters_project_idx" ON "chapters" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "chapters_workspace_idx" ON "chapters" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "credit_ledger_workspace_idx" ON "credit_ledger" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "credit_ledger_project_idx" ON "credit_ledger" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "credit_ledger_pipeline_run_idx" ON "credit_ledger" USING btree ("pipeline_run_id");--> statement-breakpoint
CREATE INDEX "credit_ledger_actor_idx" ON "credit_ledger" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "description_templates_workspace_idx" ON "description_templates" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "descriptions_project_idx" ON "descriptions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "descriptions_workspace_idx" ON "descriptions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "descriptions_template_idx" ON "descriptions" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "frames_project_idx" ON "frames" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "frames_workspace_idx" ON "frames" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "ideas_channel_idx" ON "ideas" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "ideas_workspace_idx" ON "ideas" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_workspace_user_uq" ON "memberships" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "niche_videos_channel_ytid_idx" ON "niche_videos" USING btree ("channel_ytid");--> statement-breakpoint
CREATE INDEX "pipeline_runs_project_idx" ON "pipeline_runs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "pipeline_runs_workspace_idx" ON "pipeline_runs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "pipeline_runs_kind_stage_idx" ON "pipeline_runs" USING btree ("kind","stage");--> statement-breakpoint
CREATE INDEX "projects_workspace_idx" ON "projects" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "projects_channel_idx" ON "projects" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "projects_idea_idx" ON "projects" USING btree ("idea_id");--> statement-breakpoint
CREATE INDEX "research_docs_project_idx" ON "research_docs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "research_docs_workspace_idx" ON "research_docs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "revisions_script_idx" ON "revisions" USING btree ("script_id");--> statement-breakpoint
CREATE INDEX "revisions_section_idx" ON "revisions" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "revisions_workspace_idx" ON "revisions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "script_sections_script_idx" ON "script_sections" USING btree ("script_id");--> statement-breakpoint
CREATE INDEX "script_sections_workspace_idx" ON "script_sections" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "script_sections_script_position_uq" ON "script_sections" USING btree ("script_id","position");--> statement-breakpoint
CREATE INDEX "scripts_project_idx" ON "scripts" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "scripts_workspace_idx" ON "scripts" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "scripts_voice_profile_idx" ON "scripts" USING btree ("voice_profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scripts_project_version_uq" ON "scripts" USING btree ("project_id","version");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tag_sets_project_idx" ON "tag_sets" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "tag_sets_workspace_idx" ON "tag_sets" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "thumbnail_concepts_project_idx" ON "thumbnail_concepts" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "thumbnail_concepts_workspace_idx" ON "thumbnail_concepts" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "title_sets_project_idx" ON "title_sets" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "title_sets_workspace_idx" ON "title_sets" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "voice_profiles_channel_idx" ON "voice_profiles" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "voice_profiles_workspace_idx" ON "voice_profiles" USING btree ("workspace_id");