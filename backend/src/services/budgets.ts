import { db } from '../db';
import { budgets, budgetCategories, plaidItems, plaidTransactions, transactionCategories } from '../db/schema';
import { eq, and, gte, lte, sql } from 'drizzle-orm';
import { syncTransactionsForItem } from './plaid';
import { storeTransaction, assignTransactionCategory } from './transactions';
import { categorizeTransaction } from './categorization';

// System categories that should always exist
const SYSTEM_CATEGORIES = {
  SURPLUS: {
    name: 'Surplus',
    categoryType: 'surplus',
    allocatedAmount: '0',
    accumulatedTotal: '0',
    color: '#28a745'
  },
  EXCLUDED: {
    name: 'Excluded',
    categoryType: 'excluded',
    allocatedAmount: '0',
    accumulatedTotal: '0',
    color: '#6c757d'
  }
};

// Ensure system categories exist for a budget
async function ensureSystemCategories(budgetId: number) {
  // Check and create Surplus if missing
  const [existingSurplus] = await db
    .select()
    .from(budgetCategories)
    .where(and(
      eq(budgetCategories.budgetId, budgetId),
      eq(budgetCategories.categoryType, 'surplus')
    ))
    .limit(1);

  if (!existingSurplus) {
    await db.insert(budgetCategories).values({
      budgetId,
      ...SYSTEM_CATEGORIES.SURPLUS,
      spentAmount: '0',
    });
  }

  // Check and create Excluded if missing
  const [existingExcluded] = await db
    .select()
    .from(budgetCategories)
    .where(and(
      eq(budgetCategories.budgetId, budgetId),
      eq(budgetCategories.categoryType, 'excluded')
    ))
    .limit(1);

  if (!existingExcluded) {
    await db.insert(budgetCategories).values({
      budgetId,
      ...SYSTEM_CATEGORIES.EXCLUDED,
      spentAmount: '0',
    });
  }
}

export async function createBudget(
  userId: number,
  name: string,
  startDate: string,
  endDate: string,
  income: string,
  taxRate?: string,
  filingStatus?: string,
  deductions?: string
) {
  // Check if user already has a budget
  const existingBudget = await getUserBudget(userId);
  if (existingBudget) {
    throw new Error('User already has a budget. Use updateBudget to modify it.');
  }

  const [budget] = await db
    .insert(budgets)
    .values({
      userId,
      name,
      startDate,
      endDate,
      income,
      taxRate: taxRate || '0',
      filingStatus: filingStatus || 'single',
      deductions: deductions || '0',
    })
    .returning();

  // Ensure system categories exist
  await ensureSystemCategories(budget.id);

  // Note: Transaction syncing is handled separately via the /transactions/sync endpoint
  // We don't sync transactions here during budget creation to avoid blocking

  return budget;
}

export async function getUserBudget(userId: number) {
  const [budget] = await db
    .select()
    .from(budgets)
    .where(and(
      eq(budgets.userId, userId),
      eq(budgets.isActive, true)
    ))
    .limit(1);

  // Ensure system categories exist if budget exists
  if (budget) {
    await ensureSystemCategories(budget.id);
  }

  return budget || null;
}

async function getUserBudgetId(userId: number): Promise<number | null> {
  const budget = await getUserBudget(userId);
  return budget?.id || null;
}

export async function updateBudget(
  userId: number,
  updates: {
    name?: string;
    startDate?: string;
    endDate?: string;
    income?: string;
    taxRate?: string;
    filingStatus?: string;
    deductions?: string;
    isActive?: boolean;
  }
) {
  const budget = await getUserBudget(userId);
  if (!budget) {
    throw new Error('Budget not found');
  }

  const [updated] = await db
    .update(budgets)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(budgets.id, budget.id))
    .returning();

  return updated;
}

export async function deleteBudget(userId: number) {
  const budget = await getUserBudget(userId);
  if (!budget) {
    return false;
  }

  await db
    .delete(budgets)
    .where(eq(budgets.id, budget.id));

  return true;
}

export async function createBudgetCategory(
  userId: number,
  name: string,
  allocatedAmount: string,
  categoryType?: string,
  accumulatedTotal?: string,
  color?: string | null,
  // Variable category fields
  autoMoveSurplus?: boolean,
  surplusTargetCategoryId?: number | null,
  autoMoveDeficit?: boolean,
  deficitSourceCategoryId?: number | null,
  // Fixed category fields
  expectedMerchantName?: string | null,
  hideFromTransactionLists?: boolean,
  // Savings category fields
  isTaxDeductible?: boolean,
  isSubjectToFica?: boolean,
  isUnconnectedAccount?: boolean
) {
  const budgetId = await getUserBudgetId(userId);
  if (!budgetId) {
    throw new Error('Budget not found');
  }

  // Don't allow creating system categories
  if (categoryType === 'surplus' || categoryType === 'excluded') {
    throw new Error('Cannot create system categories (Surplus, Excluded)');
  }

  const [category] = await db
    .insert(budgetCategories)
    .values({
      budgetId,
      name,
      allocatedAmount,
      spentAmount: '0',
      categoryType: categoryType || 'variable',
      accumulatedTotal: accumulatedTotal || '0',
      color: color || null,
      autoMoveSurplus: autoMoveSurplus || false,
      surplusTargetCategoryId: surplusTargetCategoryId || null,
      autoMoveDeficit: autoMoveDeficit || false,
      deficitSourceCategoryId: deficitSourceCategoryId || null,
      expectedMerchantName: expectedMerchantName || null,
      hideFromTransactionLists: hideFromTransactionLists || false,
      isTaxDeductible: isTaxDeductible || false,
      isSubjectToFica: isSubjectToFica || false,
      isUnconnectedAccount: isUnconnectedAccount || false,
    })
    .returning();

  return category;
}

// Calculate current month's spending for each category
async function calculateCategorySpending(budgetId: number, userId: number): Promise<Map<number, number>> {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  const startDate = startOfMonth.toISOString().split('T')[0];
  const endDate = endOfMonth.toISOString().split('T')[0];

  // Get all transactions for the current month with their category assignments
  // Only include categories that belong to this budget
  // Use ABS() to handle negative transaction amounts (Plaid uses negative for outflows)
  const spendingData = await db
    .select({
      categoryId: transactionCategories.categoryId,
      amount: sql<string>`SUM(ABS(CAST(${transactionCategories.amount} AS NUMERIC)))`.as('total'),
    })
    .from(transactionCategories)
    .innerJoin(plaidTransactions, eq(transactionCategories.transactionId, plaidTransactions.id))
    .innerJoin(budgetCategories, eq(transactionCategories.categoryId, budgetCategories.id))
    .where(
      and(
        eq(plaidTransactions.userId, userId),
        eq(budgetCategories.budgetId, budgetId),
        gte(plaidTransactions.date, startDate),
        lte(plaidTransactions.date, endDate)
      )
    )
    .groupBy(transactionCategories.categoryId);

  const spendingMap = new Map<number, number>();
  for (const row of spendingData) {
    spendingMap.set(row.categoryId, parseFloat(row.amount) || 0);
  }

  return spendingMap;
}

export async function getBudgetCategories(userId: number): Promise<Array<{
  id: number;
  budgetId: number;
  name: string;
  allocatedAmount: string;
  spentAmount: string;
  categoryType: string;
  accumulatedTotal: string;
  color: string | null;
  autoMoveSurplus: boolean;
  surplusTargetCategoryId: number | null;
  autoMoveDeficit: boolean;
  deficitSourceCategoryId: number | null;
  expectedMerchantName: string | null;
  hideFromTransactionLists: boolean;
  isTaxDeductible: boolean;
  isSubjectToFica: boolean;
  isUnconnectedAccount: boolean;
  createdAt: Date;
  updatedAt: Date;
}> | null> {
  // Get user's budget ID
  const budgetId = await getUserBudgetId(userId);
  if (!budgetId) {
    return null;
  }

  // Ensure system categories exist
  await ensureSystemCategories(budgetId);

  const categories = await db
    .select()
    .from(budgetCategories)
    .where(eq(budgetCategories.budgetId, budgetId));

  // Calculate current month's spending for each category
  const spendingMap = await calculateCategorySpending(budgetId, userId);

  // Update spentAmount for each category
  const categoriesWithSpending = categories.map((category) => {
    const spentAmount = spendingMap.get(category.id) || 0;
    const result = { 
      ...category, 
      spentAmount: spentAmount.toFixed(2)
    };
    // Ensure all fields are present (handle potential null/undefined from database)
    if (result.isTaxDeductible === null || result.isTaxDeductible === undefined) {
      result.isTaxDeductible = false;
    }
    if (result.isSubjectToFica === null || result.isSubjectToFica === undefined) {
      result.isSubjectToFica = false;
    }
    if (result.isUnconnectedAccount === null || result.isUnconnectedAccount === undefined) {
      result.isUnconnectedAccount = false;
    }
    return result;
  });

  return categoriesWithSpending;
}

export async function getBudgetCategoryById(categoryId: number, userId: number) {
  // Get user's budget ID
  const budgetId = await getUserBudgetId(userId);
  if (!budgetId) {
    return null;
  }

  const [category] = await db
    .select()
    .from(budgetCategories)
    .where(and(
      eq(budgetCategories.id, categoryId),
      eq(budgetCategories.budgetId, budgetId)
    ))
    .limit(1);

  return category;
}

export async function updateBudgetCategory(
  categoryId: number,
  userId: number,
  updates: {
    name?: string;
    allocatedAmount?: string;
    spentAmount?: string;
    categoryType?: string;
    accumulatedTotal?: string;
    color?: string | null;
    // Variable category fields
    autoMoveSurplus?: boolean;
    surplusTargetCategoryId?: number | null;
    autoMoveDeficit?: boolean;
    deficitSourceCategoryId?: number | null;
    // Fixed category fields
    expectedMerchantName?: string | null;
    hideFromTransactionLists?: boolean;
    // Savings category fields
    isTaxDeductible?: boolean;
    isSubjectToFica?: boolean;
    isUnconnectedAccount?: boolean;
  }
) {
  // Get user's budget ID
  const budgetId = await getUserBudgetId(userId);
  if (!budgetId) {
    throw new Error('Budget not found');
  }

  // Get the category to check if it's a system category
  const category = await getBudgetCategoryById(categoryId, userId);
  if (!category) {
    throw new Error('Category not found');
  }

  // Don't allow editing system categories (except color for Surplus)
  if (category.categoryType === 'surplus') {
    // Only allow color updates for Surplus
    if (Object.keys(updates).some(key => key !== 'color')) {
      throw new Error('Surplus category can only have its color changed');
    }
  } else if (category.categoryType === 'excluded') {
    throw new Error('Excluded category cannot be modified');
  }

  // Filter out undefined values to avoid issues with Drizzle
  const cleanUpdates: any = {};
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      cleanUpdates[key] = value;
    }
  }
  
  const [updated] = await db
    .update(budgetCategories)
    .set({
      ...cleanUpdates,
      updatedAt: new Date(),
    })
    .where(and(
      eq(budgetCategories.id, categoryId),
      eq(budgetCategories.budgetId, budgetId)
    ))
    .returning();

  return updated;
}

export async function deleteBudgetCategory(categoryId: number, userId: number) {
  // Get user's budget ID
  const budgetId = await getUserBudgetId(userId);
  if (!budgetId) {
    return false;
  }

  // Don't allow deleting system categories
  const category = await getBudgetCategoryById(categoryId, userId);
  if (!category) {
    return false;
  }

  if (category.categoryType === 'surplus' || category.categoryType === 'excluded') {
    throw new Error('System categories (Surplus, Excluded) cannot be deleted');
  }

  await db
    .delete(budgetCategories)
    .where(and(
      eq(budgetCategories.id, categoryId),
      eq(budgetCategories.budgetId, budgetId)
    ));

  return true;
}


export async function getBudgetById(budgetId: number, userId: number) {
  const [budget] = await db
    .select()
    .from(budgets)
    .where(and(
      eq(budgets.id, budgetId),
      eq(budgets.userId, userId)
    ))
    .limit(1);

  return budget || null;
}
