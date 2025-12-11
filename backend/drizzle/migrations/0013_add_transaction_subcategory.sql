-- Add subcategory_id column to transaction_categories table
ALTER TABLE "transaction_categories" ADD COLUMN "subcategory_id" integer;
ALTER TABLE "transaction_categories" ADD CONSTRAINT "transaction_categories_subcategory_id_budget_category_subcategories_id_fk" FOREIGN KEY ("subcategory_id") REFERENCES "budget_category_subcategories"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

