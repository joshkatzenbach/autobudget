import { db } from '../db';
import { plaidTransactions, transactionCategories, transactionCategoryOverrides, monthlyCategorySummaries, budgetCategories, budgets, plaidAccounts } from '../db/schema';
import { eq, and, desc, gte, lte, sql, inArray, isNull } from 'drizzle-orm';

export interface TransactionWithCategories {
  id: number;
  userId: number;
  itemId: number;
  accountId: string;
  transactionId: string;
  amount: string;
  merchantName: string | null;
  name: string;
  date: string;
  plaidCategory: string | null;
  plaidCategoryId: string | null;
  isPending: boolean;
  createdAt: Date;
  updatedAt: Date;
  accountName?: string | null;
  accountMask?: string | null;
  categories: Array<{
    id: number;
    categoryId: number;
    subcategoryId?: number | null;
    amount: string;
    isManual: boolean;
    categoryName?: string;
  }>;
}

export async function storeTransaction(
  userId: number,
  itemId: number,
  accountId: string,
  transactionId: string,
  amount: string,
  merchantName: string | null,
  name: string,
  date: string,
  plaidCategory: string | null,
  plaidCategoryId: string | null,
  isPending: boolean = false
) {
  try {
    const [transaction] = await db
      .insert(plaidTransactions)
      .values({
        userId,
        itemId,
        accountId,
        transactionId,
        amount,
        merchantName,
        name,
        date,
        plaidCategory,
        plaidCategoryId,
        isPending,
      })
      .returning();

    return transaction;
  } catch (error: any) {
    // Log detailed error information
    console.error(`Error storing transaction ${transactionId}:`, {
      message: error.message,
      code: error.code,
      detail: error.detail,
      constraint: error.constraint,
    });
    throw error;
  }
}

export async function assignTransactionCategory(
  transactionId: number,
  categoryId: number,
  amount: string,
  isManual: boolean = false,
  subcategoryId: number | null = null
) {
  // Delete existing categories for this transaction
  await db
    .delete(transactionCategories)
    .where(eq(transactionCategories.transactionId, transactionId));

  // Insert new category assignment
  const [categoryAssignment] = await db
    .insert(transactionCategories)
    .values({
      transactionId,
      categoryId,
      subcategoryId: subcategoryId || null,
      amount,
      isManual,
    })
    .returning();

  return categoryAssignment;
}

export async function updateTransactionCategories(
  transactionId: number,
  splits: Array<{ categoryId: number; amount: string; subcategoryId?: number | null }>,
  isManual: boolean = true
) {
  // Validate sum equals transaction amount
  const transaction = await db
    .select()
    .from(plaidTransactions)
    .where(eq(plaidTransactions.id, transactionId))
    .limit(1);

  if (transaction.length === 0) {
    throw new Error('Transaction not found');
  }

  const totalAmount = parseFloat(transaction[0].amount);
  const splitTotal = splits.reduce((sum, split) => sum + parseFloat(split.amount), 0);

  if (Math.abs(totalAmount - splitTotal) > 0.01) {
    throw new Error(`Split amounts (${splitTotal}) must equal transaction total (${totalAmount})`);
  }

  // Delete existing categories
  await db
    .delete(transactionCategories)
    .where(eq(transactionCategories.transactionId, transactionId));

  // Insert new category assignments
  if (splits.length > 0) {
    await db.insert(transactionCategories).values(
      splits.map((split) => ({
        transactionId,
        categoryId: split.categoryId,
        subcategoryId: split.subcategoryId || null,
        amount: split.amount,
        isManual,
      }))
    );
  }

  return splits;
}

// Helper to get user's budget ID
async function getUserBudgetId(userId: number): Promise<number | null> {
  const [budget] = await db
    .select({ id: budgets.id })
    .from(budgets)
    .where(eq(budgets.userId, userId))
    .limit(1);
  return budget?.id || null;
}

export async function getTransactionsForUser(
  userId: number,
  limit?: number,
  offset?: number
): Promise<TransactionWithCategories[]> {
  // Get all transactions for user (no date filtering - show all)
  const query = db
    .select()
    .from(plaidTransactions)
    .where(eq(plaidTransactions.userId, userId))
    .orderBy(desc(plaidTransactions.date));

  const transactions = limit !== undefined
    ? await query.limit(limit).offset(offset || 0)
    : await query;

  // Get user's budget ID for category lookups
  const budgetId = await getUserBudgetId(userId);

  // Get categories for each transaction
  const transactionsWithCategories: TransactionWithCategories[] = await Promise.all(
    transactions.map(async (transaction) => {
      const categories = await db
        .select({
          id: transactionCategories.id,
          categoryId: transactionCategories.categoryId,
          subcategoryId: transactionCategories.subcategoryId,
          amount: transactionCategories.amount,
          isManual: transactionCategories.isManual,
        })
        .from(transactionCategories)
        .where(eq(transactionCategories.transactionId, transaction.id));

      // Get category names (only if budget exists)
      const categoriesWithNames = await Promise.all(
        categories.map(async (cat) => {
          if (!budgetId) {
            return {
              ...cat,
              categoryName: undefined,
            };
          }
          const [category] = await db
            .select({ name: budgetCategories.name })
            .from(budgetCategories)
            .where(and(
              eq(budgetCategories.id, cat.categoryId),
              eq(budgetCategories.budgetId, budgetId)
            ))
            .limit(1);

          return {
            ...cat,
            categoryName: category?.name,
          };
        })
      );

      // Get account information (use custom name if available)
      const [account] = await db
        .select({
          name: plaidAccounts.name,
          customName: plaidAccounts.customName,
          mask: plaidAccounts.mask,
        })
        .from(plaidAccounts)
        .where(and(
          eq(plaidAccounts.accountId, transaction.accountId),
          eq(plaidAccounts.itemId, transaction.itemId)
        ))
        .limit(1);

      // Convert date to string if it's a Date object
      const dateStr = transaction.date instanceof Date 
        ? transaction.date.toISOString().split('T')[0]
        : String(transaction.date);

      return {
        ...transaction,
        date: dateStr,
        createdAt: transaction.createdAt instanceof Date 
          ? transaction.createdAt.toISOString()
          : String(transaction.createdAt),
        updatedAt: transaction.updatedAt instanceof Date
          ? transaction.updatedAt.toISOString()
          : String(transaction.updatedAt),
        accountName: account?.customName || account?.name || null,
        accountMask: account?.mask || null,
        categories: categoriesWithNames,
      };
    })
  );

  return transactionsWithCategories;
}

export async function splitTransaction(
  transactionId: number,
  splits: Array<{ categoryId: number; amount: string; subcategoryId?: number | null }>
) {
  return updateTransactionCategories(transactionId, splits, true);
}

export async function getUserCategoryOverrides(userId: number) {
  return db
    .select()
    .from(transactionCategoryOverrides)
    .where(eq(transactionCategoryOverrides.userId, userId));
}

export async function getMerchantHistory(userId: number, merchantName: string | null, limit: number = 3) {
  if (!merchantName) {
    return [];
  }

  const transactions = await db
    .select()
    .from(plaidTransactions)
    .where(and(
      eq(plaidTransactions.userId, userId),
      eq(plaidTransactions.merchantName, merchantName)
    ))
    .orderBy(desc(plaidTransactions.date))
    .limit(limit);

  // Get categories for each transaction
  const transactionsWithCategories = await Promise.all(
    transactions.map(async (transaction) => {
      const categories = await db
        .select({
          categoryId: transactionCategories.categoryId,
          amount: transactionCategories.amount,
        })
        .from(transactionCategories)
        .where(eq(transactionCategories.transactionId, transaction.id));

      // Get category names
      const categoriesWithNames = await Promise.all(
        categories.map(async (cat) => {
          const [category] = await db
            .select({ name: budgetCategories.name })
            .from(budgetCategories)
            .where(eq(budgetCategories.id, cat.categoryId))
            .limit(1);

          return {
            categoryId: cat.categoryId,
            amount: cat.amount,
            categoryName: category?.name || 'Unknown',
          };
        })
      );

      return {
        id: transaction.id,
        amount: transaction.amount,
        date: transaction.date,
        merchantName: transaction.merchantName,
        categories: categoriesWithNames,
      };
    })
  );

  return transactionsWithCategories;
}

export async function generateMonthlySummary(
  userId: number,
  year: number,
  month: number,
  budgetId?: number
) {
  // Calculate start and end dates for the month
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  // Get all transactions for the user in this month
  const transactions = await db
    .select()
    .from(plaidTransactions)
    .where(and(
      eq(plaidTransactions.userId, userId),
      gte(plaidTransactions.date, startDate),
      lte(plaidTransactions.date, endDate)
    ));

  // Get all category assignments for these transactions
  const transactionIds = transactions.map(t => t.id);
  
  if (transactionIds.length === 0) {
    return [];
  }

  const categoryAssignments = await db
    .select()
    .from(transactionCategories)
    .where(inArray(transactionCategories.transactionId, transactionIds));

  // Get category info and filter by budget if specified, excluding "Excluded" category
  const categorySummaries = new Map<string, { categoryId: number; totalSpent: number; transactionCount: Set<number> }>();

  for (const assignment of categoryAssignments) {
    const [category] = await db
      .select()
      .from(budgetCategories)
      .where(eq(budgetCategories.id, assignment.categoryId))
      .limit(1);

    if (!category) continue;
    if (budgetId && category.budgetId !== budgetId) continue;
    
    // Skip excluded categories
    if (category.categoryType === 'excluded') continue;

    const key = `${category.budgetId}-${assignment.categoryId}`;
    if (!categorySummaries.has(key)) {
      categorySummaries.set(key, {
        categoryId: assignment.categoryId,
        totalSpent: 0,
        transactionCount: new Set(),
      });
    }

    const summary = categorySummaries.get(key)!;
    summary.totalSpent += parseFloat(assignment.amount);
    summary.transactionCount.add(assignment.transactionId);
  }

  // Create or update summary records
  const summaries = [];
  for (const [key, summary] of categorySummaries.entries()) {
    const [budgetIdFromKey] = key.split('-');
    const summaryBudgetId = budgetId || (budgetIdFromKey ? parseInt(budgetIdFromKey) : null);
    
    const conditions = [
      eq(monthlyCategorySummaries.userId, userId),
      eq(monthlyCategorySummaries.categoryId, summary.categoryId),
      eq(monthlyCategorySummaries.year, year),
      eq(monthlyCategorySummaries.month, month),
    ];
    
    if (summaryBudgetId) {
      conditions.push(eq(monthlyCategorySummaries.budgetId, summaryBudgetId));
    } else {
      conditions.push(isNull(monthlyCategorySummaries.budgetId));
    }

    const [existing] = await db
      .select()
      .from(monthlyCategorySummaries)
      .where(and(...conditions))
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(monthlyCategorySummaries)
        .set({
          totalSpent: summary.totalSpent.toFixed(2),
          transactionCount: summary.transactionCount.size,
          updatedAt: new Date(),
        })
        .where(eq(monthlyCategorySummaries.id, existing.id))
        .returning();
      summaries.push(updated);
    } else {
      const [created] = await db
        .insert(monthlyCategorySummaries)
        .values({
          userId,
          budgetId: summaryBudgetId,
          categoryId: summary.categoryId,
          year,
          month,
          totalSpent: summary.totalSpent.toFixed(2),
          transactionCount: summary.transactionCount.size,
        })
        .returning();
      summaries.push(created);
    }
  }

  return summaries;
}

export async function getMonthlySummaries(
  userId: number,
  year?: number,
  month?: number,
  budgetId?: number
) {
  const conditions = [eq(monthlyCategorySummaries.userId, userId)];
  if (year) {
    conditions.push(eq(monthlyCategorySummaries.year, year));
  }
  if (month) {
    conditions.push(eq(monthlyCategorySummaries.month, month));
  }
  if (budgetId) {
    conditions.push(eq(monthlyCategorySummaries.budgetId, budgetId));
  }

  return db
    .select()
    .from(monthlyCategorySummaries)
    .where(and(...conditions));
}

export async function removeTransactionCategory(transactionId: number, categoryId: number) {
  await db
    .delete(transactionCategories)
    .where(and(
      eq(transactionCategories.transactionId, transactionId),
      eq(transactionCategories.categoryId, categoryId)
    ));
}

