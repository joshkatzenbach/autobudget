ALTER TABLE "budget_categories" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "budget_categories" ADD COLUMN "is_automatic" boolean DEFAULT false NOT NULL;