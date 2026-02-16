import { db } from '../db';
import {
  plaidTransactions,
  transactionCategories,
  budgetCategories,
  plaidAccounts,
  budgets,
  slackOAuth,
  fundMovements,
  monthEndState,
  monthlySnapshots
} from '../db/schema';
import { eq, and, gte, lte, sql, isNull, or, ne, desc } from 'drizzle-orm';
import { createSlackClient } from './slack';
import { getUserAccessToken, getNotificationChannel } from './slack-oauth';
import { assignTransactionCategory } from './transactions';

/**
 * Calculate spending stats for a category in a given month.
 * If year/month not provided, defaults to current month.
 */
export async function getCategorySpendingStats(
  userId: number,
  budgetId: number,
  categoryId: number,
  year?: number,
  month?: number
): Promise<{
  spent: number;
  allotted: number;
  percentage: number;
}> {
  const now = new Date();
  const y = year ?? now.getFullYear();
  const m = month ?? (now.getMonth() + 1);
  const startOfMonth = new Date(y, m - 1, 1);
  const endOfMonth = new Date(y, m, 0, 23, 59, 59);
  const startDate = startOfMonth.toISOString().split('T')[0];
  const endDate = endOfMonth.toISOString().split('T')[0];

  // Get category info
  const [category] = await db
    .select()
    .from(budgetCategories)
    .where(and(
      eq(budgetCategories.id, categoryId),
      eq(budgetCategories.budgetId, budgetId)
    ))
    .limit(1);

  if (!category) {
    return { spent: 0, allotted: 0, percentage: 0 };
  }

  // Calculate spending for category
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

  const spent = parseFloat(spendingData[0]?.amount || '0') || 0;
  const allotted = parseFloat(category.allocatedAmount || '0') || 0;
  const percentage = allotted > 0 ? (spent / allotted) * 100 : 0;

  return { spent, allotted, percentage };
}

/**
 * Send transaction notification to Slack with interactive buttons
 */
export async function sendTransactionNotification(
  userId: number,
  transactionId: number,
  categoryId: number | null
): Promise<void> {
  try {
    // Notification blocking: suppress during active month-end processing
    const [activeMonthEnd] = await db
      .select()
      .from(monthEndState)
      .where(and(
        eq(monthEndState.userId, userId),
        ne(monthEndState.status, 'completed')
      ))
      .limit(1);

    if (activeMonthEnd) {
      console.log(`[NOTIFICATION] Month-end in progress for user ${userId}, suppressing notification for txn ${transactionId}`);
      return; // Leave notificationSent = false so it can be sent later
    }

    // Get user's Slack notification channel
    const notificationChannelId = await getNotificationChannel(userId);
    if (!notificationChannelId) {
      console.log(`[NOTIFICATION] No Slack channel configured for user ${userId}`);
      return;
    }

    // Get user's access token
    const accessToken = await getUserAccessToken(userId);
    if (!accessToken) {
      console.log(`[NOTIFICATION] No Slack access token for user ${userId}`);
      return;
    }

    // Get transaction details
    const [transaction] = await db
      .select()
      .from(plaidTransactions)
      .where(eq(plaidTransactions.id, transactionId))
      .limit(1);

    if (!transaction) {
      console.error(`[NOTIFICATION] Transaction ${transactionId} not found`);
      return;
    }

    // Check if notification has already been sent
    if (transaction.notificationSent) {
      console.log(`[NOTIFICATION] Transaction ${transactionId} already sent, skipping`);
      return;
    }

    // Get account name (custom or original)
    // Only query if itemId is not null (transactions can have null itemId after account removal)
    const account = transaction.itemId ? await db
      .select({
        name: plaidAccounts.name,
        customName: plaidAccounts.customName,
      })
      .from(plaidAccounts)
      .where(and(
        eq(plaidAccounts.accountId, transaction.accountId),
        eq(plaidAccounts.itemId, transaction.itemId)
      ))
      .limit(1)
      .then(results => results[0]) : null;

    const accountName = account?.customName && account.customName.trim() !== ''
      ? account.customName
      : (account?.name || 'Unknown Account');

    // Get budget ID
    const [budget] = await db
      .select()
      .from(budgets)
      .where(and(
        eq(budgets.userId, userId),
        eq(budgets.isActive, true)
      ))
      .limit(1);

    if (!budget) {
      console.error(`[NOTIFICATION] No active budget for user ${userId}`);
      return;
    }

    // Get category info and stats
    let categoryName = 'Uncategorized';
    let spent = 0;
    let allotted = 0;
    let percentage = 0;

    if (categoryId) {
      const [category] = await db
        .select()
        .from(budgetCategories)
        .where(eq(budgetCategories.id, categoryId))
        .limit(1);

      if (category) {
        categoryName = category.name;

        // Get spending stats
        const stats = await getCategorySpendingStats(userId, budget.id, categoryId);
        spent = stats.spent;
        allotted = stats.allotted;
        percentage = stats.percentage;
      }
    }

    // Get all available categories for buttons (include variable, expected, savings, and excluded)
    // Exclude surplus as it's not a user-selectable category for transactions
    const allCategories = await db
      .select()
      .from(budgetCategories)
      .where(and(
        eq(budgetCategories.budgetId, budget.id),
        or(
          eq(budgetCategories.categoryType, 'variable'),
          eq(budgetCategories.categoryType, 'fixed'),
          eq(budgetCategories.categoryType, 'savings'),
          eq(budgetCategories.categoryType, 'excluded')
        )
      ));

    // Build list of buttons for categories
    interface ButtonOption {
      text: string;
      categoryId: number;
    }

    const buttonOptions: ButtonOption[] = [];

    for (const cat of allCategories) {
      // Skip current category
      if (cat.id === categoryId) {
        continue;
      }

      // Add button for category
      buttonOptions.push({
        text: cat.name,
        categoryId: cat.id
      });
    }

    // Sort alphabetically by text
    buttonOptions.sort((a, b) => a.text.localeCompare(b.text));

    // Format amount following the same paradigm as frontend:
    // See PLAID_AMOUNT_CONVENTION.md for full documentation
    // Plaid convention: positive = debits (outgoing), negative = credits (incoming)
    // Outgoing money: show as positive (no sign)
    // Incoming money: show with + sign
    const rawAmount = parseFloat(transaction.amount);
    const isIncoming = rawAmount < 0;
    const displayAmount = rawAmount > 0 ? rawAmount : Math.abs(rawAmount);
    const amountDisplay = isIncoming ? `+$${displayAmount.toFixed(2)}` : `$${displayAmount.toFixed(2)}`;
    const merchant = transaction.merchantName || transaction.name || 'Unknown';

    // Build fallback text for push notifications (includes merchant, amount, category, and percent filled)
    const percentText = categoryId && allotted > 0 ? ` (${percentage.toFixed(0)}%)` : '';
    const fallbackText = `${merchant} • ${amountDisplay} • ${categoryName}${percentText}`;

    // Build formatted message blocks - simple list format
    const messageLines: string[] = [
      `*${categoryName}*`,
      merchant,
      amountDisplay
    ];

    // Add budget status if category is assigned
    if (categoryId && allotted > 0) {
      messageLines.push(`$${spent.toFixed(2)} / $${allotted.toFixed(2)} (${percentage.toFixed(1)}%)`);
    }

    const blocks: any[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: messageLines.join('\n')
        }
      }
    ];

    // Add context block with transaction ID (less prominent)
    blocks.push({
      type: 'context' as const,
      elements: [
        {
          type: 'mrkdwn' as const,
          text: `Transaction ID: ${transactionId}`
        }
      ]
    });

    // Create action blocks (Slack allows max 5 buttons per action block)
    // First action block with "Correct" button
    const firstActionBlock = {
      type: 'actions' as const,
      elements: [
        {
          type: 'button' as const,
          text: {
            type: 'plain_text' as const,
            text: '✓ Correct'
          },
          style: 'primary' as const,
          value: `correct_${transactionId}`,
          action_id: 'transaction_correct'
        }
      ]
    };

    // Add category/subcategory buttons (max 4 more in first block, then create new blocks as needed)
    const maxButtonsPerBlock = 5;
    let currentBlock = firstActionBlock;
    let buttonsInCurrentBlock = 1; // Already have "Correct" button

    for (const option of buttonOptions) {
      const button = {
        type: 'button' as const,
        text: {
          type: 'plain_text' as const,
          text: option.text
        },
        value: `category_${transactionId}_${option.categoryId}`,
        action_id: `transaction_category_${option.categoryId}`
      } as any;

      if (buttonsInCurrentBlock < maxButtonsPerBlock) {
        currentBlock.elements.push(button);
        buttonsInCurrentBlock++;
      } else {
        // Create new action block
        blocks.push(currentBlock as any);
        currentBlock = {
          type: 'actions' as const,
          elements: [button]
        };
        buttonsInCurrentBlock = 1;
      }
    }

    // Add the last action block if it has buttons
    if (currentBlock.elements.length > 0) {
      blocks.push(currentBlock as any);
    }

    // Add Split button in a separate action block (different color/style)
    blocks.push({
      type: 'actions' as const,
      elements: [
        {
          type: 'button' as const,
          text: {
            type: 'plain_text' as const,
            text: '✂️ Split'
          },
          style: 'danger' as const, // Red/danger style to differentiate
          value: `split_${transactionId}`,
          action_id: 'transaction_split'
        }
      ]
    } as any);

    // Send message with blocks
    const slackClient = createSlackClient(accessToken);

    await slackClient.chat.postMessage({
      channel: notificationChannelId,
      text: fallbackText, // Fallback text for push notifications (includes key info)
      blocks: blocks
    });

    console.log(`[NOTIFICATION] Sent for txn ${transactionId} to channel ${notificationChannelId} (user ${userId})`);

    // Mark notification as sent after successful send
    await db
      .update(plaidTransactions)
      .set({
        notificationSent: true,
        updatedAt: new Date(),
      })
      .where(eq(plaidTransactions.id, transactionId));

  } catch (error: any) {
    console.error(`[NOTIFICATION] Error sending for txn ${transactionId}:`, error);
    // Don't throw - we don't want to fail the webhook if Slack fails
    // Don't mark as sent if there was an error
  }
}

/**
 * Flush deferred notifications after month-end completes.
 * Called from webhook/transaction sync handler — sends any unsent notifications
 * for the current month if month-end is completed.
 */
export async function flushDeferredNotifications(userId: number): Promise<void> {
  try {
    // Check if there's a completed month-end state (any month)
    const [completedMonthEnd] = await db
      .select()
      .from(monthEndState)
      .where(and(
        eq(monthEndState.userId, userId),
        eq(monthEndState.status, 'completed')
      ))
      .orderBy(desc(monthEndState.year), desc(monthEndState.month))
      .limit(1);

    // If no completed month-end, or there's still an active one, skip
    const [activeMonthEnd] = await db
      .select()
      .from(monthEndState)
      .where(and(
        eq(monthEndState.userId, userId),
        ne(monthEndState.status, 'completed')
      ))
      .limit(1);

    if (activeMonthEnd) {
      return; // Still in progress, don't flush
    }

    if (!completedMonthEnd) {
      return; // No completed month-end to flush after
    }

    // Find unsent notifications for this user
    const unsentTransactions = await db
      .select({ id: plaidTransactions.id })
      .from(plaidTransactions)
      .where(and(
        eq(plaidTransactions.userId, userId),
        eq(plaidTransactions.notificationSent, false),
        eq(plaidTransactions.isReviewed, false)
      ))
      .limit(50); // Process in batches

    if (unsentTransactions.length === 0) {
      return;
    }

    console.log(`[NOTIFICATION] Flushing ${unsentTransactions.length} deferred notifications for user ${userId}`);

    for (const txn of unsentTransactions) {
      // Get the category assignment for this transaction
      const [catAssignment] = await db
        .select({ categoryId: transactionCategories.categoryId })
        .from(transactionCategories)
        .where(eq(transactionCategories.transactionId, txn.id))
        .limit(1);

      await sendTransactionNotification(userId, txn.id, catAssignment?.categoryId || null);
    }
  } catch (error: any) {
    console.error(`[NOTIFICATION] Error flushing deferred notifications for user ${userId}:`, error);
  }
}

/**
 * Send a deficit notification with buttons for ONE set at a time.
 * Updates monthEndState with message ts/channel for later updates.
 */
export async function sendDeficitNotification(
  userId: number,
  categoryId: number,
  position: { categoryName: string; previousRollover: number; allotment: number; spent: number; netPosition: number },
  remainingDeficit: number,
  buttonSet: number,
  year: number,
  month: number
): Promise<void> {
  try {
    const notificationChannelId = await getNotificationChannel(userId);
    if (!notificationChannelId) {
      console.log(`[MONTH-END] No Slack channel for user ${userId}, auto-advancing`);
      // No Slack — go into debt and advance
      const { handleDebtButtonPress } = await import('./month-end');
      await handleDebtButtonPress(userId);
      return;
    }

    const accessToken = await getUserAccessToken(userId);
    if (!accessToken) {
      console.log(`[MONTH-END] No Slack token for user ${userId}, auto-advancing`);
      const { handleDebtButtonPress } = await import('./month-end');
      await handleDebtButtonPress(userId);
      return;
    }

    const monthName = new Date(year, month - 1).toLocaleString('default', { month: 'long' });

    // Build breakdown text
    const breakdownLines: string[] = [
      `*${position.categoryName}* — ${monthName} ${year} Deficit`,
      '',
      `Allotment: $${position.allotment.toFixed(2)}`,
      `Spent: $${position.spent.toFixed(2)}`,
    ];

    if (position.previousRollover > 0) {
      breakdownLines.push(`Rollover applied: +$${position.previousRollover.toFixed(2)}`);
    } else if (position.previousRollover < 0) {
      breakdownLines.push(`Debt carried: -$${Math.abs(position.previousRollover).toFixed(2)}`);
    }

    breakdownLines.push(`*Net deficit: $${remainingDeficit.toFixed(2)}*`);

    // Get budget for sources
    const [budget] = await db
      .select()
      .from(budgets)
      .where(and(eq(budgets.userId, userId), eq(budgets.isActive, true)))
      .limit(1);

    if (!budget) return;

    const { getAvailableSources } = await import('./month-end');
    const sources = await getAvailableSources(budget.id, userId, year, month, categoryId, buttonSet);

    const blocks: any[] = [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: breakdownLines.join('\n') }
      }
    ];

    // Set header
    const setHeaders: Record<number, string> = {
      1: 'Choose from variable category surplus:',
      2: 'Choose from variable category rollover:',
      3: 'Choose from savings:',
      4: 'No more sources available.',
    };

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: setHeaders[buttonSet] || '' }
    });

    if (sources.length > 0) {
      // Build buttons for sources (max 5 per action block)
      const buttons: any[] = sources.map((source, i) => ({
        type: 'button',
        text: { type: 'plain_text', text: `${source.categoryName} ($${source.availableAmount.toFixed(2)})` },
        value: JSON.stringify({
          sourceCategoryId: source.categoryId,
          sourceType: source.sourceType,
          amount: source.availableAmount,
        }),
        action_id: `month_end_deficit_cover_${i}`,
      }));

      // Split into action blocks of 5
      for (let i = 0; i < buttons.length; i += 5) {
        blocks.push({
          type: 'actions',
          elements: buttons.slice(i, i + 5),
        });
      }
    }

    // Always show "Skip set" and "Go into debt" buttons
    const controlButtons: any[] = [];
    if (buttonSet < 4 && sources.length > 0) {
      controlButtons.push({
        type: 'button',
        text: { type: 'plain_text', text: 'Skip to next set' },
        value: 'skip_set',
        action_id: 'month_end_skip_set',
      });
    }
    controlButtons.push({
      type: 'button',
      text: { type: 'plain_text', text: 'Go into debt' },
      style: 'danger',
      value: 'go_into_debt',
      action_id: 'month_end_go_into_debt',
    });

    blocks.push({ type: 'actions', elements: controlButtons });

    const slackClient = createSlackClient(accessToken);
    const result = await slackClient.chat.postMessage({
      channel: notificationChannelId,
      text: `${position.categoryName}: $${remainingDeficit.toFixed(2)} deficit for ${monthName} ${year}`,
      blocks: blocks as any,
    });

    // Store message ts and channel for later updates
    await db
      .update(monthEndState)
      .set({
        slackMessageTs: result.ts,
        slackChannelId: notificationChannelId,
        updatedAt: new Date(),
      })
      .where(and(
        eq(monthEndState.userId, userId),
        eq(monthEndState.status, 'in_progress')
      ));

    console.log(`[MONTH-END] Sent deficit notification for ${position.categoryName}`);
  } catch (error: any) {
    console.error(`[MONTH-END] Error sending deficit notification:`, error);
  }
}

/**
 * Update an existing deficit Slack message in-place after a button press.
 */
export async function updateDeficitMessage(
  userId: number,
  categoryId: number,
  remainingDeficit: number,
  buttonSet: number,
  year: number,
  month: number
): Promise<void> {
  try {
    const [state] = await db
      .select()
      .from(monthEndState)
      .where(and(
        eq(monthEndState.userId, userId),
        eq(monthEndState.status, 'in_progress')
      ))
      .limit(1);

    if (!state?.slackMessageTs || !state?.slackChannelId) return;

    const accessToken = await getUserAccessToken(userId);
    if (!accessToken) return;

    const [budget] = await db
      .select()
      .from(budgets)
      .where(and(eq(budgets.userId, userId), eq(budgets.isActive, true)))
      .limit(1);
    if (!budget) return;

    const [category] = await db
      .select()
      .from(budgetCategories)
      .where(eq(budgetCategories.id, categoryId))
      .limit(1);

    const categoryName = category?.name || 'Unknown';
    const monthName = new Date(year, month - 1).toLocaleString('default', { month: 'long' });

    const { getAvailableSources } = await import('./month-end');
    const sources = await getAvailableSources(budget.id, userId, year, month, categoryId, buttonSet);

    const blocks: any[] = [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${categoryName}* — Remaining deficit: *$${remainingDeficit.toFixed(2)}*` }
      }
    ];

    const setHeaders: Record<number, string> = {
      1: 'Choose from variable category surplus:',
      2: 'Choose from variable category rollover:',
      3: 'Choose from savings:',
      4: 'No more sources available.',
    };

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: setHeaders[buttonSet] || '' }
    });

    if (sources.length > 0) {
      const buttons: any[] = sources.map((source, i) => ({
        type: 'button',
        text: { type: 'plain_text', text: `${source.categoryName} ($${source.availableAmount.toFixed(2)})` },
        value: JSON.stringify({
          sourceCategoryId: source.categoryId,
          sourceType: source.sourceType,
          amount: source.availableAmount,
        }),
        action_id: `month_end_deficit_cover_${i}`,
      }));

      for (let i = 0; i < buttons.length; i += 5) {
        blocks.push({ type: 'actions', elements: buttons.slice(i, i + 5) });
      }
    }

    const controlButtons: any[] = [];
    if (buttonSet < 4 && sources.length > 0) {
      controlButtons.push({
        type: 'button',
        text: { type: 'plain_text', text: 'Skip to next set' },
        value: 'skip_set',
        action_id: 'month_end_skip_set',
      });
    }
    controlButtons.push({
      type: 'button',
      text: { type: 'plain_text', text: 'Go into debt' },
      style: 'danger',
      value: 'go_into_debt',
      action_id: 'month_end_go_into_debt',
    });

    blocks.push({ type: 'actions', elements: controlButtons });

    const slackClient = createSlackClient(accessToken);
    await slackClient.chat.update({
      channel: state.slackChannelId,
      ts: state.slackMessageTs,
      text: `${categoryName}: $${remainingDeficit.toFixed(2)} remaining deficit`,
      blocks: blocks as any,
    });
  } catch (error: any) {
    console.error(`[MONTH-END] Error updating deficit message:`, error);
  }
}

/**
 * Send surplus notification — own rollover or savings category buttons.
 */
export async function sendSurplusNotification(
  userId: number,
  categoryId: number,
  surplusAmount: number,
  year: number,
  month: number
): Promise<void> {
  try {
    const notificationChannelId = await getNotificationChannel(userId);
    if (!notificationChannelId) return;

    const accessToken = await getUserAccessToken(userId);
    if (!accessToken) return;

    const [budget] = await db
      .select()
      .from(budgets)
      .where(and(eq(budgets.userId, userId), eq(budgets.isActive, true)))
      .limit(1);
    if (!budget) return;

    const [category] = await db
      .select()
      .from(budgetCategories)
      .where(and(eq(budgetCategories.id, categoryId), eq(budgetCategories.budgetId, budget.id)))
      .limit(1);
    if (!category) return;

    const savingsCategories = await db
      .select()
      .from(budgetCategories)
      .where(and(eq(budgetCategories.budgetId, budget.id), eq(budgetCategories.categoryType, 'savings')));

    const monthName = new Date(year, month - 1).toLocaleString('default', { month: 'long' });

    const blocks: any[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${category.name}* has a surplus of *$${surplusAmount.toFixed(2)}* for ${monthName} ${year}.\n\nWhere would you like to move this surplus?`
        }
      }
    ];

    // Own rollover button + savings category buttons
    const buttons: any[] = [
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Keep as rollover' },
        style: 'primary',
        value: JSON.stringify({ targetCategoryId: categoryId }),
        action_id: 'month_end_surplus_rollover',
      },
    ];

    for (const sav of savingsCategories.slice(0, 4)) {
      buttons.push({
        type: 'button',
        text: { type: 'plain_text', text: sav.name },
        value: JSON.stringify({ targetCategoryId: sav.id }),
        action_id: `month_end_surplus_move_${sav.id}`,
      });
    }

    // Split into action blocks of 5
    for (let i = 0; i < buttons.length; i += 5) {
      blocks.push({ type: 'actions', elements: buttons.slice(i, i + 5) });
    }

    const slackClient = createSlackClient(accessToken);
    const result = await slackClient.chat.postMessage({
      channel: notificationChannelId,
      text: `${category.name}: $${surplusAmount.toFixed(2)} surplus for ${monthName} ${year}`,
      blocks: blocks as any,
    });

    // Store message ts/channel
    await db
      .update(monthEndState)
      .set({
        slackMessageTs: result.ts,
        slackChannelId: notificationChannelId,
        updatedAt: new Date(),
      })
      .where(and(eq(monthEndState.userId, userId), eq(monthEndState.status, 'in_progress')));

    console.log(`[MONTH-END] Sent surplus notification for ${category.name}`);
  } catch (error: any) {
    console.error(`[MONTH-END] Error sending surplus notification:`, error);
  }
}

/**
 * Send a rich month-end summary message.
 */
export async function sendMonthEndSummary(
  userId: number,
  budgetId: number,
  year: number,
  month: number
): Promise<void> {
  try {
    const notificationChannelId = await getNotificationChannel(userId);
    if (!notificationChannelId) return;

    const accessToken = await getUserAccessToken(userId);
    if (!accessToken) return;

    const monthName = new Date(year, month - 1).toLocaleString('default', { month: 'long' });

    // Get all snapshots for this month
    const snapshots = await db
      .select()
      .from(monthlySnapshots)
      .where(and(
        eq(monthlySnapshots.userId, userId),
        eq(monthlySnapshots.budgetId, budgetId),
        eq(monthlySnapshots.year, year),
        eq(monthlySnapshots.month, month)
      ));

    // Get category details for names and types
    const allCategories = await db
      .select()
      .from(budgetCategories)
      .where(eq(budgetCategories.budgetId, budgetId));

    const catMap = new Map(allCategories.map(c => [c.id, c]));

    // Get budget income
    const [budget] = await db
      .select()
      .from(budgets)
      .where(eq(budgets.id, budgetId))
      .limit(1);

    const income = parseFloat(budget?.income || '0');

    let totalSpent = 0;
    let totalAllotted = 0;
    const lines: string[] = [];

    // Variable categories
    const variableSnapshots = snapshots.filter(s => catMap.get(s.categoryId)?.categoryType === 'variable');
    if (variableSnapshots.length > 0) {
      lines.push('*Variable Categories:*');
      for (const snap of variableSnapshots) {
        const cat = catMap.get(snap.categoryId);
        const spent = parseFloat(snap.spent);
        const allotment = parseFloat(snap.allotment);
        const withinBudget = spent <= allotment;
        const pct = allotment > 0 ? ((spent / allotment) * 100).toFixed(0) : '0';
        const icon = withinBudget ? '✅' : '❌';
        lines.push(`${icon} ${cat?.name}: $${spent.toFixed(2)} / $${allotment.toFixed(2)} (${pct}%)`);
        totalSpent += spent;
        totalAllotted += allotment;
      }
      lines.push('');
    }

    // Fixed categories
    const fixedSnapshots = snapshots.filter(s => catMap.get(s.categoryId)?.categoryType === 'fixed');
    if (fixedSnapshots.length > 0) {
      lines.push('*Fixed Categories:*');
      for (const snap of fixedSnapshots) {
        const cat = catMap.get(snap.categoryId);
        const spent = parseFloat(snap.spent);
        const allotment = parseFloat(snap.allotment);
        const rollover = parseFloat(snap.finalRolloverBalance);
        lines.push(`${cat?.name}: $${spent.toFixed(2)} / $${allotment.toFixed(2)} (rollover: $${rollover.toFixed(2)})`);
        totalSpent += spent;
        totalAllotted += allotment;
      }
      lines.push('');
    }

    // Savings categories
    const savingsSnapshots = snapshots.filter(s => catMap.get(s.categoryId)?.categoryType === 'savings');
    if (savingsSnapshots.length > 0) {
      lines.push('*Savings:*');
      for (const snap of savingsSnapshots) {
        const cat = catMap.get(snap.categoryId);
        const balance = parseFloat(snap.finalRolloverBalance);
        lines.push(`${cat?.name}: $${balance.toFixed(2)}`);
      }
      lines.push('');
    }

    // Summary totals
    lines.push('*Summary:*');
    lines.push(`Income: $${income.toFixed(2)}`);
    lines.push(`Total spent: $${totalSpent.toFixed(2)}`);
    lines.push(`Total allotted: $${totalAllotted.toFixed(2)}`);

    const blocks: any[] = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `📊 ${monthName} ${year} Month-End Summary` }
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: lines.join('\n') }
      }
    ];

    const slackClient = createSlackClient(accessToken);
    await slackClient.chat.postMessage({
      channel: notificationChannelId,
      text: `Month-End Summary: ${monthName} ${year}`,
      blocks: blocks as any,
    });

    console.log(`[MONTH-END] Sent summary for ${monthName} ${year}`);
  } catch (error: any) {
    console.error(`[MONTH-END] Error sending summary:`, error);
  }
}

