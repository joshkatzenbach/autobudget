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
  categoryType: varchar('category_type', { length: 50 }).notNull().default('variable'), // 'fixed', 'savings', 'variable', 'surplus', 'excluded'
  accumulatedTotal: decimal('accumulated_total', { precision: 10, scale: 2 }).default('0').notNull(), // For Savings/Surplus/Fixed - tracks year-to-date accumulation
  color: varchar('color', { length: 7 }), // Hex color code for category (e.g., #FF5733)
  // Variable category fields
  autoMoveSurplus: boolean('auto_move_surplus').default(false).notNull(), // Whether to automatically move surplus
  surplusTargetCategoryId: integer('surplus_target_category_id'), // Target savings category for surplus - reference added after table creation
  autoMoveDeficit: boolean('auto_move_deficit').default(false).notNull(), // Whether to automatically move deficit
  deficitSourceCategoryId: integer('deficit_source_category_id'), // Source savings category for deficit - reference added after table creation
  // Fixed category fields
  expectedMerchantName: varchar('expected_merchant_name', { length: 255 }), // Expected merchant name for bills
  hideFromTransactionLists: boolean('hide_from_transaction_lists').default(false).notNull(), // Whether to hide from transaction lists
  // Savings category fields
  isTaxDeductible: boolean('is_tax_deductible').default(false).notNull(), // Whether savings are tax-deductible (e.g., 401k, IRA)
  isSubjectToFica: boolean('is_subject_to_fica').default(false).notNull(), // Whether tax-deductible savings are subject to FICA taxes
  isUnconnectedAccount: boolean('is_unconnected_account').default(false).notNull(), // Whether money is in an account not connected via Plaid
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
  transactionsCursor: text('transactions_cursor'), // Cursor for Transactions Sync API
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
  itemId: integer('item_id').references(() => plaidItems.id, { onDelete: 'set null' }), // Nullable - allows keeping transactions after account removal
  accountId: varchar('account_id', { length: 255 }).notNull(), // Plaid account_id
  transactionId: varchar('transaction_id', { length: 255 }).notNull().unique(), // Plaid transaction_id
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(), // Transaction total amount, negative for debits
  merchantName: varchar('merchant_name', { length: 255 }), // Merchant/store name
  name: varchar('name', { length: 255 }).notNull(), // Transaction name/description
  date: date('date').notNull(), // Transaction date
  plaidCategory: text('plaid_category'), // Plaid's category array as JSON string, e.g., ["Food and Drink", "Restaurants"]
  plaidCategoryId: varchar('plaid_category_id', { length: 255 }), // Plaid's category ID
  isPending: boolean('is_pending').default(false).notNull(), // Whether transaction is pending
  isReviewed: boolean('is_reviewed').default(false).notNull(), // Whether transaction has been reviewed by user
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const transactionCategories = pgTable('transaction_categories', {
  id: serial('id').primaryKey(),
  transactionId: integer('transaction_id').notNull().references(() => plaidTransactions.id, { onDelete: 'cascade' }),
  categoryId: integer('category_id').notNull().references(() => budgetCategories.id, { onDelete: 'cascade' }),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(), // Portion of transaction amount for this category
  isManual: boolean('is_manual').default(false).notNull(), // true if user manually assigned, false if LLM-assigned
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
  accumulatedTotal: decimal('accumulated_total', { precision: 10, scale: 2 }), // For Fixed categories - tracks savings at month end
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  uniqueUserBudgetCategoryMonth: unique().on(table.userId, table.budgetId, table.categoryId, table.year, table.month),
}));

export const slackMessages = pgTable('slack_messages', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }), // Nullable for incoming from unknown users
  direction: varchar('direction', { length: 10 }).notNull(), // 'inbound' or 'outbound'
  fromUserId: varchar('from_user_id', { length: 50 }), // Slack user ID (nullable for bot messages)
  toChannelId: varchar('to_channel_id', { length: 50 }), // Slack channel ID (for channel messages)
  toUserId: varchar('to_user_id', { length: 50 }), // Slack user ID (for DMs)
  channelId: varchar('channel_id', { length: 50 }), // Channel where message was sent/received
  messageBody: text('message_body').notNull(), // Message content
  messageTs: varchar('message_ts', { length: 50 }).unique(), // Slack message timestamp (unique identifier)
  threadTs: varchar('thread_ts', { length: 50 }), // Thread timestamp if message is in a thread
  status: varchar('status', { length: 20 }), // sent, delivered, failed, received, etc.
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const slackOAuth = pgTable('slack_oauth', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  teamId: varchar('team_id', { length: 50 }).notNull(), // Slack workspace ID
  accessToken: text('access_token').notNull(), // Encrypted Slack access token
  refreshToken: text('refresh_token'), // Encrypted refresh token (nullable)
  botUserId: varchar('bot_user_id', { length: 50 }), // Slack bot user ID
  scope: text('scope'), // OAuth scopes granted
  notificationGroupDMChannelId: varchar('notification_group_dm_channel_id', { length: 50 }), // Channel ID for notification group DM
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const fundMovements = pgTable('fund_movements', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  budgetId: integer('budget_id').notNull().references(() => budgets.id, { onDelete: 'cascade' }),
  fromCategoryId: integer('from_category_id').references(() => budgetCategories.id, { onDelete: 'set null' }), // null for deficit (pulled from source)
  toCategoryId: integer('to_category_id').references(() => budgetCategories.id, { onDelete: 'set null' }), // null for surplus (moved to target)
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  movementType: varchar('movement_type', { length: 20 }).notNull(), // 'surplus' or 'deficit'
  variableCategoryId: integer('variable_category_id').notNull().references(() => budgetCategories.id, { onDelete: 'cascade' }), // the variable category this movement is for
  month: integer('month').notNull(), // 1-12
  year: integer('year').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const savingsSnapshots = pgTable('savings_snapshots', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  budgetId: integer('budget_id').notNull().references(() => budgets.id, { onDelete: 'cascade' }),
  categoryId: integer('category_id').notNull().references(() => budgetCategories.id, { onDelete: 'cascade' }),
  year: integer('year').notNull(),
  month: integer('month').notNull(), // 1-12
  accumulatedTotal: decimal('accumulated_total', { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  uniqueUserBudgetCategoryMonth: unique().on(table.userId, table.budgetId, table.categoryId, table.year, table.month),
}));

export const plaidWebhooks = pgTable('plaid_webhooks', {
  id: serial('id').primaryKey(),
  itemId: varchar('item_id', { length: 255 }), // Plaid item_id (nullable if webhook doesn't include it)
  webhookType: varchar('webhook_type', { length: 100 }).notNull(), // e.g., SYNC_UPDATES_AVAILABLE, TRANSACTIONS, etc.
  webhookCode: varchar('webhook_code', { length: 100 }), // Additional webhook code if present
  payload: text('payload').notNull(), // Full webhook payload as JSON string
  processed: boolean('processed').default(false).notNull(), // Whether webhook was successfully processed
  errorMessage: text('error_message'), // Error message if processing failed
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

