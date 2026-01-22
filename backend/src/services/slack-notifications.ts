import { db } from '../db';
import { 
  plaidTransactions, 
  transactionCategories, 
  budgetCategories, 
  plaidAccounts,
  budgets,
  monthEndState,
  fundMovements
} from '../db/schema';
import { eq, and, gte, lte, sql, ne } from 'drizzle-orm';
import { createSlackClient } from './slack';
import { getUserAccessToken, getNotificationChannel } from './slack-oauth';
import { assignTransactionCategory } from './transactions';
import { 
  getMonthEndSummary, 
  getCategorySpending,
  getMonthEndState,
  updateMonthEndState,
  initializeMonthEnd,
  processFixedCategoryAuto,
  processVariableDeficitFromRollover,
  processVariableSurplusAuto,
  recordTransfer,
  lockMonth,
  CategoryBalance
} from './month-end';
import { getUserBudget } from './budgets';

/**
 * Calculate spending stats for a category in the current month
 */
export async function getCategorySpendingStats(
  userId: number,
  budgetId: number,
  categoryId: number
): Promise<{
  spent: number;
  allotted: number;
  percentage: number;
}> {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
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
    // Get user's Slack notification channel
    const notificationChannelId = await getNotificationChannel(userId);
    if (!notificationChannelId) {
      console.log(`No Slack notification channel configured for user ${userId}`);
      return;
    }

    // Get user's access token
    const accessToken = await getUserAccessToken(userId);
    if (!accessToken) {
      console.log(`No Slack access token for user ${userId}`);
      return;
    }

    // Get transaction details
    const [transaction] = await db
      .select()
      .from(plaidTransactions)
      .where(eq(plaidTransactions.id, transactionId))
      .limit(1);

    if (!transaction) {
      console.error(`Transaction ${transactionId} not found`);
      return;
    }

    // Get account name (custom or original)
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
      console.error(`No active budget found for user ${userId}`);
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

    // Get all available categories for buttons
    const allCategories = await db
      .select()
      .from(budgetCategories)
      .where(and(
        eq(budgetCategories.budgetId, budget.id),
        ne(budgetCategories.categoryType, 'surplus')
      ));

    // Build list of buttons for categories
    const buttonOptions: Array<{ text: string; categoryId: number }> = [];

    for (const cat of allCategories) {
      if (cat.id === categoryId) continue;
      buttonOptions.push({
        text: cat.name,
        categoryId: cat.id
      });
    }

    buttonOptions.sort((a, b) => a.text.localeCompare(b.text));

    // Format amount
    const rawAmount = parseFloat(transaction.amount);
    const isIncoming = rawAmount < 0;
    const displayAmount = rawAmount > 0 ? rawAmount : Math.abs(rawAmount);
    const amountDisplay = isIncoming ? `+$${displayAmount.toFixed(2)}` : `$${displayAmount.toFixed(2)}`;
    const merchant = transaction.merchantName || transaction.name || 'Unknown';

    const percentText = categoryId && allotted > 0 ? ` (${percentage.toFixed(0)}%)` : '';
    const fallbackText = `${merchant} • ${amountDisplay} • ${categoryName}${percentText}`;

    const messageLines: string[] = [
      categoryName,
      merchant,
      amountDisplay
    ];

    if (categoryId && allotted > 0) {
      messageLines.push(`$${spent.toFixed(2)} / $${allotted.toFixed(2)} (${percentage.toFixed(1)}%)`);
      
      if (percentage <= 100) {
        const barWidth = 20;
        const filled = Math.round((percentage / 100) * barWidth);
        const empty = barWidth - filled;
        const filledBar = '█'.repeat(filled);
        const emptyBar = '░'.repeat(empty);
        messageLines.push(`[${filledBar}${emptyBar}] ${percentage.toFixed(0)}%`);
      } else {
        messageLines.push('❌ Over budget');
      }
    }

    const blocks: any[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: messageLines.join('\n')
        }
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Transaction ID: ${transactionId}`
          }
        ]
      }
    ];

    const firstActionBlock: any = {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '✓ Correct' },
          style: 'primary',
          value: `correct_${transactionId}`,
          action_id: 'transaction_correct'
        }
      ]
    };

    const maxButtonsPerBlock = 5;
    let currentBlock = firstActionBlock;
    let buttonsInCurrentBlock = 1;

    for (const option of buttonOptions) {
      const button = {
        type: 'button',
        text: { type: 'plain_text', text: option.text },
        value: `category_${transactionId}_${option.categoryId}`,
        action_id: `transaction_category_${option.categoryId}`
      };

      if (buttonsInCurrentBlock < maxButtonsPerBlock) {
        currentBlock.elements.push(button);
        buttonsInCurrentBlock++;
      } else {
        blocks.push(currentBlock);
        currentBlock = { type: 'actions', elements: [button] };
        buttonsInCurrentBlock = 1;
      }
    }

    if (currentBlock.elements.length > 0) {
      blocks.push(currentBlock);
    }

    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '✂️ Split' },
          style: 'danger',
          value: `split_${transactionId}`,
          action_id: 'transaction_split'
        }
      ]
    });

    const slackClient = createSlackClient(accessToken);
    await slackClient.chat.postMessage({
      channel: notificationChannelId,
      text: fallbackText,
      blocks: blocks
    });

  } catch (error: any) {
    console.error('Error sending transaction notification to Slack:', error);
  }
}

/**
 * Format currency for display
 */
function formatCurrency(amount: number): string {
  return `$${Math.abs(amount).toFixed(2)}`;
}

/**
 * Send deficit notification message
 */
export async function sendDeficitNotification(
  userId: number,
  category: CategoryBalance,
  remainingDeficit: number,
  year: number,
  month: number,
  availableSources: Array<{ categoryId: number; name: string; amount: number; sourceType: string }>
): Promise<string | null> {
  const notificationChannelId = await getNotificationChannel(userId);
  const accessToken = await getUserAccessToken(userId);
  
  if (!notificationChannelId || !accessToken) {
    console.log(`No Slack configuration for user ${userId}`);
    return null;
  }

  const monthName = new Date(year, month - 1).toLocaleString('default', { month: 'long' });
  const overspendPercent = category.allotment > 0 
    ? ((Math.abs(category.surplus) / category.allotment) * 100).toFixed(1)
    : '0';

  const messageText = [
    `⚠️ *${category.categoryName}* has a deficit of ${formatCurrency(remainingDeficit)} for ${monthName} ${year}`,
    '',
    `• Monthly Allotment: ${formatCurrency(category.allotment)}`,
    `• Monthly Spend: ${formatCurrency(category.spent)}`,
    `• Overspend: ${overspendPercent}%`,
    `• Amount Deficient: ${formatCurrency(remainingDeficit)}`,
    '',
    'Select a source to cover this deficit:'
  ].join('\n');

  // Build buttons for available sources
  const buttons: any[] = [];
  for (const source of availableSources.slice(0, 10)) { // Max 10 buttons
    const label = `${source.name}: ${formatCurrency(source.amount)}`;
    buttons.push({
      type: 'button',
      text: { type: 'plain_text', text: label.substring(0, 75) },
      value: `deficit_${category.categoryId}_${source.categoryId}_${source.sourceType}_${remainingDeficit.toFixed(2)}_${year}_${month}`,
      action_id: `cover_deficit_${source.categoryId}`
    });
  }

  const blocks: any[] = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: messageText }
    }
  ];

  // Add buttons in groups of 5
  for (let i = 0; i < buttons.length; i += 5) {
    blocks.push({
      type: 'actions',
      elements: buttons.slice(i, i + 5)
    });
  }

  const slackClient = createSlackClient(accessToken);
  const result = await slackClient.chat.postMessage({
    channel: notificationChannelId,
    text: `⚠️ ${category.categoryName} has a deficit of ${formatCurrency(remainingDeficit)}`,
    blocks
  });

  return result.ts || null;
}

/**
 * Send surplus notification message
 */
export async function sendSurplusNotification(
  userId: number,
  category: CategoryBalance,
  surplusAmount: number,
  year: number,
  month: number,
  availableDestinations: Array<{ categoryId: number; name: string; type: string }>
): Promise<string | null> {
  const notificationChannelId = await getNotificationChannel(userId);
  const accessToken = await getUserAccessToken(userId);
  
  if (!notificationChannelId || !accessToken) {
    console.log(`No Slack configuration for user ${userId}`);
    return null;
  }

  const monthName = new Date(year, month - 1).toLocaleString('default', { month: 'long' });

  const messageText = [
    `💰 *${category.categoryName}* has a surplus of ${formatCurrency(surplusAmount)} for ${monthName} ${year}`,
    '',
    `• Monthly Allotment: ${formatCurrency(category.allotment)}`,
    `• Monthly Spend: ${formatCurrency(category.spent)}`,
    `• Surplus: ${formatCurrency(surplusAmount)}`,
    '',
    'Where would you like this surplus to go?'
  ].join('\n');

  // Build buttons
  const buttons: any[] = [
    {
      type: 'button',
      text: { type: 'plain_text', text: '📊 Add to Rollover' },
      style: 'primary',
      value: `surplus_${category.categoryId}_rollover_${surplusAmount.toFixed(2)}_${year}_${month}`,
      action_id: 'surplus_to_rollover'
    }
  ];

  for (const dest of availableDestinations.slice(0, 8)) {
    buttons.push({
      type: 'button',
      text: { type: 'plain_text', text: `💰 ${dest.name}`.substring(0, 75) },
      value: `surplus_${category.categoryId}_${dest.categoryId}_${surplusAmount.toFixed(2)}_${year}_${month}`,
      action_id: `surplus_to_${dest.categoryId}`
    });
  }

  const blocks: any[] = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: messageText }
    }
  ];

  for (let i = 0; i < buttons.length; i += 5) {
    blocks.push({
      type: 'actions',
      elements: buttons.slice(i, i + 5)
    });
  }

  const slackClient = createSlackClient(accessToken);
  const result = await slackClient.chat.postMessage({
    channel: notificationChannelId,
    text: `💰 ${category.categoryName} has a surplus of ${formatCurrency(surplusAmount)}`,
    blocks
  });

  return result.ts || null;
}

/**
 * Send the final summary message with lock button
 */
export async function sendSummaryMessage(
  userId: number,
  year: number,
  month: number
): Promise<string | null> {
  const notificationChannelId = await getNotificationChannel(userId);
  const accessToken = await getUserAccessToken(userId);
  
  if (!notificationChannelId || !accessToken) {
    return null;
  }

  const summary = await getMonthEndSummary(userId, year, month);
  const budget = await getUserBudget(userId);
  const monthName = new Date(year, month - 1).toLocaleString('default', { month: 'long' });

  // Get all fund movements for this month
  const movements = await db
    .select()
    .from(fundMovements)
    .where(and(
      eq(fundMovements.userId, userId),
      eq(fundMovements.year, year),
      eq(fundMovements.month, month)
    ));

  // Build the summary text
  const lines: string[] = [
    `📊 *${monthName} ${year} Budget Summary*`,
    '',
    '*Income & Spending*',
    `• Total Earned: ${formatCurrency(summary.totalIncome)}`,
    `• Total Spent: ${formatCurrency(summary.totalSpent)}`,
    `• Net Surplus: ${formatCurrency(summary.totalSurplus)}`,
    ''
  ];

  // Variable Categories
  if (summary.variableCategories.length > 0) {
    lines.push('*Variable Categories*');
    for (const cat of summary.variableCategories) {
      const pct = cat.allotment > 0 ? ((cat.spent / cat.allotment) * 100).toFixed(0) : '0';
      let detail = `• ${cat.categoryName}: ${formatCurrency(cat.spent)}/${formatCurrency(cat.allotment)} (${pct}%)`;
      
      // Find any movements for this category
      const catMovements = movements.filter(m => m.relatedCategoryId === cat.categoryId);
      if (catMovements.length > 0) {
        const move = catMovements[0];
        detail += ` → ${move.description?.split(':')[1] || ''}`;
      }
      lines.push(detail);
    }
    lines.push('');
  }

  // Fixed Bills
  if (summary.fixedCategories.length > 0) {
    lines.push('*Fixed Bills*');
    for (const cat of summary.fixedCategories) {
      const isPaid = cat.spent >= cat.allotment * 0.9; // Consider "paid" if within 90%
      const icon = isPaid ? '✓' : '⚠️';
      let detail = `${icon} ${cat.categoryName}`;
      if (!isPaid || cat.surplus < -0.01) {
        detail += ` - ${formatCurrency(cat.spent)}/${formatCurrency(cat.allotment)}`;
      } else {
        detail += ' - Paid';
      }
      if (cat.rolloverBalance !== 0) {
        detail += ` (rollover: ${formatCurrency(cat.rolloverBalance)})`;
      }
      lines.push(detail);
    }
    lines.push('');
  }

  // Savings
  if (summary.savingsCategories.length > 0) {
    lines.push('*Savings*');
    for (const cat of summary.savingsCategories) {
      lines.push(`• ${cat.categoryName}: ${formatCurrency(cat.rolloverBalance)} (+${formatCurrency(cat.allotment)} this month)`);
    }
    lines.push('');
  }

  const blocks: any[] = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: lines.join('\n') }
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '🔒 Lock These Values In' },
          style: 'primary',
          value: `lock_${year}_${month}`,
          action_id: 'lock_month'
        }
      ]
    }
  ];

  const slackClient = createSlackClient(accessToken);
  const result = await slackClient.chat.postMessage({
    channel: notificationChannelId,
    text: `📊 ${monthName} ${year} Budget Summary`,
    blocks
  });

  return result.ts || null;
}

/**
 * Update a Slack message after user interaction
 */
export async function updateSlackMessage(
  userId: number,
  channelId: string,
  messageTs: string,
  newText: string,
  newBlocks?: any[]
): Promise<void> {
  const accessToken = await getUserAccessToken(userId);
  if (!accessToken) return;

  const slackClient = createSlackClient(accessToken);
  await slackClient.chat.update({
    channel: channelId,
    ts: messageTs,
    text: newText,
    blocks: newBlocks
  });
}

/**
 * Start the month-end reconciliation flow
 */
export async function startMonthEndFlow(
  userId: number,
  year: number,
  month: number
): Promise<void> {
  const notificationChannelId = await getNotificationChannel(userId);
  if (!notificationChannelId) {
    console.log(`No Slack notification channel for user ${userId}`);
    return;
  }

  // Initialize month-end state
  await initializeMonthEnd(userId, year, month, notificationChannelId);

  const budget = await getUserBudget(userId);
  if (!budget) {
    throw new Error('Budget not found');
  }

  // Get all categories
  const allCategories = await db
    .select()
    .from(budgetCategories)
    .where(eq(budgetCategories.budgetId, budget.id));

  // Step 1: Process fixed categories automatically
  const fixedCategories = allCategories.filter(c => c.categoryType === 'fixed');
  const fixedWithDeficit: CategoryBalance[] = [];

  for (const fixed of fixedCategories) {
    const result = await processFixedCategoryAuto(userId, fixed.id, year, month);
    if (result.remainingDeficit > 0.01) {
      const spent = await getCategorySpending(userId, fixed.id, year, month);
      fixedWithDeficit.push({
        categoryId: fixed.id,
        categoryName: fixed.name,
        categoryType: 'fixed',
        allotment: parseFloat(fixed.allocatedAmount || '0'),
        spent,
        surplus: -result.remainingDeficit,
        rolloverBalance: parseFloat(fixed.rolloverBalance || '0'),
        color: fixed.color,
        autoSurplusDestination: null,
        surplusTargetCategoryId: null,
      });
    }
  }

  // Step 2: Process variable categories - handle deficits first (from rollover)
  const variableCategories = allCategories.filter(c => c.categoryType === 'variable');
  const variableWithDeficit: CategoryBalance[] = [];
  const variableWithSurplus: CategoryBalance[] = [];

  for (const variable of variableCategories) {
    const spent = await getCategorySpending(userId, variable.id, year, month);
    const allotment = parseFloat(variable.allocatedAmount || '0');
    const surplus = allotment - spent;

    if (surplus < -0.01) {
      // Deficit - first try to cover from rollover
      const deficitAmount = Math.abs(surplus);
      const result = await processVariableDeficitFromRollover(userId, variable.id, deficitAmount, year, month);
      
      if (result.remainingDeficit > 0.01) {
        variableWithDeficit.push({
          categoryId: variable.id,
          categoryName: variable.name,
          categoryType: 'variable',
          allotment,
          spent,
          surplus: -result.remainingDeficit,
          rolloverBalance: parseFloat(variable.rolloverBalance || '0'),
          color: variable.color,
          autoSurplusDestination: variable.autoSurplusDestination,
          surplusTargetCategoryId: variable.surplusTargetCategoryId,
        });
      }
    } else if (surplus > 0.01) {
      // Check if auto-surplus is configured
      const wasAutoProcessed = await processVariableSurplusAuto(userId, variable.id, surplus, year, month);
      
      if (!wasAutoProcessed) {
        variableWithSurplus.push({
          categoryId: variable.id,
          categoryName: variable.name,
          categoryType: 'variable',
          allotment,
          spent,
          surplus,
          rolloverBalance: parseFloat(variable.rolloverBalance || '0'),
          color: variable.color,
          autoSurplusDestination: variable.autoSurplusDestination,
          surplusTargetCategoryId: variable.surplusTargetCategoryId,
        });
      }
    }
  }

  // Process savings categories - add monthly contribution
  const savingsCategories = allCategories.filter(c => c.categoryType === 'savings');
  for (const savings of savingsCategories) {
    const allotment = parseFloat(savings.allocatedAmount || '0');
    const currentBalance = parseFloat(savings.rolloverBalance || '0');
    
    // Add monthly contribution
    await db
      .update(budgetCategories)
      .set({
        rolloverBalance: (currentBalance + allotment).toFixed(2),
        updatedAt: new Date(),
      })
      .where(eq(budgetCategories.id, savings.id));

    await db.insert(fundMovements).values({
      userId,
      budgetId: budget.id,
      fromCategoryId: null, // Coming from income
      toCategoryId: savings.id,
      amount: allotment.toFixed(2),
      transferType: 'month_end_contribution',
      sourceType: 'surplus',
      relatedCategoryId: savings.id,
      isAutomatic: true,
      month,
      year,
      description: `Monthly savings contribution to ${savings.name}`,
    });
  }

  // Get available sources for deficits (surpluses from other categories + savings)
  const availableSources: Array<{ categoryId: number; name: string; amount: number; sourceType: string }> = [];
  
  for (const s of variableWithSurplus) {
    availableSources.push({
      categoryId: s.categoryId,
      name: `${s.categoryName} Surplus`,
      amount: s.surplus,
      sourceType: 'surplus'
    });
  }

  // Add rollover accounts from other variable categories
  for (const v of variableCategories) {
    if (v.rolloverBalance && parseFloat(v.rolloverBalance) > 0.01) {
      availableSources.push({
        categoryId: v.id,
        name: `${v.name} Rollover`,
        amount: parseFloat(v.rolloverBalance),
        sourceType: 'rollover'
      });
    }
  }

  // Add savings accounts
  for (const s of savingsCategories) {
    const balance = parseFloat(s.rolloverBalance || '0');
    if (balance > 0.01) {
      availableSources.push({
        categoryId: s.id,
        name: s.name,
        amount: balance,
        sourceType: 'savings'
      });
    }
  }

  // Step 3: Send deficit messages (one at a time)
  const allDeficits = [...variableWithDeficit, ...fixedWithDeficit];
  
  if (allDeficits.length > 0) {
    await updateMonthEndState(userId, year, month, {
      currentStep: 'deficits',
      pendingCategoryId: allDeficits[0].categoryId,
      processedCategories: JSON.stringify([]),
    });

    const messageTs = await sendDeficitNotification(
      userId,
      allDeficits[0],
      Math.abs(allDeficits[0].surplus),
      year,
      month,
      availableSources
    );

    if (messageTs) {
      await updateMonthEndState(userId, year, month, {
        status: 'awaiting_input',
        slackMessageTs: messageTs,
      });
    }
  } else if (variableWithSurplus.length > 0) {
    // No deficits, go straight to surpluses
    await updateMonthEndState(userId, year, month, {
      currentStep: 'surpluses',
      pendingCategoryId: variableWithSurplus[0].categoryId,
      processedCategories: JSON.stringify([]),
    });

    const destinations = savingsCategories.map(s => ({
      categoryId: s.id,
      name: s.name,
      type: 'savings'
    }));

    const messageTs = await sendSurplusNotification(
      userId,
      variableWithSurplus[0],
      variableWithSurplus[0].surplus,
      year,
      month,
      destinations
    );

    if (messageTs) {
      await updateMonthEndState(userId, year, month, {
        status: 'awaiting_input',
        slackMessageTs: messageTs,
      });
    }
  } else {
    // No deficits or surpluses to process manually, send summary
    await updateMonthEndState(userId, year, month, {
      currentStep: 'summary',
      status: 'awaiting_input',
    });

    await sendSummaryMessage(userId, year, month);
  }
}

/**
 * Continue month-end flow after user interaction
 */
export async function continueMonthEndFlow(
  userId: number,
  year: number,
  month: number
): Promise<void> {
  const state = await getMonthEndState(userId, year, month);
  if (!state) return;

  const budget = await getUserBudget(userId);
  if (!budget) return;

  const processedIds: number[] = JSON.parse(state.processedCategories || '[]');
  
  // Add current category to processed
  if (state.pendingCategoryId) {
    processedIds.push(state.pendingCategoryId);
    await updateMonthEndState(userId, year, month, {
      processedCategories: JSON.stringify(processedIds),
    });
  }

  // Get all categories
  const allCategories = await db
    .select()
    .from(budgetCategories)
    .where(eq(budgetCategories.budgetId, budget.id));

  const savingsCategories = allCategories.filter(c => c.categoryType === 'savings');

  if (state.currentStep === 'deficits') {
    // Check for more deficits
    const variableCategories = allCategories.filter(c => c.categoryType === 'variable');
    const remainingDeficits: CategoryBalance[] = [];

    for (const v of variableCategories) {
      if (processedIds.includes(v.id)) continue;
      
      const spent = await getCategorySpending(userId, v.id, year, month);
      const allotment = parseFloat(v.allocatedAmount || '0');
      const rollover = parseFloat(v.rolloverBalance || '0');
      const surplus = allotment - spent;

      if (surplus < -0.01 && rollover + surplus < 0) {
        remainingDeficits.push({
          categoryId: v.id,
          categoryName: v.name,
          categoryType: 'variable',
          allotment,
          spent,
          surplus,
          rolloverBalance: rollover,
          color: v.color,
          autoSurplusDestination: v.autoSurplusDestination,
          surplusTargetCategoryId: v.surplusTargetCategoryId,
        });
      }
    }

    if (remainingDeficits.length > 0) {
      // Send next deficit message
      const nextDeficit = remainingDeficits[0];
      
      // Get available sources
      const availableSources: Array<{ categoryId: number; name: string; amount: number; sourceType: string }> = [];
      
      for (const v of variableCategories) {
        const spent = await getCategorySpending(userId, v.id, year, month);
        const allotment = parseFloat(v.allocatedAmount || '0');
        const surplus = allotment - spent;
        
        if (surplus > 0.01) {
          availableSources.push({
            categoryId: v.id,
            name: `${v.name} Surplus`,
            amount: surplus,
            sourceType: 'surplus'
          });
        }
        
        if (v.rolloverBalance && parseFloat(v.rolloverBalance) > 0.01) {
          availableSources.push({
            categoryId: v.id,
            name: `${v.name} Rollover`,
            amount: parseFloat(v.rolloverBalance),
            sourceType: 'rollover'
          });
        }
      }

      for (const s of savingsCategories) {
        const balance = parseFloat(s.rolloverBalance || '0');
        if (balance > 0.01) {
          availableSources.push({
            categoryId: s.id,
            name: s.name,
            amount: balance,
            sourceType: 'savings'
          });
        }
      }

      await updateMonthEndState(userId, year, month, {
        pendingCategoryId: nextDeficit.categoryId,
      });

      const messageTs = await sendDeficitNotification(
        userId,
        nextDeficit,
        Math.abs(nextDeficit.surplus),
        year,
        month,
        availableSources
      );

      if (messageTs) {
        await updateMonthEndState(userId, year, month, {
          slackMessageTs: messageTs,
        });
      }
    } else {
      // Move to surpluses
      await updateMonthEndState(userId, year, month, {
        currentStep: 'surpluses',
        processedCategories: '[]',
        pendingCategoryId: null,
      });

      await continueMonthEndFlow(userId, year, month);
    }
  } else if (state.currentStep === 'surpluses') {
    // Check for remaining surpluses
    const variableCategories = allCategories.filter(c => c.categoryType === 'variable');
    const remainingSurpluses: CategoryBalance[] = [];

    for (const v of variableCategories) {
      if (processedIds.includes(v.id)) continue;
      if (v.autoSurplusDestination) continue; // Already auto-processed
      
      const spent = await getCategorySpending(userId, v.id, year, month);
      const allotment = parseFloat(v.allocatedAmount || '0');
      const surplus = allotment - spent;

      if (surplus > 0.01) {
        remainingSurpluses.push({
          categoryId: v.id,
          categoryName: v.name,
          categoryType: 'variable',
          allotment,
          spent,
          surplus,
          rolloverBalance: parseFloat(v.rolloverBalance || '0'),
          color: v.color,
          autoSurplusDestination: v.autoSurplusDestination,
          surplusTargetCategoryId: v.surplusTargetCategoryId,
        });
      }
    }

    if (remainingSurpluses.length > 0) {
      const nextSurplus = remainingSurpluses[0];
      
      const destinations = savingsCategories.map(s => ({
        categoryId: s.id,
        name: s.name,
        type: 'savings'
      }));

      await updateMonthEndState(userId, year, month, {
        pendingCategoryId: nextSurplus.categoryId,
      });

      const messageTs = await sendSurplusNotification(
        userId,
        nextSurplus,
        nextSurplus.surplus,
        year,
        month,
        destinations
      );

      if (messageTs) {
        await updateMonthEndState(userId, year, month, {
          slackMessageTs: messageTs,
        });
      }
    } else {
      // All done, send summary
      await updateMonthEndState(userId, year, month, {
        currentStep: 'summary',
        pendingCategoryId: null,
      });

      await sendSummaryMessage(userId, year, month);
    }
  }
}

// Legacy export for backwards compatibility
export async function sendVariableSurplusDeficitNotification(
  userId: number,
  variableCategoryId: number,
  movementType: 'surplus' | 'deficit',
  amount: number,
  year: number,
  month: number
): Promise<void> {
  // This is now handled by the new flow
  console.log(`Legacy notification call: ${movementType} of ${amount} for category ${variableCategoryId}`);
}
