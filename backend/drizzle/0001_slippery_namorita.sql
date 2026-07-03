DO $$ BEGIN
 CREATE TYPE "public"."order_category" AS ENUM('loading', 'unloading', 'installation');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "category" "order_category" DEFAULT 'loading' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "notify_favorites_first" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "broadcast_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "broadcast_done" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "complete_reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "responses" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "responses" ADD COLUMN "reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "punctuality" integer;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "quality" integer;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "adequacy" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_categories" text[];--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "no_show_count" integer DEFAULT 0 NOT NULL;