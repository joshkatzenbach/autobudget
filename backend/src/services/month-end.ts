import { db } from '../db';
import { 
  budgetCategories, 
  budgets, 
  fundMovements, 
  monthlySnapshots,
  monthEndState,
  plaidTransactions,
  transactionCategories
} from '../db/schema';
import { eq, and, gte, lte, sql } from 'drizzle-orm';
import { getUserBudget } from './budgets';

// Types for month-end processing
export interface ProcessMonthEndParams {
  userId: number;
  year: number;
  month: number;
}

export interface CategoryBalance {
  categoryId: number;
  categoryName: string;
  categoryType: string;
  allotment: number;
  spent: number;
  surplus: number;  // Positive if surplus, negative if deficit
  rolloverBalance: number;
  color: string | null;
  autoSurplusDestination: string | null;
  surplusTargetCategoryId: number | null;
}

export interface MonthEndSummary {
  totalIncome: number;
  totalSpent: number;
  totalSurplus: number;
  variableCategories: CategoryBalance[];
  fixedCategories: CategoryBalance[];
  savingsCategories: CategoryBalance[];
  deficitCategories: CategoryBalance[];
  surplusCategories: CategoryBalance[];
}

/**
 * Calculate spending for a category in a specific month
 */
export async function getCategorySpending(
  userId: number,
  categoryId: number,
  year: number,
  month: number
): Promise<number> {
  const startOfMonth = new Date(year, month - 1, 1);
  const endOfMonth = new Date(year, month, 0, 23, 59, 59);
  const startDate = startOfMonth.toISOString().split('T')[0];
  const endDate = endOfMonth.toISOString().split('T')[0];

  const spendingData = await db
    .select({
      amount: sql<string>`SUM(ABS(CAST(${transactionCategories.amount} AS NUMERIC)))`.as('total'),
    })
    .from(transactionCategories)
    .innerJoin(plaidTransactions, eq(transactionCategories.transactionId, plaidTransactions.id))
    .where(
      and(
        eq(plaidTransactions.userId, userId),
        eq(transactionCategories.categoryId, categoryId),
        gte(plaidTransactions.date, startDate),
        lte(plaidTransactions.date, endDate)
      )
    );

  return parseFloat(spendingData[0]?.amount || '0') || 0;
}

/**
 * Calculate real-time savings balance for a savings category
 * Balance = previous month's final balance + this month's allotment - this month's transactions
 */
export async function calculateSavingsBalance(
  userId: number,
  budgetId: number,
  categoryId: number,
  year: number,
  month: number
): Promise<number> {
  // Get the category
  const [category] = await db
    .select()
    .from(budgetCategories)
    .where(eq(budgetCategories.id, categoryId))
    .limit(1);

  if (!category || category.categoryType !== 'savings') {
    throw new Error('Category not found or not a savings category');
  }

  // Get previous month's snapshot
  let prevYear = year;
  let prevMonth = month - 1;
  if (prevMonth === 0) {
    prevMonth = 12;
    prevYear = year - 1;
  }

  const [prevSnapshot] = await db
    .select()
    .from(monthlySnapshots)
    .where(and(
      eq(monthlySnapshots.userId, userId),
      eq(monthlySnapshots.budgetId, budgetId),
      eq(monthlySnapshots.categoryId, categoryId),
      eq(monthlySnapshots.year, prevYear),
      eq(monthlySnapshots.month, prevMonth),
      eq(monthlySnapshots.isLocked, true)
    ))
    .limit(1);

  // Previous balance (from last month's snapshot or from rolloverBalance if no snapshot)
  const previousBalance = prevSnapshot 
    ? parseFloat(prevSnapshot.finalRolloverBalance || '0')
    : parseFloat(category.rolloverBalance || '0');

  // This month's allotment
  const allotment = parseFloat(category.allocatedAmount || '0');

  // This month's spending (transactions reduce savings)
  const spent = await getCategorySpending(userId, categoryId, year, month);

  // Current balance
  return previousBalance + allotment - spent;
}

/**
 * Get all category balances for a month
 */
export async function getMonthEndSummary(
  userId: number,
  year: number,
  month: number
): Promise<MonthEndSummary> {
  const budget = await getUserBudget(userId);
  if (!budget) {
    throw new Error('Budget not found');
  }

  const allCategories = await db
    .select()
    .from(budgetCategories)
    .where(eq(budgetCategories.budgetId, budget.id));

  const variableCategories: CategoryBalance[] = [];
  const fixedCategories: CategoryBalance[] = [];
  const savingsCategories: CategoryBalance[] = [];
  const deficitCategories: CategoryBalance[] = [];
  const surplusCategories: CategoryBalance[] = [];

  let totalSpent = 0;

  for (const cat of allCategories) {
    if (cat.categoryType === 'surplus' || cat.categoryType === 'excluded') {
      continue;
    }

    const spent = await getCategorySpending(userId, cat.id, year, month);
    const allotment = parseFloat(cat.allocatedAmount || '0');
    const surplus = allotment - spent;
    const rolloverBalance = parseFloat(cat.rolloverBalance || '0');

    const balance: CategoryBalance = {
      categoryId: cat.id,
      categoryName: cat.name,
      categoryType: cat.categoryType,
      allotment,
      spent,
      surplus,
      rolloverBalance,
      color: cat.color,
      autoSurplusDestination: cat.autoSurplusDestination,
      surplusTargetCategoryId: cat.surplusTargetCategoryId,
    };

    if (cat.categoryType === 'variable') {
      variableCategories.push(balance);
      totalSpent += spent;
      if (surplus < -0.01) {
        deficitCategories.push(balance);
      } else if (surplus > 0.01) {
        surplusCategories.push(balance);
      }
    } else if (cat.categoryType === 'fixed') {
      fixedCategories.push(balance);
      totalSpent += spent;
      // Fixed categories with deficit after rollover deduction
      if (surplus < -0.01 && rolloverBalance + surplus < 0) {
        deficitCategories.push(balance);
      }
    } else if (cat.categoryType === 'savings') {
      // For savings, calculate the real-time balance
      const currentBalance = await calculateSavingsBalance(userId, budget.id, cat.id, year, month);
      balance.rolloverBalance = currentBalance;
      savingsCategories.push(balance);
      totalSpent += allotment; // Savings contribution counts as "spent"
    }
  }

  const totalIncome = parseFloat(budget.income || '0');
  const totalSurplus = totalIncome - totalSpent;

  return {
    totalIncome,
    totalSpent,
    totalSurplus,
    variableCategories,
    fixedCategories,
    savingsCategories,
    deficitCategories,
    surplusCategories,
  };
}

/**
 * Initialize month-end processing state
 */
export async function initializeMonthEnd(
  userId: number,
  year: number,
  month: number,
  slackChannelId: string
): Promise<void> {
  const budget = await getUserBudget(userId);
  if (!budget) {
    throw new Error('Budget not found');
  }

  // Check if month-end already exists
  const [existing] = await db
    .select()
    .from(monthEndState)
    .where(and(
      eq(monthEndState.userId, userId),
      eq(monthEndState.year, year),
      eq(monthEndState.month, month)
    ))
    .limit(1);

  if (existing) {
    // Update existing state
    await db
      .update(monthEndState)
      .set({
        status: 'in_progress',
        currentStep: 'deficits',
        processedCategories: '[]',
        pendingTransfers: '[]',
        slackChannelId,
        updatedAt: new Date(),
      })
      .where(eq(monthEndState.id, existing.id));
  } else {
    // Create new state
    await db.insert(monthEndState).values({
      userId,
      budgetId: budget.id,
      year,
      month,
      status: 'in_progress',
      currentStep: 'deficits',
      processedCategories: '[]',
      pendingTransfers: '[]',
      slackChannelId,
    });
  }
}

/**
 * Get current month-end state
 */
export async function getMonthEndState(
  userId: number,
  year: number,
  month: number
) {
  const [state] = await db
    .select()
    .from(monthEndState)
    .where(and(
      eq(monthEndState.userId, userId),
      eq(monthEndState.year, year),
      eq(monthEndState.month, month)
    ))
    .limit(1);

  return state || null;
}

/**
 * Update month-end state
 */
export async function updateMonthEndState(
  userId: number,
  year: number,
  month: number,
  updates: {
    status?: string;
    currentStep?: string;
    pendingCategoryId?: number | null;
    slackMessageTs?: string | null;
    processedCategories?: string;
    pendingTransfers?: string;
  }
): Promise<void> {
  await db
    .update(monthEndState)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(and(
      eq(monthEndState.userId, userId),
      eq(monthEndState.year, year),
      eq(monthEndState.month, month)
    ));
}

/**
 * Process automatic fixed category surplus/deficit
 * Fixed categories automatically use their rollover account
 */
export async function processFixedCategoryAuto(
  userId: number,
  categoryId: number,
  year: number,
  month: number
): Promise<{ remainingDeficit: number }> {
  const budget = await getUserBudget(userId);
  if (!budget) {
    throw new Error('Budget not found');
  }

  const [category] = await db
    .select()
    .from(budgetCategories)
    .where(and(
      eq(budgetCategories.id, categoryId),
      eq(budgetCategories.budgetId, budget.id)
    ))
    .limit(1);

  if (!category || category.categoryType !== 'fixed') {
    throw new Error('Category not found or not a fixed category');
  }

  const spent = await getCategorySpending(userId, categoryId, year, month);
  const allotment = parseFloat(category.allocatedAmount || '0');
  const surplus = allotment - spent;
  const currentRollover = parseFloat(category.rolloverBalance || '0');

  let newRollover = currentRollover;
  let remainingDeficit = 0;

  if (surplus >= 0) {
    // Surplus - add to rollover automatically
    newRollover = currentRollover + surplus;
    
    // Record the fund movement
    await db.insert(fundMovements).values({
      userId,
      budgetId: budget.id,
      fromCategoryId: categoryId,
      toCategoryId: categoryId, // Self-reference for rollover
      amount: surplus.toFixed(2),
      transferType: 'surplus_to_rollover',
      sourceType: 'surplus',
      relatedCategoryId: categoryId,
      isAutomatic: true,
      month,
      year,
      description: `Fixed category ${category.name}: $${surplus.toFixed(2)} surplus added to rollover`,
    });
  } else {
    // Deficit - try to cover from rollover
    const deficitAmount = Math.abs(surplus);
    
    if (currentRollover >= deficitAmount) {
      // Can fully cover from rollover
      newRollover = currentRollover - deficitAmount;
      
      await db.insert(fundMovements).values({
        userId,
        budgetId: budget.id,
        fromCategoryId: categoryId,
        toCategoryId: categoryId,
        amount: deficitAmount.toFixed(2),
        transferType: 'cover_deficit',
        sourceType: 'rollover',
        relatedCategoryId: categoryId,
        isAutomatic: true,
        month,
        year,
        description: `Fixed category ${category.name}: $${deficitAmount.toFixed(2)} deficit covered from rollover`,
      });
    } else {
      // Partial coverage - use all rollover, deficit remains
      remainingDeficit = deficitAmount - currentRollover;
      
      if (currentRollover > 0) {
        await db.insert(fundMovements).values({
          userId,
          budgetId: budget.id,
          fromCategoryId: categoryId,
          toCategoryId: categoryId,
          amount: currentRollover.toFixed(2),
          transferType: 'cover_deficit',
          sourceType: 'rollover',
          relatedCategoryId: categoryId,
          isAutomatic: true,
          month,
          year,
          description: `Fixed category ${category.name}: $${currentRollover.toFixed(2)} partial deficit covered from rollover`,
        });
      }
      
      newRollover = 0; // Rollover depleted
    }
  }

  // Update category rollover balance
  await db
    .update(budgetCategories)
    .set({
      rolloverBalance: newRollover.toFixed(2),
      updatedAt: new Date(),
    })
    .where(eq(budgetCategories.id, categoryId));

  return { remainingDeficit };
}

/**
 * Process variable category deficit - first try rollover
 */
export async function processVariableDeficitFromRollover(
  userId: number,
  categoryId: number,
  deficitAmount: number,
  year: number,
  month: number
): Promise<{ remainingDeficit: number }> {
  const budget = await getUserBudget(userId);
  if (!budget) {
    throw new Error('Budget not found');
  }

  const [category] = await db
    .select()
    .from(budgetCategories)
    .where(and(
      eq(budgetCategories.id, categoryId),
      eq(budgetCategories.budgetId, budget.id)
    ))
    .limit(1);

  if (!category) {
    throw new Error('Category not found');
  }

  const currentRollover = parseFloat(category.rolloverBalance || '0');
  let remainingDeficit = deficitAmount;
  let newRollover = currentRollover;

  if (currentRollover > 0) {
    const amountFromRollover = Math.min(currentRollover, deficitAmount);
    remainingDeficit = deficitAmount - amountFromRollover;
    newRollover = currentRollover - amountFromRollover;

    await db.insert(fundMovements).values({
      userId,
      budgetId: budget.id,
      fromCategoryId: categoryId,
      toCategoryId: categoryId,
      amount: amountFromRollover.toFixed(2),
      transferType: 'cover_deficit',
      sourceType: 'rollover',
      relatedCategoryId: categoryId,
      isAutomatic: true,
      month,
      year,
      description: `Variable category ${category.name}: $${amountFromRollover.toFixed(2)} deficit covered from rollover`,
    });

    await db
      .update(budgetCategories)
      .set({
        rolloverBalance: newRollover.toFixed(2),
        updatedAt: new Date(),
      })
      .where(eq(budgetCategories.id, categoryId));
  }

  return { remainingDeficit };
}

/**
 * Record a transfer from one category to another (user-initiated via Slack)
 */
export async function recordTransfer(
  userId: number,
  fromCategoryId: number,
  toCategoryId: number,
  amount: number,
  transferType: string,
  sourceType: string,
  year: number,
  month: number,
  description: string
): Promise<void> {
  const budget = await getUserBudget(userId);
  if (!budget) {
    throw new Error('Budget not found');
  }

  // Get categories
  const [fromCategory] = await db
    .select()
    .from(budgetCategories)
    .where(eq(budgetCategories.id, fromCategoryId))
    .limit(1);

  const [toCategory] = await db
    .select()
    .from(budgetCategories)
    .where(eq(budgetCategories.id, toCategoryId))
    .limit(1);

  if (!fromCategory || !toCategory) {
    throw new Error('Category not found');
  }

  // Record the fund movement
  await db.insert(fundMovements).values({
    userId,
    budgetId: budget.id,
    fromCategoryId,
    toCategoryId,
    amount: amount.toFixed(2),
    transferType,
    sourceType,
    relatedCategoryId: toCategoryId, // The category receiving help or giving surplus
    isAutomatic: false,
    month,
    year,
    description,
  });

  // Update balances based on transfer type
  if (sourceType === 'surplus') {
    // Surplus from variable category going to savings or rollover
    // No balance update needed for the source (it's calculated from spending)
    // Update target balance
    const currentBalance = parseFloat(toCategory.rolloverBalance || '0');
    await db
      .update(budgetCategories)
      .set({
        rolloverBalance: (currentBalance + amount).toFixed(2),
        updatedAt: new Date(),
      })
      .where(eq(budgetCategories.id, toCategoryId));
  } else if (sourceType === 'rollover' || sourceType === 'savings') {
    // Money coming from rollover or savings to cover deficit
    const fromBalance = parseFloat(fromCategory.rolloverBalance || '0');
    await db
      .update(budgetCategories)
      .set({
        rolloverBalance: (fromBalance - amount).toFixed(2),
        updatedAt: new Date(),
      })
      .where(eq(budgetCategories.id, fromCategoryId));
  }
}

/**
 * Process automatic surplus for variable category
 */
export async function processVariableSurplusAuto(
  userId: number,
  categoryId: number,
  surplusAmount: number,
  year: number,
  month: number
): Promise<boolean> {
  const budget = await getUserBudget(userId);
  if (!budget) {
    throw new Error('Budget not found');
  }

  const [category] = await db
    .select()
    .from(budgetCategories)
    .where(and(
      eq(budgetCategories.id, categoryId),
      eq(budgetCategories.budgetId, budget.id)
    ))
    .limit(1);

  if (!category || !category.autoSurplusDestination) {
    return false; // No automatic handling configured
  }

  if (category.autoSurplusDestination === 'rollover') {
    // Add to this category's rollover
    const currentRollover = parseFloat(category.rolloverBalance || '0');
    await db
      .update(budgetCategories)
      .set({
        rolloverBalance: (currentRollover + surplusAmount).toFixed(2),
        updatedAt: new Date(),
      })
      .where(eq(budgetCategories.id, categoryId));

    await db.insert(fundMovements).values({
      userId,
      budgetId: budget.id,
      fromCategoryId: categoryId,
      toCategoryId: categoryId,
      amount: surplusAmount.toFixed(2),
      transferType: 'surplus_to_rollover',
      sourceType: 'surplus',
      relatedCategoryId: categoryId,
      isAutomatic: true,
      month,
      year,
      description: `Variable category ${category.name}: $${surplusAmount.toFixed(2)} surplus added to rollover`,
    });

    return true;
  } else if (category.autoSurplusDestination === 'savings' && category.surplusTargetCategoryId) {
    // Move to specified savings category
    const [targetCategory] = await db
      .select()
      .from(budgetCategories)
      .where(eq(budgetCategories.id, category.surplusTargetCategoryId))
      .limit(1);

    if (targetCategory && targetCategory.categoryType === 'savings') {
      const currentBalance = parseFloat(targetCategory.rolloverBalance || '0');
      await db
        .update(budgetCategories)
        .set({
          rolloverBalance: (currentBalance + surplusAmount).toFixed(2),
          updatedAt: new Date(),
        })
        .where(eq(budgetCategories.id, targetCategory.id));

      await db.insert(fundMovements).values({
        userId,
        budgetId: budget.id,
        fromCategoryId: categoryId,
        toCategoryId: targetCategory.id,
        amount: surplusAmount.toFixed(2),
        transferType: 'surplus_to_savings',
        sourceType: 'surplus',
        relatedCategoryId: categoryId,
        isAutomatic: true,
        month,
        year,
        description: `Variable category ${category.name}: $${surplusAmount.toFixed(2)} surplus moved to ${targetCategory.name}`,
      });

      return true;
    }
  }

  return false;
}

/**
 * Create monthly snapshots and lock the month
 */
export async function lockMonth(
  userId: number,
  year: number,
  month: number
): Promise<void> {
  const budget = await getUserBudget(userId);
  if (!budget) {
    throw new Error('Budget not found');
  }

  const allCategories = await db
    .select()
    .from(budgetCategories)
    .where(eq(budgetCategories.budgetId, budget.id));

  for (const cat of allCategories) {
    if (cat.categoryType === 'surplus' || cat.categoryType === 'excluded') {
      continue;
    }

    const spent = await getCategorySpending(userId, cat.id, year, month);
    const allotment = parseFloat(cat.allocatedAmount || '0');
    const rolloverBalance = parseFloat(cat.rolloverBalance || '0');

    // Get fund movements for this category this month
    const movements = await db
      .select()
      .from(fundMovements)
      .where(and(
        eq(fundMovements.userId, userId),
        eq(fundMovements.year, year),
        eq(fundMovements.month, month)
      ));

    let surplusGiven = 0;
    let deficitReceived = 0;

    for (const movement of movements) {
      if (movement.fromCategoryId === cat.id && movement.toCategoryId !== cat.id) {
        surplusGiven += parseFloat(movement.amount || '0');
      }
      if (movement.toCategoryId === cat.id && movement.fromCategoryId !== cat.id) {
        deficitReceived += parseFloat(movement.amount || '0');
      }
    }

    // Check if snapshot already exists
    const [existing] = await db
      .select()
      .from(monthlySnapshots)
      .where(and(
        eq(monthlySnapshots.userId, userId),
        eq(monthlySnapshots.budgetId, budget.id),
        eq(monthlySnapshots.categoryId, cat.id),
        eq(monthlySnapshots.year, year),
        eq(monthlySnapshots.month, month)
      ))
      .limit(1);

    if (existing) {
      await db
        .update(monthlySnapshots)
        .set({
          allotment: allotment.toFixed(2),
          spent: spent.toFixed(2),
          surplusGiven: surplusGiven.toFixed(2),
          deficitReceived: deficitReceived.toFixed(2),
          finalRolloverBalance: rolloverBalance.toFixed(2),
          isLocked: true,
          updatedAt: new Date(),
        })
        .where(eq(monthlySnapshots.id, existing.id));
    } else {
      await db.insert(monthlySnapshots).values({
        userId,
        budgetId: budget.id,
        categoryId: cat.id,
        year,
        month,
        allotment: allotment.toFixed(2),
        spent: spent.toFixed(2),
        surplusGiven: surplusGiven.toFixed(2),
        deficitReceived: deficitReceived.toFixed(2),
        finalRolloverBalance: rolloverBalance.toFixed(2),
        isLocked: true,
      });
    }
  }

  // Update month-end state to completed
  await updateMonthEndState(userId, year, month, {
    status: 'completed',
    currentStep: 'locked',
  });
}

/**
 * Legacy function for backwards compatibility
 * Initiates the new month-end flow
 */
export async function processMonthEnd(params: ProcessMonthEndParams): Promise<{
  message: string;
  status: string;
}> {
  const { userId, year, month } = params;

  // This now just returns info - actual processing happens via Slack flow
  const summary = await getMonthEndSummary(userId, year, month);

  return {
    message: `Month-end ready: ${summary.deficitCategories.length} deficits, ${summary.surplusCategories.length} surpluses to process`,
    status: 'ready',
  };
}
