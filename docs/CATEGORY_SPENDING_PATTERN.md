# Category Spending: Computed at Read Time

## Overview

Category spending (`spentAmount`) is **not stored** in the `budget_categories` table. It is computed live every time categories are fetched via `getBudgetCategories()`.

## How It Works

1. `getBudgetCategories()` queries all categories for the user's budget
2. `calculateCategorySpending()` joins `transaction_categories` with `plaid_transactions` to sum spending per category for the current month
3. The computed `spentAmount` is merged onto each category object before returning

## Why Not Store It?

The `spent_amount` column was removed in migration `0005` because:

- It was always initialized to `'0'` and never updated after insert
- The actual spending was always overwritten by the live calculation in `getBudgetCategories()`
- Having a column that's never meaningfully persisted is misleading about the source of truth

## API Contract

The API still returns `spentAmount: string` on each category object. The frontend `BudgetCategory` model still has this field. Nothing changed from the consumer's perspective -- the value just comes from a live query instead of a (stale) stored column.

## Key Files

- `backend/src/services/budgets.ts` -- `calculateCategorySpending()` and `getBudgetCategories()`
- `backend/src/db/schema.ts` -- `budgetCategories` table (no `spentAmount` column)
- `ng-budget/src/app/models/budget.model.ts` -- `BudgetCategory.spentAmount` (still present on the model)
