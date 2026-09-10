CREATE TYPE "public"."generation_mode" AS ENUM('archetype', 'crossover', 'partnered_named', 'train_on_my_channel');--> statement-breakpoint
ALTER TYPE "public"."voice_source" ADD VALUE 'archetype';--> statement-breakpoint
CREATE TABLE "archetypes" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"pitch" text NOT NULL,
	"style_card" jsonb NOT NULL,
	"thumbnail_preset" jsonb NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"style_card" jsonb,
	"license_doc_url" text,
	"license_signed_at" timestamp with time zone,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partners_license_required" CHECK ("partners"."enabled" = false OR ("partners"."license_doc_url" IS NOT NULL AND "partners"."license_signed_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "generation_mode" "generation_mode";--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "archetype_id" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "crossover" jsonb;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "partner_id" uuid;--> statement-breakpoint
ALTER TABLE "scripts" ADD COLUMN "generation_mode" "generation_mode";--> statement-breakpoint
ALTER TABLE "scripts" ADD COLUMN "archetype_id" text;--> statement-breakpoint
ALTER TABLE "scripts" ADD COLUMN "crossover" jsonb;--> statement-breakpoint
ALTER TABLE "scripts" ADD COLUMN "partner_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_archetype_id_archetypes_id_fk" FOREIGN KEY ("archetype_id") REFERENCES "public"."archetypes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_archetype_id_archetypes_id_fk" FOREIGN KEY ("archetype_id") REFERENCES "public"."archetypes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "projects_archetype_idx" ON "projects" USING btree ("archetype_id");--> statement-breakpoint
CREATE INDEX "projects_partner_idx" ON "projects" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "scripts_archetype_idx" ON "scripts" USING btree ("archetype_id");--> statement-breakpoint
CREATE INDEX "scripts_partner_idx" ON "scripts" USING btree ("partner_id");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_mode_archetype_required" CHECK ("projects"."generation_mode" IS DISTINCT FROM 'archetype' OR "projects"."archetype_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_mode_crossover_required" CHECK ("projects"."generation_mode" IS DISTINCT FROM 'crossover' OR "projects"."crossover" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_mode_partner_required" CHECK ("projects"."generation_mode" IS DISTINCT FROM 'partnered_named' OR "projects"."partner_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_mode_archetype_required" CHECK ("scripts"."generation_mode" IS DISTINCT FROM 'archetype' OR "scripts"."archetype_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_mode_crossover_required" CHECK ("scripts"."generation_mode" IS DISTINCT FROM 'crossover' OR "scripts"."crossover" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_mode_partner_required" CHECK ("scripts"."generation_mode" IS DISTINCT FROM 'partnered_named' OR "scripts"."partner_id" IS NOT NULL);--> statement-breakpoint
-- Wave C (C0): transform legacy voice_profiles.style_card rows
-- ({rhythm, register, catchphrases, humor, pov, taboos}) into the
-- StyleCard v2 shape (PRODUCT-CONTRACTS §1). Field mapping is kept in sync
-- with lib/style-card.ts upgradeLegacyStyleCard: voice ← pov/register/rhythm,
-- tone ← humor + taboos, exampleSnippets ← catchphrases (max 4), and
-- neutral defaults for pacing/hooks/CTA/readingLevel/energy.
UPDATE "voice_profiles" SET "style_card" = jsonb_build_object(
  'voice', jsonb_build_object(
    'pov', COALESCE("style_card"->>'pov', ''),
    'diction', COALESCE("style_card"->>'register', ''),
    'rhythm', COALESCE("style_card"->>'rhythm', '')
  ),
  'tone', jsonb_build_object(
    'register', COALESCE("style_card"->>'humor', ''),
    'never', COALESCE((
      SELECT string_agg(t.value, '; ')
      FROM jsonb_array_elements_text(COALESCE("style_card"->'taboos', '[]'::jsonb)) AS t(value)
    ), '')
  ),
  'pacing', jsonb_build_object('wpmTarget', 150, 'sectionSeconds', 90, 'rehookSeconds', 75),
  'hookPatterns', jsonb_build_array(jsonb_build_object(
    'technique', 'open_loop',
    'guidance', 'Open with an unresolved question and defer the payoff.'
  )),
  'ctaHabits', jsonb_build_object(
    'placement', 'after_payoff',
    'placementPct', NULL,
    'phrasingStyle', 'Direct, low-pressure ask tied to the value just delivered.',
    'maxPerVideo', 1
  ),
  'bannedClaims', '[]'::jsonb,
  'readingLevel', jsonb_build_object('minGrade', 6, 'maxGrade', 9),
  'energy', 3,
  'exampleSnippets', COALESCE((
    SELECT jsonb_agg(s.value)
    FROM (
      SELECT c.value, c.ord
      FROM jsonb_array_elements(COALESCE("style_card"->'catchphrases', '[]'::jsonb))
        WITH ORDINALITY AS c(value, ord)
      ORDER BY c.ord
      LIMIT 4
    ) AS s
  ), '[]'::jsonb),
  'thumbnailPresetId', NULL
)
WHERE "style_card" ? 'rhythm' AND NOT ("style_card" ? 'voice');
