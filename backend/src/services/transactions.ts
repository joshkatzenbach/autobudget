import { db } from '../db';
import { plaidTransactions, transactionCategories, budgetCategories, budgets, plaidAccounts } from '../db/schema';
import { eq, and, desc, asc, sql } from 'drizzle-orm';

export interface TransactionWithCategories {
  id: number;
  userId: number;
  itemId: number | null;
  accountId: string;
  transactionId: string;
  amount: string;
  merchantName: string | null;
  name: string;
  date: string;
  plaidCategory: string | null;
  plaidCategoryId: string | null;
  isPending: boolean;
  isReviewed: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
  accountName?: string | null;
  accountMask?: string | null;
  categories: Array<{
    id: number;
    categoryId: number;
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
    // Handle unique constraint violation (duplicate transaction)
    // PostgreSQL error code 23505 = unique_violation
    if (error.code === '23505' && error.constraint?.includes('transaction_id')) {
      console.log(`[DUPLICATE] Transaction ${transactionId} already exists, returning existing transaction`);
      
      // Return the existing transaction
      const [existing] = await db
        .select()
        .from(plaidTransactions)
        .where(eq(plaidTransactions.transactionId, transactionId))
        .limit(1);
      
      if (existing) {
        return existing;
      }
      
      // If for some reason we can't find it, throw the original error
      throw error;
    }
    
    // Log detailed error information for other errors
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
  isManual: boolean = false
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
      amount,
      isManual,
    })
    .returning();

  // Mark transaction as reviewed if manually assigned
  if (isManual) {
    await db
      .update(plaidTransactions)
      .set({ isReviewed: true, updatedAt: new Date() })
      .where(eq(plaidTransactions.id, transactionId));
  }

  return categoryAssignment;
}

export async function updateTransactionCategories(
  transactionId: number,
  splits: Array<{ categoryId: number; amount: string }>,
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

  // Compare absolute values: Plaid convention is positive = outgoing, negative = incoming
  // Split amounts are stored as positive (the portion assigned to each category)
  // So we compare the absolute value of the transaction amount with the sum of split amounts
  if (Math.abs(Math.abs(totalAmount) - splitTotal) > 0.01) {
    throw new Error(`Split amounts (${splitTotal}) must equal transaction total (${Math.abs(totalAmount)})`);
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
        amount: split.amount,
        isManual,
      }))
    );
  }

  // Mark transaction as reviewed if manually assigned
  if (isManual) {
    await db
      .update(plaidTransactions)
      .set({ isReviewed: true, updatedAt: new Date() })
      .where(eq(plaidTransactions.id, transactionId));
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
  offset?: number,
  reviewed?: boolean | null, // null = all, true = reviewed only, false = unreviewed only
  includeHiddenFixed?: boolean // true = include Fixed categories with hideFromTransactionLists, false = hide them (default: false)
): Promise<TransactionWithCategories[]> {
  // Build where conditions
  let whereCondition;
  
  if (reviewed !== null && reviewed !== undefined) {
    // Both userId and reviewed filter
    whereCondition = and(
      eq(plaidTransactions.userId, userId),
      eq(plaidTransactions.isReviewed, reviewed)
    );
  } else {
    // Only userId filter
    whereCondition = eq(plaidTransactions.userId, userId);
  }

  // Build query - order by date (most recent first), then alphabetically by merchant name (use name as fallback if merchantName is null)
  const query = db
    .select()
    .from(plaidTransactions)
    .where(whereCondition)
    .orderBy(
      desc(plaidTransactions.date),
      asc(sql`COALESCE(${plaidTransactions.merchantName}, ${plaidTransactions.name})`)
    );

  const transactions = limit !== undefined
    ? await query.limit(limit).offset(offset || 0)
    : await query;

  // Get user's budget ID for category lookups
  const budgetId = await getUserBudgetId(userId);

  // Get categories for each transaction
  const transactionsWithCategories = await Promise.all(
    transactions.map(async (transaction) => {
      const categories = await db
        .select({
          id: transactionCategories.id,
          categoryId: transactionCategories.categoryId,
          amount: transactionCategories.amount,
          isManual: transactionCategories.isManual,
        })
        .from(transactionCategories)
        .where(eq(transactionCategories.transactionId, transaction.id));

      // Get category names and check if any are hidden Fixed categories
      const categoriesWithNames = await Promise.all(
        categories.map(async (cat) => {
          if (!budgetId) {
            return {
              ...cat,
              categoryName: undefined,
              categoryType: undefined,
              hideFromTransactionLists: false,
            };
          }
          const [category] = await db
            .select({ 
              name: budgetCategories.name,
              categoryType: budgetCategories.categoryType,
              hideFromTransactionLists: budgetCategories.hideFromTransactionLists,
            })
            .from(budgetCategories)
            .where(and(
              eq(budgetCategories.id, cat.categoryId),
              eq(budgetCategories.budgetId, budgetId)
            ))
            .limit(1);

          return {
            ...cat,
            categoryName: category?.name,
            categoryType: category?.categoryType,
            hideFromTransactionLists: category?.hideFromTransactionLists || false,
          };
        })
      );

      // Filter out transactions that are assigned to hidden Fixed categories (unless includeHiddenFixed is true)
      if (!includeHiddenFixed) {
        const hasHiddenFixedCategory = categoriesWithNames.some(cat => 
          cat.categoryType === 'fixed' && cat.hideFromTransactionLists
        );
        if (hasHiddenFixedCategory) {
          return null; // Filter out this transaction
        }
      }

      // Get account information (use custom name if available)
      // Only query if itemId is not null (transactions can have null itemId after account removal)
      const account = transaction.itemId ? await db
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
        .limit(1)
        .then(results => results[0]) : null;

      // Convert date to string if it's a Date object
      const dateValue = transaction.date as unknown;
      const dateStr = dateValue instanceof Date 
        ? (dateValue as Date).toISOString().split('T')[0]
        : String(dateValue);

      // Use customName if it exists and is not empty, otherwise use original name
      const displayName = account?.customName && account.customName.trim() !== '' 
        ? account.customName 
        : (account?.name || null);

      return {
        ...transaction,
        date: dateStr,
        createdAt: (transaction.createdAt as any) instanceof Date 
          ? (transaction.createdAt as Date).toISOString()
          : String(transaction.createdAt),
        updatedAt: (transaction.updatedAt as any) instanceof Date
          ? (transaction.updatedAt as Date).toISOString()
          : String(transaction.updatedAt),
        accountName: displayName,
        accountMask: account?.mask || null,
        categories: categoriesWithNames.map(({ categoryType, hideFromTransactionLists, ...cat }) => cat), // Remove internal fields
      };
    })
  );

  // Filter out null transactions (hidden Fixed categories)
  return transactionsWithCategories.filter((tx) => tx !== null) as TransactionWithCategories[];
}

export async function splitTransaction(
  transactionId: number,
  splits: Array<{ categoryId: number; amount: string }>
) {
  return updateTransactionCategories(transactionId, splits, true);
}

export async function getMerchantHistory(userId: number, merchantName: string | null, limit: number = 5) {
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


export async function removeTransactionCategory(transactionId: number, categoryId: number) {
  await db
    .delete(transactionCategories)
    .where(and(
      eq(transactionCategories.transactionId, transactionId),
      eq(transactionCategories.categoryId, categoryId)
    ));
}

