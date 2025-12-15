import { db } from '../db';
import { 
  plaidTransactions, 
  transactionCategories, 
  budgetCategories, 
  budgetCategorySubcategories,
  plaidAccounts,
  budgets,
  slackOAuth
} from '../db/schema';
import { eq, and, gte, lte, sql, isNull, or } from 'drizzle-orm';
import { createSlackClient } from './slack';
import { getUserAccessToken, getNotificationChannel } from './slack-oauth';
import { assignTransactionCategory } from './transactions';

/**
 * Calculate spending stats for a category or subcategory in the current month
 */
export async function getCategorySpendingStats(
  userId: number,
  budgetId: number,
  categoryId: number,
  subcategoryId: number | null = null
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

  // Calculate spent amount
  let spent = 0;
  if (subcategoryId) {
    // Calculate spending for subcategory
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
          eq(transactionCategories.subcategoryId, subcategoryId),
          gte(plaidTransactions.date, startDate),
          lte(plaidTransactions.date, endDate)
        )
      );

    spent = parseFloat(spendingData[0]?.amount || '0') || 0;

    // Get subcategory allotted amount
    const [subcategory] = await db
      .select()
      .from(budgetCategorySubcategories)
      .where(and(
        eq(budgetCategorySubcategories.id, subcategoryId),
        eq(budgetCategorySubcategories.categoryId, categoryId)
      ))
      .limit(1);

    const allotted = parseFloat(subcategory?.expectedAmount || '0') || 0;
    const percentage = allotted > 0 ? (spent / allotted) * 100 : 0;

    return { spent, allotted, percentage };
  } else {
    // Calculate spending for category (includes all transactions, including subcategory ones)
    // This gives total category spending regardless of subcategory
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

    spent = parseFloat(spendingData[0]?.amount || '0') || 0;
    const allotted = parseFloat(category.allocatedAmount || '0') || 0;
    const percentage = allotted > 0 ? (spent / allotted) * 100 : 0;

    return { spent, allotted, percentage };
  }
}

/**
 * Send transaction notification to Slack with interactive buttons
 */
export async function sendTransactionNotification(
  userId: number,
  transactionId: number,
  categoryId: number | null,
  subcategoryId: number | null
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
    const [account] = await db
      .select({
        name: plaidAccounts.name,
        customName: plaidAccounts.customName,
      })
      .from(plaidAccounts)
      .where(and(
        eq(plaidAccounts.accountId, transaction.accountId),
        eq(plaidAccounts.itemId, transaction.itemId)
      ))
      .limit(1);

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

        // Get subcategory name if applicable
        if (subcategoryId) {
          const [subcategory] = await db
            .select()
            .from(budgetCategorySubcategories)
            .where(eq(budgetCategorySubcategories.id, subcategoryId))
            .limit(1);

          if (subcategory) {
            categoryName = `${category.name} - ${subcategory.name}`;
          }
        }

        // Get spending stats
        const stats = await getCategorySpendingStats(userId, budget.id, categoryId, subcategoryId);
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
          eq(budgetCategories.categoryType, 'expected'),
          eq(budgetCategories.categoryType, 'savings'),
          eq(budgetCategories.categoryType, 'excluded')
        )
      ));

    // Build list of buttons: for categories with subcategories, show subcategories; otherwise show category
    interface ButtonOption {
      text: string;
      categoryId: number;
      subcategoryId: number | null;
    }

    const buttonOptions: ButtonOption[] = [];

    for (const cat of allCategories) {
      // Skip current category
      if (cat.id === categoryId) {
        continue;
      }

      // Check if category has subcategories
      const subcategories = await db
        .select()
        .from(budgetCategorySubcategories)
        .where(eq(budgetCategorySubcategories.categoryId, cat.id));

      if (subcategories.length > 0) {
        // Add buttons for each subcategory
        for (const subcat of subcategories) {
          buttonOptions.push({
            text: `${cat.name} - ${subcat.name}`,
            categoryId: cat.id,
            subcategoryId: subcat.id
          });
        }
      } else {
        // Add button for category itself
        buttonOptions.push({
          text: cat.name,
          categoryId: cat.id,
          subcategoryId: null
        });
      }
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
      categoryName,
      merchant,
      amountDisplay
    ];

    // Add budget status if category is assigned
    if (categoryId && allotted > 0) {
      messageLines.push(`$${spent.toFixed(2)} / $${allotted.toFixed(2)} (${percentage.toFixed(1)}%)`);
      
      // Show progress bar if 100% or less, red X if over 100%
      if (percentage <= 100) {
        // Add ASCII progress bar (20 characters wide to fit phone screens)
        const barWidth = 20;
        const filled = Math.round((percentage / 100) * barWidth);
        const empty = barWidth - filled;
        const filledBar = '█'.repeat(filled);
        const emptyBar = '░'.repeat(empty);
        messageLines.push(`[${filledBar}${emptyBar}] ${percentage.toFixed(0)}%`);
      } else {
        // Show red X emoji if over budget
        messageLines.push('❌ Over budget');
      }
    }

    const blocks = [
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
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
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
        value: `category_${transactionId}_${option.categoryId}${option.subcategoryId ? `_${option.subcategoryId}` : ''}`,
        action_id: `transaction_category_${option.categoryId}${option.subcategoryId ? `_${option.subcategoryId}` : ''}`
      };

      if (buttonsInCurrentBlock < maxButtonsPerBlock) {
        currentBlock.elements.push(button);
        buttonsInCurrentBlock++;
      } else {
        // Create new action block
        blocks.push(currentBlock);
        currentBlock = {
          type: 'actions' as const,
          elements: [button]
        };
        buttonsInCurrentBlock = 1;
      }
    }

    // Add the last action block if it has buttons
    if (currentBlock.elements.length > 0) {
      blocks.push(currentBlock);
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
    });

    // Send message with blocks
    const slackClient = createSlackClient(accessToken);

    await slackClient.chat.postMessage({
      channel: notificationChannelId,
      text: fallbackText, // Fallback text for push notifications (includes key info)
      blocks: blocks
    });

  } catch (error: any) {
    console.error('Error sending transaction notification to Slack:', error);
    // Don't throw - we don't want to fail the webhook if Slack fails
  }
}

