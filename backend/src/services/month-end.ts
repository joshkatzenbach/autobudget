import { db } from '../db';
import {
  budgetCategories,
  budgets,
  fundMovements,
  savingsSnapshots,
  monthlyCategorySummaries,
  monthlySnapshots,
  slackOAuth
} from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { getUserBudget } from './budgets';
import { getCategorySpendingStats, sendVariableSurplusDeficitNotification } from './slack-notifications';

export interface ProcessMonthEndParams {
  userId: number;
  year: number;
  month: number;
}

/**
 * Process end-of-month operations:
 * 1. Variable categories: Handle surplus/deficit movements
 * 2. Savings categories: Create snapshots
 * 3. Fixed categories: Update accumulated totals in monthlyCategorySummaries
 */
export async function processMonthEnd(params: ProcessMonthEndParams): Promise<{
  variableMovements: number;
  savingsSnapshots: number;
  fixedUpdates: number;
}> {
  const { userId, year, month } = params;

  // Get user's budget
  const budget = await getUserBudget(userId);
  if (!budget) {
    throw new Error('Budget not found');
  }

  const budgetId = budget.id;
  let variableMovements = 0;
  let savingsSnapshotsCount = 0;
  let fixedUpdates = 0;

  // Get all categories for this budget
  const allCategories = await db
    .select()
    .from(budgetCategories)
    .where(eq(budgetCategories.budgetId, budgetId));

  // Process Variable categories
  const variableCategories = allCategories.filter(cat => cat.categoryType === 'variable');
  for (const variableCat of variableCategories) {
    const stats = await getCategorySpendingStats(userId, budgetId, variableCat.id);
    const allocated = parseFloat(variableCat.allocatedAmount || '0');
    const spent = stats.spent;
    const difference = allocated - spent; // Positive = surplus, Negative = deficit

    if (difference > 0.01) {
      // Surplus
      if (variableCat.autoSurplusDestination) {
        // Auto-move surplus based on destination setting
        // Find target category (e.g., a savings category)
        const savingsCategories = allCategories.filter(c => c.categoryType === 'savings');
        const targetCategory = savingsCategories.length > 0 ? savingsCategories[0] : null;
        if (targetCategory) {
          // Create fund movement record
          await db.insert(fundMovements).values({
            userId,
            budgetId,
            fromCategoryId: variableCat.id,
            toCategoryId: targetCategory.id,
            amount: difference.toFixed(2),
            transferType: 'surplus',
            relatedCategoryId: variableCat.id,
            sourceType: 'surplus',
            isAutomatic: true,
            month,
            year,
          });

          // Update target savings category rolloverBalance
          const newRollover = parseFloat(targetCategory.rolloverBalance || '0') + difference;
          await db
            .update(budgetCategories)
            .set({
              rolloverBalance: newRollover.toFixed(2),
              updatedAt: new Date(),
            })
            .where(eq(budgetCategories.id, targetCategory.id));

          variableMovements++;
        }
      } else {
        // Send Slack notification asking user to choose
        await sendVariableSurplusDeficitNotification(
          userId,
          variableCat.id,
          'surplus',
          difference,
          year,
          month
        );
      }
    } else if (difference < -0.01) {
      // Deficit
      const deficitAmount = Math.abs(difference);
      // Send Slack notification asking user to choose
      await sendVariableSurplusDeficitNotification(
        userId,
        variableCat.id,
        'deficit',
        deficitAmount,
        year,
        month
      );
    }
  }

  // Process Savings categories - create monthly snapshots
  const savingsCategories = allCategories.filter(cat => cat.categoryType === 'savings');
  for (const savingsCat of savingsCategories) {
    const rolloverBalance = parseFloat(savingsCat.rolloverBalance || '0');
    const stats = await getCategorySpendingStats(userId, budgetId, savingsCat.id);

    // Check if monthly snapshot already exists
    const [existing] = await db
      .select()
      .from(monthlySnapshots)
      .where(and(
        eq(monthlySnapshots.userId, userId),
        eq(monthlySnapshots.budgetId, budgetId),
        eq(monthlySnapshots.categoryId, savingsCat.id),
        eq(monthlySnapshots.year, year),
        eq(monthlySnapshots.month, month)
      ))
      .limit(1);

    if (existing) {
      // Update existing snapshot
      await db
        .update(monthlySnapshots)
        .set({
          finalRolloverBalance: rolloverBalance.toFixed(2),
          spent: stats.spent.toFixed(2),
          allotment: savingsCat.allocatedAmount,
          updatedAt: new Date(),
        })
        .where(eq(monthlySnapshots.id, existing.id));
    } else {
      // Create new snapshot
      await db.insert(monthlySnapshots).values({
        userId,
        budgetId,
        categoryId: savingsCat.id,
        year,
        month,
        allotment: savingsCat.allocatedAmount,
        spent: stats.spent.toFixed(2),
        finalRolloverBalance: rolloverBalance.toFixed(2),
      });
    }

    savingsSnapshotsCount++;
  }

  // Process Fixed categories - create monthly snapshots and update rollover balance
  const fixedCategories = allCategories.filter(cat => cat.categoryType === 'fixed');
  for (const fixedCat of fixedCategories) {
    const stats = await getCategorySpendingStats(userId, budgetId, fixedCat.id);
    const allocated = parseFloat(fixedCat.allocatedAmount || '0');
    const spent = stats.spent;
    const difference = allocated - spent; // Positive = saved, Negative = overspent

    // Create or update monthly snapshot
    const [existingSnapshot] = await db
      .select()
      .from(monthlySnapshots)
      .where(and(
        eq(monthlySnapshots.userId, userId),
        eq(monthlySnapshots.budgetId, budgetId),
        eq(monthlySnapshots.categoryId, fixedCat.id),
        eq(monthlySnapshots.year, year),
        eq(monthlySnapshots.month, month)
      ))
      .limit(1);

    const currentRollover = parseFloat(fixedCat.rolloverBalance || '0');
    const newRollover = currentRollover + difference;

    if (existingSnapshot) {
      await db
        .update(monthlySnapshots)
        .set({
          allotment: fixedCat.allocatedAmount,
          spent: spent.toFixed(2),
          finalRolloverBalance: newRollover.toFixed(2),
          updatedAt: new Date(),
        })
        .where(eq(monthlySnapshots.id, existingSnapshot.id));
    } else {
      await db.insert(monthlySnapshots).values({
        userId,
        budgetId,
        categoryId: fixedCat.id,
        year,
        month,
        allotment: fixedCat.allocatedAmount,
        spent: spent.toFixed(2),
        finalRolloverBalance: newRollover.toFixed(2),
      });
    }

    // Update the category's rolloverBalance
    await db
      .update(budgetCategories)
      .set({
        rolloverBalance: newRollover.toFixed(2),
        updatedAt: new Date(),
      })
      .where(eq(budgetCategories.id, fixedCat.id));

    fixedUpdates++;
  }

  return {
    variableMovements,
    savingsSnapshots: savingsSnapshotsCount,
    fixedUpdates,
  };
}

/**
 * Process a Variable category surplus/deficit movement from Slack interaction
 */
export async function processVariableMovement(
  userId: number,
  variableCategoryId: number,
  targetCategoryId: number,
  movementType: 'surplus' | 'deficit',
  amount: number,
  year: number,
  month: number
): Promise<void> {

  // Get budget
  const budget = await getUserBudget(userId);
  if (!budget) {
    throw new Error('Budget not found');
  }

  // Get categories
  const [variableCategory] = await db
    .select()
    .from(budgetCategories)
    .where(and(
      eq(budgetCategories.id, variableCategoryId),
      eq(budgetCategories.budgetId, budget.id)
    ))
    .limit(1);

  const [targetCategory] = await db
    .select()
    .from(budgetCategories)
    .where(and(
      eq(budgetCategories.id, targetCategoryId),
      eq(budgetCategories.budgetId, budget.id)
    ))
    .limit(1);

  if (!variableCategory || !targetCategory) {
    throw new Error('Category not found');
  }

  if (targetCategory.categoryType !== 'savings') {
    throw new Error('Target category must be a savings category');
  }

  // Create fund movement record
  await db.insert(fundMovements).values({
    userId,
    budgetId: budget.id,
    fromCategoryId: movementType === 'surplus' ? variableCategoryId : targetCategoryId,
    toCategoryId: movementType === 'surplus' ? targetCategoryId : variableCategoryId,
    amount: amount.toFixed(2),
    transferType: movementType,
    relatedCategoryId: variableCategoryId,
    sourceType: movementType === 'surplus' ? 'surplus' : 'savings',
    isAutomatic: false,
    month,
    year,
  });

  // Update target/source savings category rolloverBalance
  const currentRollover = parseFloat(targetCategory.rolloverBalance || '0');
  const newRollover = movementType === 'surplus'
    ? currentRollover + amount
    : currentRollover - amount;

  if (newRollover < 0) {
    throw new Error('Insufficient funds in target category');
  }

  await db
    .update(budgetCategories)
    .set({
      rolloverBalance: newRollover.toFixed(2),
      updatedAt: new Date(),
    })
    .where(eq(budgetCategories.id, targetCategoryId));
}
