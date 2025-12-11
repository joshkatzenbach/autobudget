import { pgTable, serial, varchar, text, timestamp, decimal, boolean, date, integer, unique } from 'drizzle-orm/pg-core';
import { pgEnum } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  firstName: varchar('first_name', { length: 100 }),
  lastName: varchar('last_name', { length: 100 }),
  phoneNumber: varchar('phone_number', { length: 20 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const sessions = pgTable('sessions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  lastUsedAt: timestamp('last_used_at').defaultNow().notNull(),
});

export const budgets = pgTable('budgets', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(), // One budget per user
  name: varchar('name', { length: 255 }).notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  income: decimal('income', { precision: 10, scale: 2 }).notNull(), // Monthly income
  taxRate: decimal('tax_rate', { precision: 5, scale: 2 }).default('0').notNull(), // Effective tax rate as percentage (calculated)
  filingStatus: varchar('filing_status', { length: 50 }).default('single').notNull(), // 'single', 'married-jointly', 'married-separately', 'head-of-household'
  deductions: decimal('deductions', { precision: 10, scale: 2 }).default('0').notNull(), // Additional deductions beyond standard
  isActive: boolean('is_active').default(true).notNull(), // Kept for backward compatibility but not used
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const budgetCategories = pgTable('budget_categories', {
  id: serial('id').primaryKey(),
  budgetId: integer('budget_id').notNull().references(() => budgets.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  allocatedAmount: decimal('allocated_amount', { precision: 10, scale: 2 }).notNull(), // Amount to spend/allocate per month (same for all category types)
  spentAmount: decimal('spent_amount', { precision: 10, scale: 2 }).default('0').notNull(),
  categoryType: varchar('category_type', { length: 50 }).notNull().default('variable'), // 'expected', 'savings', 'variable', 'surplus'
  accumulatedTotal: decimal('accumulated_total', { precision: 10, scale: 2 }).default('0').notNull(), // For Savings/Surplus - tracks year-to-date accumulation
  estimationMonths: integer('estimation_months').default(12), // For Expected - number of months to use for estimation (optional feature)
  isBufferCategory: boolean('is_buffer_category').default(false).notNull(), // Can be reduced when other categories go over
  bufferPriority: integer('buffer_priority').default(999), // Order for buffer reduction, lower = reduced first
  color: varchar('color', { length: 7 }), // Hex color code for category (e.g., #FF5733)
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const budgetCategorySubcategories = pgTable('budget_category_subcategories', {
  id: serial('id').primaryKey(),
  categoryId: integer('category_id').notNull().references(() => budgetCategories.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(), // Subcategory name, e.g., "Internet", "Electricity"
  expectedAmount: decimal('expected_amount', { precision: 10, scale: 2 }).notNull(), // Expected amount for this subcategory
  actualAmount: decimal('actual_amount', { precision: 10, scale: 2 }), // Actual amount when bill comes in
  billDate: date('bill_date'), // Date of bill
  useEstimation: boolean('use_estimation').default(false).notNull(), // Whether to use estimation feature for this subcategory
  estimationMonths: integer('estimation_months'), // Number of months to use for estimation (if useEstimation is true)
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const plaidItems = pgTable('plaid_items', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  itemId: varchar('item_id', { length: 255 }).notNull().unique(), // Plaid item_id
  accessToken: text('access_token').notNull(), // Encrypted Plaid access token
  institutionId: varchar('institution_id', { length: 255 }),
  institutionName: varchar('institution_name', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const plaidAccounts = pgTable('plaid_accounts', {
  id: serial('id').primaryKey(),
  itemId: integer('item_id').notNull().references(() => plaidItems.id, { onDelete: 'cascade' }),
  accountId: varchar('account_id', { length: 255 }).notNull(), // Plaid account_id
  name: varchar('name', { length: 255 }).notNull(), // Original Plaid name
  customName: varchar('custom_name', { length: 255 }), // User-defined custom name
  officialName: varchar('official_name', { length: 500 }),
  type: varchar('type', { length: 50 }), // depository, credit, loan, investment, etc.
  subtype: varchar('subtype', { length: 50 }), // checking, savings, credit card, etc.
  mask: varchar('mask', { length: 10 }), // Last 4 digits
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const plaidTransactions = pgTable('plaid_transactions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  itemId: integer('item_id').notNull().references(() => plaidItems.id, { onDelete: 'cascade' }),
  accountId: varchar('account_id', { length: 255 }).notNull(), // Plaid account_id
  transactionId: varchar('transaction_id', { length: 255 }).notNull().unique(), // Plaid transaction_id
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(), // Transaction total amount, negative for debits
  merchantName: varchar('merchant_name', { length: 255 }), // Merchant/store name
  name: varchar('name', { length: 255 }).notNull(), // Transaction name/description
  date: date('date').notNull(), // Transaction date
  plaidCategory: text('plaid_category'), // Plaid's category array as JSON string, e.g., ["Food and Drink", "Restaurants"]
  plaidCategoryId: varchar('plaid_category_id', { length: 255 }), // Plaid's category ID
  isPending: boolean('is_pending').default(false).notNull(), // Whether transaction is pending
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const transactionCategories = pgTable('transaction_categories', {
  id: serial('id').primaryKey(),
  transactionId: integer('transaction_id').notNull().references(() => plaidTransactions.id, { onDelete: 'cascade' }),
  categoryId: integer('category_id').notNull().references(() => budgetCategories.id, { onDelete: 'cascade' }),
  subcategoryId: integer('subcategory_id').references(() => budgetCategorySubcategories.id, { onDelete: 'set null' }), // Optional subcategory assignment
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(), // Portion of transaction amount for this category
  isManual: boolean('is_manual').default(false).notNull(), // true if user manually assigned, false if LLM-assigned
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const transactionCategoryOverrides = pgTable('transaction_category_overrides', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  merchantName: varchar('merchant_name', { length: 255 }), // For merchant-based overrides
  plaidCategoryId: varchar('plaid_category_id', { length: 255 }), // For Plaid category-based overrides
  categoryId: integer('category_id').notNull().references(() => budgetCategories.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const monthlyCategorySummaries = pgTable('monthly_category_summaries', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  budgetId: integer('budget_id').references(() => budgets.id, { onDelete: 'cascade' }), // Optional, for budget-specific summaries
  categoryId: integer('category_id').notNull().references(() => budgetCategories.id, { onDelete: 'cascade' }),
  year: integer('year').notNull(), // e.g., 2024
  month: integer('month').notNull(), // 1-12
  totalSpent: decimal('total_spent', { precision: 10, scale: 2 }).notNull(), // Sum of all transaction amounts for this category in this month
  transactionCount: integer('transaction_count').default(0).notNull(), // Number of transactions in this category for this month
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  uniqueUserBudgetCategoryMonth: unique().on(table.userId, table.budgetId, table.categoryId, table.year, table.month),
}));

