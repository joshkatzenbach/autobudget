import { db } from '../db';
import { 
  budgetCategories, 
  budgets, 
  fundMovements, 
  savingsSnapshots, 
  monthlyCategorySummaries,
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
      if (variableCat.autoMoveSurplus && variableCat.surplusTargetCategoryId) {
        // Auto-move surplus to target savings category
        const targetCategory = allCategories.find(c => c.id === variableCat.surplusTargetCategoryId);
        if (targetCategory && targetCategory.categoryType === 'savings') {
          // Create fund movement record
          await db.insert(fundMovements).values({
            userId,
            budgetId,
            fromCategoryId: variableCat.id,
            toCategoryId: targetCategory.id,
            amount: difference.toFixed(2),
            movementType: 'surplus',
            variableCategoryId: variableCat.id,
            month,
            year,
          });

          // Update target savings category accumulatedTotal
          const newAccumulated = parseFloat(targetCategory.accumulatedTotal || '0') + difference;
          await db
            .update(budgetCategories)
            .set({
              accumulatedTotal: newAccumulated.toFixed(2),
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
      if (variableCat.autoMoveDeficit && variableCat.deficitSourceCategoryId) {
        // Auto-move deficit from source savings category
        const sourceCategory = allCategories.find(c => c.id === variableCat.deficitSourceCategoryId);
        if (sourceCategory && sourceCategory.categoryType === 'savings') {
          const currentAccumulated = parseFloat(sourceCategory.accumulatedTotal || '0');
          if (currentAccumulated >= deficitAmount) {
            // Create fund movement record
            await db.insert(fundMovements).values({
              userId,
              budgetId,
              fromCategoryId: sourceCategory.id,
              toCategoryId: variableCat.id,
              amount: deficitAmount.toFixed(2),
              movementType: 'deficit',
              variableCategoryId: variableCat.id,
              month,
              year,
            });

            // Update source savings category accumulatedTotal
            const newAccumulated = currentAccumulated - deficitAmount;
            await db
              .update(budgetCategories)
              .set({
                accumulatedTotal: newAccumulated.toFixed(2),
                updatedAt: new Date(),
              })
              .where(eq(budgetCategories.id, sourceCategory.id));

            variableMovements++;
          } else {
            console.log(`Insufficient funds in source category ${sourceCategory.name} for deficit of $${deficitAmount.toFixed(2)}`);
          }
        }
      } else {
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
  }

  // Process Savings categories - create snapshots
  const savingsCategories = allCategories.filter(cat => cat.categoryType === 'savings');
  for (const savingsCat of savingsCategories) {
    const accumulatedTotal = parseFloat(savingsCat.accumulatedTotal || '0');

    // Check if snapshot already exists
    const [existing] = await db
      .select()
      .from(savingsSnapshots)
      .where(and(
        eq(savingsSnapshots.userId, userId),
        eq(savingsSnapshots.budgetId, budgetId),
        eq(savingsSnapshots.categoryId, savingsCat.id),
        eq(savingsSnapshots.year, year),
        eq(savingsSnapshots.month, month)
      ))
      .limit(1);

    if (existing) {
      // Update existing snapshot
      await db
        .update(savingsSnapshots)
        .set({
          accumulatedTotal: accumulatedTotal.toFixed(2),
        })
        .where(eq(savingsSnapshots.id, existing.id));
    } else {
      // Create new snapshot
      await db.insert(savingsSnapshots).values({
        userId,
        budgetId,
        categoryId: savingsCat.id,
        year,
        month,
        accumulatedTotal: accumulatedTotal.toFixed(2),
      });
    }

    savingsSnapshotsCount++;
  }

  // Process Fixed categories - update monthlyCategorySummaries accumulatedTotal
  const fixedCategories = allCategories.filter(cat => cat.categoryType === 'fixed');
  for (const fixedCat of fixedCategories) {
    const stats = await getCategorySpendingStats(userId, budgetId, fixedCat.id);
    const allocated = parseFloat(fixedCat.allocatedAmount || '0');
    const spent = stats.spent;
    const difference = allocated - spent; // Positive = saved, Negative = overspent

    // Update accumulatedTotal in monthlyCategorySummaries
    // First, get or create the monthly summary
    const [existingSummary] = await db
      .select()
      .from(monthlyCategorySummaries)
      .where(and(
        eq(monthlyCategorySummaries.userId, userId),
        eq(monthlyCategorySummaries.budgetId, budgetId),
        eq(monthlyCategorySummaries.categoryId, fixedCat.id),
        eq(monthlyCategorySummaries.year, year),
        eq(monthlyCategorySummaries.month, month)
      ))
      .limit(1);

    if (existingSummary) {
      // Update existing summary
      await db
        .update(monthlyCategorySummaries)
        .set({
          accumulatedTotal: difference.toFixed(2),
          updatedAt: new Date(),
        })
        .where(eq(monthlyCategorySummaries.id, existingSummary.id));
    } else {
      // Create new summary (this should normally exist from generateMonthlySummary, but create if missing)
      await db.insert(monthlyCategorySummaries).values({
        userId,
        budgetId: budgetId,
        categoryId: fixedCat.id,
        year,
        month,
        totalSpent: spent.toFixed(2),
        transactionCount: 0, // Would need to calculate this
        accumulatedTotal: difference.toFixed(2),
      });
    }

    // Also update the category's accumulatedTotal
    const currentAccumulated = parseFloat(fixedCat.accumulatedTotal || '0');
    const newAccumulated = currentAccumulated + difference;
    await db
      .update(budgetCategories)
      .set({
        accumulatedTotal: newAccumulated.toFixed(2),
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
    movementType,
    variableCategoryId,
    month,
    year,
  });

  // Update target/source savings category accumulatedTotal
  const currentAccumulated = parseFloat(targetCategory.accumulatedTotal || '0');
  const newAccumulated = movementType === 'surplus'
    ? currentAccumulated + amount
    : currentAccumulated - amount;

  if (newAccumulated < 0) {
    throw new Error('Insufficient funds in target category');
  }

  await db
    .update(budgetCategories)
    .set({
      accumulatedTotal: newAccumulated.toFixed(2),
      updatedAt: new Date(),
    })
    .where(eq(budgetCategories.id, targetCategoryId));
}
