import { db } from '../db';
import {
  budgetCategories,
  budgets,
  fundMovements,
  monthlySnapshots,
  monthEndState,
  plaidTransactions,
  transactionCategories,
} from '../db/schema';
import { eq, and, gte, lte, sql, desc, ne } from 'drizzle-orm';
import { getUserBudget, getRolloverBalance } from './budgets';

// ── Types ──────────────────────────────────────────────────────────────────

type Phase = 'variable_deficits' | 'fixed_deficits' | 'variable_surpluses' | 'summary' | 'completed';

export interface CategoryNetPosition {
  categoryId: number;
  categoryName: string;
  categoryType: string;
  previousRollover: number;
  allotment: number;
  spent: number;
  netPosition: number; // previousRollover + allotment - spent
}

export interface AvailableSource {
  categoryId: number;
  categoryName: string;
  sourceType: 'variable_surplus' | 'variable_rollover' | 'savings_balance';
  availableAmount: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Calculate spending for a specific category in a given month.
 */
async function getMonthSpending(userId: number, categoryId: number, year: number, month: number): Promise<number> {
  const startOfMonth = new Date(year, month - 1, 1);
  const endOfMonth = new Date(year, month, 0, 23, 59, 59);
  const startDate = startOfMonth.toISOString().split('T')[0];
  const endDate = endOfMonth.toISOString().split('T')[0];

  const [result] = await db
    .select({
      total: sql<string>`COALESCE(SUM(ABS(CAST(${transactionCategories.amount} AS NUMERIC))), 0)`.as('total'),
    })
    .from(transactionCategories)
    .innerJoin(plaidTransactions, eq(transactionCategories.transactionId, plaidTransactions.id))
    .where(and(
      eq(plaidTransactions.userId, userId),
      eq(transactionCategories.categoryId, categoryId),
      gte(plaidTransactions.date, startDate),
      lte(plaidTransactions.date, endDate)
    ));

  return parseFloat(result?.total || '0');
}

/**
 * Get fund movements already recorded for a category in a given month.
 * Returns { surplusGiven, deficitReceived } summed from fundMovements.
 */
async function getFundMovementTotals(userId: number, budgetId: number, categoryId: number, year: number, month: number): Promise<{
  surplusGiven: number;
  deficitReceived: number;
}> {
  // Surplus given: movements FROM this category
  const [givenResult] = await db
    .select({
      total: sql<string>`COALESCE(SUM(CAST(${fundMovements.amount} AS NUMERIC)), 0)`.as('total'),
    })
    .from(fundMovements)
    .where(and(
      eq(fundMovements.userId, userId),
      eq(fundMovements.budgetId, budgetId),
      eq(fundMovements.fromCategoryId, categoryId),
      eq(fundMovements.year, year),
      eq(fundMovements.month, month)
    ));

  // Deficit received: movements TO this category
  const [receivedResult] = await db
    .select({
      total: sql<string>`COALESCE(SUM(CAST(${fundMovements.amount} AS NUMERIC)), 0)`.as('total'),
    })
    .from(fundMovements)
    .where(and(
      eq(fundMovements.userId, userId),
      eq(fundMovements.budgetId, budgetId),
      eq(fundMovements.toCategoryId, categoryId),
      eq(fundMovements.year, year),
      eq(fundMovements.month, month)
    ));

  return {
    surplusGiven: parseFloat(givenResult?.total || '0'),
    deficitReceived: parseFloat(receivedResult?.total || '0'),
  };
}

function getProcessedCategories(state: { processedCategories: string | null }): number[] {
  if (!state.processedCategories) return [];
  try {
    return JSON.parse(state.processedCategories);
  } catch {
    return [];
  }
}

function setProcessedCategories(ids: number[]): string {
  return JSON.stringify(ids);
}

// ── Core Functions ─────────────────────────────────────────────────────────

/**
 * Get the net position for a category in a given month.
 */
export async function getCategoryNetPosition(
  categoryId: number, budgetId: number, userId: number, year: number, month: number
): Promise<CategoryNetPosition> {
  const [category] = await db
    .select()
    .from(budgetCategories)
    .where(and(eq(budgetCategories.id, categoryId), eq(budgetCategories.budgetId, budgetId)))
    .limit(1);

  if (!category) throw new Error(`Category ${categoryId} not found`);

  const previousRollover = parseFloat(await getRolloverBalance(categoryId, budgetId, userId));
  const allotment = parseFloat(category.allocatedAmount || '0');
  const spent = await getMonthSpending(userId, categoryId, year, month);
  const netPosition = previousRollover + allotment - spent;

  return {
    categoryId,
    categoryName: category.name,
    categoryType: category.categoryType,
    previousRollover,
    allotment,
    spent,
    netPosition,
  };
}

/**
 * Calculate the adjusted position accounting for fund movements already recorded.
 */
export async function getAdjustedPosition(
  categoryId: number, budgetId: number, userId: number, year: number, month: number
): Promise<number> {
  const pos = await getCategoryNetPosition(categoryId, budgetId, userId, year, month);
  const movements = await getFundMovementTotals(userId, budgetId, categoryId, year, month);
  return pos.netPosition - movements.surplusGiven + movements.deficitReceived;
}

/**
 * Get available sources for deficit coverage, organized by button set.
 * Accounts for fund movements already recorded this month.
 */
export async function getAvailableSources(
  budgetId: number, userId: number, year: number, month: number,
  excludeCategoryId: number, buttonSet: number
): Promise<AvailableSource[]> {
  const allCategories = await db
    .select()
    .from(budgetCategories)
    .where(eq(budgetCategories.budgetId, budgetId));

  const sources: AvailableSource[] = [];

  if (buttonSet === 1) {
    // Set 1: Surplus from other variable categories (only surplus portion)
    const variableCategories = allCategories.filter(
      c => c.categoryType === 'variable' && c.id !== excludeCategoryId
    );
    for (const cat of variableCategories) {
      const adjusted = await getAdjustedPosition(cat.id, budgetId, userId, year, month);
      if (adjusted > 0.01) {
        sources.push({
          categoryId: cat.id,
          categoryName: cat.name,
          sourceType: 'variable_surplus',
          availableAmount: adjusted,
        });
      }
    }
  } else if (buttonSet === 2) {
    // Set 2: Rollover from other variable categories (can't go negative)
    const variableCategories = allCategories.filter(
      c => c.categoryType === 'variable' && c.id !== excludeCategoryId
    );
    for (const cat of variableCategories) {
      const rollover = parseFloat(await getRolloverBalance(cat.id, budgetId, userId));
      // Check how much rollover has already been claimed via fund movements
      const movements = await getFundMovementTotals(userId, budgetId, cat.id, year, month);
      const availableRollover = rollover - movements.surplusGiven;
      if (availableRollover > 0.01) {
        sources.push({
          categoryId: cat.id,
          categoryName: cat.name,
          sourceType: 'variable_rollover',
          availableAmount: availableRollover,
        });
      }
    }
  } else if (buttonSet === 3) {
    // Set 3: Savings category balances
    const savingsCategories = allCategories.filter(c => c.categoryType === 'savings');
    for (const cat of savingsCategories) {
      const rollover = parseFloat(await getRolloverBalance(cat.id, budgetId, userId));
      const movements = await getFundMovementTotals(userId, budgetId, cat.id, year, month);
      const availableBalance = rollover - movements.surplusGiven + movements.deficitReceived;
      if (availableBalance > 0.01) {
        sources.push({
          categoryId: cat.id,
          categoryName: cat.name,
          sourceType: 'savings_balance',
          availableAmount: availableBalance,
        });
      }
    }
  }
  // Set 4 is "Go into debt" — no sources, handled separately

  return sources;
}

// ── State Machine ──────────────────────────────────────────────────────────

/**
 * Initiate month-end processing. Creates the state record and starts Phase 1.
 */
export async function initiateMonthEnd(userId: number, year: number, month: number): Promise<void> {
  const budget = await getUserBudget(userId);
  if (!budget) throw new Error('Budget not found');

  // Check if already exists
  const [existing] = await db
    .select()
    .from(monthEndState)
    .where(and(
      eq(monthEndState.userId, userId),
      eq(monthEndState.year, year),
      eq(monthEndState.month, month)
    ))
    .limit(1);

  if (existing && existing.status === 'completed') {
    console.log(`[MONTH-END] Already completed for user ${userId} ${year}-${month}`);
    return;
  }

  if (existing && existing.status === 'in_progress') {
    // Resume from where we left off
    console.log(`[MONTH-END] Resuming in-progress month-end for user ${userId} ${year}-${month}`);
    await advanceMonthEnd(userId);
    return;
  }

  // Create new state
  await db.insert(monthEndState).values({
    userId,
    budgetId: budget.id,
    year,
    month,
    status: 'in_progress',
    phase: 'variable_deficits',
    processedCategories: '[]',
    remainingAmount: '0',
    currentButtonSet: 1,
  }).onConflictDoUpdate({
    target: [monthEndState.userId, monthEndState.year, monthEndState.month],
    set: {
      status: 'in_progress',
      phase: 'variable_deficits',
      processedCategories: '[]',
      remainingAmount: '0',
      currentButtonSet: 1,
      pendingCategoryId: null,
      slackMessageTs: null,
      slackChannelId: null,
      updatedAt: new Date(),
    },
  });

  console.log(`[MONTH-END] Initiated for user ${userId} ${year}-${month}`);
  await advanceMonthEnd(userId);
}

/**
 * Main state machine driver. Finds the next category to process or advances to the next phase.
 */
export async function advanceMonthEnd(userId: number): Promise<void> {
  const [state] = await db
    .select()
    .from(monthEndState)
    .where(and(
      eq(monthEndState.userId, userId),
      eq(monthEndState.status, 'in_progress')
    ))
    .orderBy(desc(monthEndState.year), desc(monthEndState.month))
    .limit(1);

  if (!state) {
    console.log(`[MONTH-END] No in-progress state for user ${userId}`);
    return;
  }

  const { year, month, budgetId } = state;
  const phase = state.phase as Phase;
  const processed = getProcessedCategories(state);

  const allCategories = await db
    .select()
    .from(budgetCategories)
    .where(eq(budgetCategories.budgetId, budgetId));

  if (phase === 'variable_deficits') {
    // Find next variable category with deficit
    const variableCategories = allCategories.filter(c => c.categoryType === 'variable');
    for (const cat of variableCategories) {
      if (processed.includes(cat.id)) continue;

      const position = await getCategoryNetPosition(cat.id, budgetId, userId, year, month);
      if (position.netPosition < -0.01) {
        // Found a deficit — find first non-empty button set
        const remainingDeficit = Math.abs(position.netPosition);
        let startSet = 1;
        while (startSet < 4) {
          const sources = await getAvailableSources(budgetId, userId, year, month, cat.id, startSet);
          if (sources.length > 0) break;
          startSet++;
        }

        await db
          .update(monthEndState)
          .set({
            pendingCategoryId: cat.id,
            remainingAmount: remainingDeficit.toFixed(2),
            currentButtonSet: startSet,
            updatedAt: new Date(),
          })
          .where(eq(monthEndState.id, state.id));

        const { sendDeficitNotification } = await import('./slack-notifications');
        await sendDeficitNotification(userId, cat.id, position, remainingDeficit, startSet, year, month);
        return; // Wait for user interaction
      } else {
        // No deficit — mark as processed and continue
        processed.push(cat.id);
      }
    }

    // All variable deficits processed — advance to fixed deficits
    await db
      .update(monthEndState)
      .set({
        phase: 'fixed_deficits',
        processedCategories: setProcessedCategories(processed),
        pendingCategoryId: null,
        remainingAmount: '0',
        currentButtonSet: 1,
        updatedAt: new Date(),
      })
      .where(eq(monthEndState.id, state.id));

    await advanceMonthEnd(userId);
  } else if (phase === 'fixed_deficits') {
    // Find next fixed category with deficit
    const fixedCategories = allCategories.filter(c => c.categoryType === 'fixed');
    for (const cat of fixedCategories) {
      if (processed.includes(cat.id)) continue;

      const position = await getCategoryNetPosition(cat.id, budgetId, userId, year, month);
      if (position.netPosition < -0.01) {
        const remainingDeficit = Math.abs(position.netPosition);
        let startSet = 1;
        while (startSet < 4) {
          const sources = await getAvailableSources(budgetId, userId, year, month, cat.id, startSet);
          if (sources.length > 0) break;
          startSet++;
        }

        await db
          .update(monthEndState)
          .set({
            pendingCategoryId: cat.id,
            remainingAmount: remainingDeficit.toFixed(2),
            currentButtonSet: startSet,
            updatedAt: new Date(),
          })
          .where(eq(monthEndState.id, state.id));

        const { sendDeficitNotification } = await import('./slack-notifications');
        await sendDeficitNotification(userId, cat.id, position, remainingDeficit, startSet, year, month);
        return;
      } else {
        processed.push(cat.id);
      }
    }

    // All fixed deficits processed — advance to variable surpluses
    await db
      .update(monthEndState)
      .set({
        phase: 'variable_surpluses',
        processedCategories: setProcessedCategories(processed),
        pendingCategoryId: null,
        remainingAmount: '0',
        currentButtonSet: 1,
        updatedAt: new Date(),
      })
      .where(eq(monthEndState.id, state.id));

    await advanceMonthEnd(userId);
  } else if (phase === 'variable_surpluses') {
    const variableCategories = allCategories.filter(c => c.categoryType === 'variable');

    for (const cat of variableCategories) {
      if (processed.includes(cat.id)) continue;

      const adjusted = await getAdjustedPosition(cat.id, budgetId, userId, year, month);
      if (adjusted > 0.01) {
        // Has remaining surplus after deficit claims
        if (cat.autoSurplusDestination) {
          // Auto-move surplus
          const savingsCategories = allCategories.filter(c => c.categoryType === 'savings');
          // Find the target - autoSurplusDestination could be 'savings' or a category ID
          let targetCategory = savingsCategories[0]; // Default to first savings
          if (cat.autoSurplusDestination !== 'savings' && cat.autoSurplusDestination !== 'surplus') {
            const specificTarget = allCategories.find(c => c.id === parseInt(cat.autoSurplusDestination || ''));
            if (specificTarget) targetCategory = specificTarget;
          }

          if (targetCategory) {
            await db.insert(fundMovements).values({
              userId,
              budgetId,
              fromCategoryId: cat.id,
              toCategoryId: targetCategory.id,
              amount: adjusted.toFixed(2),
              transferType: 'surplus',
              relatedCategoryId: cat.id,
              sourceType: 'variable_surplus',
              isAutomatic: true,
              month,
              year,
            });
            console.log(`[MONTH-END] Auto-moved $${adjusted.toFixed(2)} surplus from ${cat.name} to ${targetCategory.name}`);
          }

          processed.push(cat.id);
        } else {
          // Need user interaction
          await db
            .update(monthEndState)
            .set({
              pendingCategoryId: cat.id,
              remainingAmount: adjusted.toFixed(2),
              updatedAt: new Date(),
            })
            .where(eq(monthEndState.id, state.id));

          const { sendSurplusNotification } = await import('./slack-notifications');
          await sendSurplusNotification(userId, cat.id, adjusted, year, month);
          return; // Wait for user interaction
        }
      } else {
        processed.push(cat.id);
      }
    }

    // Also auto-rollover fixed surpluses (no user interaction needed)
    // Fixed surpluses just roll over automatically — no fund movement needed,
    // the snapshot formula handles it.

    // All surpluses processed — advance to summary
    await db
      .update(monthEndState)
      .set({
        phase: 'summary',
        processedCategories: setProcessedCategories(processed),
        pendingCategoryId: null,
        updatedAt: new Date(),
      })
      .where(eq(monthEndState.id, state.id));

    await advanceMonthEnd(userId);
  } else if (phase === 'summary') {
    await completeSummaryPhase(userId, state.id, budgetId, year, month);
  }
}

/**
 * Handle a deficit button press — user selected a source to cover a deficit.
 */
export async function handleDeficitButtonPress(
  userId: number,
  sourceCategoryId: number,
  sourceType: 'variable_surplus' | 'variable_rollover' | 'savings_balance',
  amount: number
): Promise<{ remainingDeficit: number; advanced: boolean }> {
  const [state] = await db
    .select()
    .from(monthEndState)
    .where(and(
      eq(monthEndState.userId, userId),
      eq(monthEndState.status, 'in_progress')
    ))
    .orderBy(desc(monthEndState.year), desc(monthEndState.month))
    .limit(1);

  if (!state || !state.pendingCategoryId) {
    throw new Error('No pending deficit to resolve');
  }

  const { budgetId, year, month, pendingCategoryId } = state;
  const currentRemaining = parseFloat(state.remainingAmount || '0');

  // Determine how much to actually transfer (can't exceed remaining deficit or source amount)
  const transferAmount = Math.min(amount, currentRemaining);

  // Record fund movement
  await db.insert(fundMovements).values({
    userId,
    budgetId,
    fromCategoryId: sourceCategoryId,
    toCategoryId: pendingCategoryId,
    amount: transferAmount.toFixed(2),
    transferType: 'deficit',
    relatedCategoryId: pendingCategoryId,
    sourceType,
    isAutomatic: false,
    month,
    year,
  });

  const newRemaining = currentRemaining - transferAmount;

  if (newRemaining <= 0.01) {
    // Deficit fully covered — mark category as processed and advance
    const processed = getProcessedCategories(state);
    processed.push(pendingCategoryId);

    await db
      .update(monthEndState)
      .set({
        processedCategories: setProcessedCategories(processed),
        pendingCategoryId: null,
        remainingAmount: '0',
        currentButtonSet: 1,
        updatedAt: new Date(),
      })
      .where(eq(monthEndState.id, state.id));

    // Advance to next category
    await advanceMonthEnd(userId);
    return { remainingDeficit: 0, advanced: true };
  }

  // Deficit partially covered — check if current button set has more sources
  const currentSet = state.currentButtonSet || 1;
  const sources = await getAvailableSources(budgetId, userId, year, month, pendingCategoryId, currentSet);

  if (sources.length === 0 && currentSet < 4) {
    // Current set exhausted, advance to next set
    const nextSet = currentSet + 1;
    // Check if next set has sources (skip empty sets)
    let targetSet = nextSet;
    while (targetSet < 4) {
      const nextSources = await getAvailableSources(budgetId, userId, year, month, pendingCategoryId, targetSet);
      if (nextSources.length > 0) break;
      targetSet++;
    }

    await db
      .update(monthEndState)
      .set({
        remainingAmount: newRemaining.toFixed(2),
        currentButtonSet: targetSet,
        updatedAt: new Date(),
      })
      .where(eq(monthEndState.id, state.id));
  } else {
    // Stay on current set
    await db
      .update(monthEndState)
      .set({
        remainingAmount: newRemaining.toFixed(2),
        updatedAt: new Date(),
      })
      .where(eq(monthEndState.id, state.id));
  }

  return { remainingDeficit: newRemaining, advanced: false };
}

/**
 * Handle surplus button press — user chose where to put surplus.
 */
export async function handleSurplusButtonPress(
  userId: number,
  targetCategoryId: number
): Promise<void> {
  const [state] = await db
    .select()
    .from(monthEndState)
    .where(and(
      eq(monthEndState.userId, userId),
      eq(monthEndState.status, 'in_progress')
    ))
    .orderBy(desc(monthEndState.year), desc(monthEndState.month))
    .limit(1);

  if (!state || !state.pendingCategoryId) {
    throw new Error('No pending surplus to resolve');
  }

  const { budgetId, year, month, pendingCategoryId } = state;
  const surplusAmount = parseFloat(state.remainingAmount || '0');

  // Record fund movement
  await db.insert(fundMovements).values({
    userId,
    budgetId,
    fromCategoryId: pendingCategoryId,
    toCategoryId: targetCategoryId,
    amount: surplusAmount.toFixed(2),
    transferType: 'surplus',
    relatedCategoryId: pendingCategoryId,
    sourceType: 'variable_surplus',
    isAutomatic: false,
    month,
    year,
  });

  // Mark as processed and advance
  const processed = getProcessedCategories(state);
  processed.push(pendingCategoryId);

  await db
    .update(monthEndState)
    .set({
      processedCategories: setProcessedCategories(processed),
      pendingCategoryId: null,
      remainingAmount: '0',
      updatedAt: new Date(),
    })
    .where(eq(monthEndState.id, state.id));

  await advanceMonthEnd(userId);
}

/**
 * Handle "go into debt" button — remaining deficit becomes negative rollover.
 */
export async function handleDebtButtonPress(userId: number): Promise<void> {
  const [state] = await db
    .select()
    .from(monthEndState)
    .where(and(
      eq(monthEndState.userId, userId),
      eq(monthEndState.status, 'in_progress')
    ))
    .orderBy(desc(monthEndState.year), desc(monthEndState.month))
    .limit(1);

  if (!state || !state.pendingCategoryId) {
    throw new Error('No pending deficit to resolve');
  }

  const { pendingCategoryId, budgetId, year, month } = state;
  const remainingDebt = parseFloat(state.remainingAmount || '0');

  // Record debt as a fund movement with sourceType 'debt'
  await db.insert(fundMovements).values({
    userId,
    budgetId,
    fromCategoryId: null, // No source — this is debt
    toCategoryId: pendingCategoryId,
    amount: remainingDebt.toFixed(2),
    transferType: 'deficit',
    relatedCategoryId: pendingCategoryId,
    sourceType: 'debt',
    isAutomatic: false,
    description: 'Went into debt',
    month,
    year,
  });

  // Mark as processed and advance
  const processed = getProcessedCategories(state);
  processed.push(pendingCategoryId);

  await db
    .update(monthEndState)
    .set({
      processedCategories: setProcessedCategories(processed),
      pendingCategoryId: null,
      remainingAmount: '0',
      currentButtonSet: 1,
      updatedAt: new Date(),
    })
    .where(eq(monthEndState.id, state.id));

  await advanceMonthEnd(userId);
}

/**
 * Create monthly snapshots for ALL categories and send summary.
 */
export async function createAllSnapshots(
  userId: number, budgetId: number, year: number, month: number
): Promise<void> {
  const allCategories = await db
    .select()
    .from(budgetCategories)
    .where(eq(budgetCategories.budgetId, budgetId));

  for (const cat of allCategories) {
    // Skip system categories that don't need snapshots
    if (cat.categoryType === 'surplus' || cat.categoryType === 'excluded') continue;

    const previousRollover = parseFloat(await getRolloverBalance(cat.id, budgetId, userId));
    const allotment = parseFloat(cat.allocatedAmount || '0');
    const spent = await getMonthSpending(userId, cat.id, year, month);
    const movements = await getFundMovementTotals(userId, budgetId, cat.id, year, month);

    const finalRolloverBalance = previousRollover + allotment - spent - movements.surplusGiven + movements.deficitReceived;

    // Check if snapshot already exists
    const [existing] = await db
      .select()
      .from(monthlySnapshots)
      .where(and(
        eq(monthlySnapshots.userId, userId),
        eq(monthlySnapshots.budgetId, budgetId),
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
          surplusGiven: movements.surplusGiven.toFixed(2),
          deficitReceived: movements.deficitReceived.toFixed(2),
          finalRolloverBalance: finalRolloverBalance.toFixed(2),
          isLocked: true,
          updatedAt: new Date(),
        })
        .where(eq(monthlySnapshots.id, existing.id));
    } else {
      await db.insert(monthlySnapshots).values({
        userId,
        budgetId,
        categoryId: cat.id,
        year,
        month,
        allotment: allotment.toFixed(2),
        spent: spent.toFixed(2),
        surplusGiven: movements.surplusGiven.toFixed(2),
        deficitReceived: movements.deficitReceived.toFixed(2),
        finalRolloverBalance: finalRolloverBalance.toFixed(2),
        isLocked: true,
      });
    }
  }
}

/**
 * Complete the summary phase: create snapshots, send summary, mark as completed.
 */
async function completeSummaryPhase(
  userId: number, stateId: number, budgetId: number, year: number, month: number
): Promise<void> {
  // Create snapshots for ALL categories
  await createAllSnapshots(userId, budgetId, year, month);

  // Send summary notification
  try {
    const { sendMonthEndSummary } = await import('./slack-notifications');
    await sendMonthEndSummary(userId, budgetId, year, month);
  } catch (error: any) {
    console.error(`[MONTH-END] Error sending summary:`, error);
  }

  // Mark as completed
  await db
    .update(monthEndState)
    .set({
      status: 'completed',
      phase: 'completed',
      pendingCategoryId: null,
      updatedAt: new Date(),
    })
    .where(eq(monthEndState.id, stateId));

  console.log(`[MONTH-END] Completed for user ${userId} ${year}-${month}`);
}
