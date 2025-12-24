-- Add plaid_webhooks table to store all Plaid webhook calls for debugging and monitoring

CREATE TABLE "plaid_webhooks" (
	"id" serial PRIMARY KEY NOT NULL,
	"item_id" varchar(255),
	"webhook_type" varchar(100) NOT NULL,
	"webhook_code" varchar(100),
	"payload" text NOT NULL,
	"processed" boolean DEFAULT false NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);

