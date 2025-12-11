import OpenAI from 'openai';
import * as dotenv from 'dotenv';
import { getMerchantHistory } from './transactions';
import { getBudgetCategories, getUserBudget } from './budgets';

dotenv.config();

let openai: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }
    openai = new OpenAI({
      apiKey,
    });
  }
  return openai;
}

export interface CategorizeTransactionParams {
  amount: number;
  merchantName: string | null;
  plaidCategory: string[] | null;
  userId: number;
  budgetId?: number; // Optional - will be fetched from user's budget if not provided
  transactionName?: string | null; // Transaction name for transfer detection
}

/**
 * Detects if a transaction is a transfer or credit card payment that should be excluded
 */
function detectTransferTransaction(
  merchantName: string | null,
  plaidCategory: string[] | null,
  transactionName: string | null
): boolean {
  const name = (transactionName || merchantName || '').toUpperCase();
  
  // Check Plaid category for transfer patterns
  if (plaidCategory && Array.isArray(plaidCategory)) {
    const categoryStr = plaidCategory.join(' ').toUpperCase();
    if (
      categoryStr.includes('TRANSFER_IN') ||
      categoryStr.includes('TRANSFER_OUT') ||
      categoryStr.includes('LOAN_PAYMENTS') ||
      categoryStr.includes('CREDIT_CARD_PAYMENT') ||
      categoryStr.includes('PAYMENT')
    ) {
      return true;
    }
  }
  
  // Check merchant/transaction name for transfer patterns
  const transferKeywords = [
    'TRANSFER',
    'PAYMENT',
    'PAY',
    'CREDIT CARD',
    'CARD PAYMENT',
    'AUTOPAY',
    'AUTO PAY',
    'PAYMENT TO',
    'TRANSFER TO',
    'TRANSFER FROM',
  ];
  
  for (const keyword of transferKeywords) {
    if (name.includes(keyword)) {
      return true;
    }
  }
  
  return false;
}

export async function categorizeTransaction(params: CategorizeTransactionParams): Promise<number | null> {
  const { amount, merchantName, plaidCategory, userId, budgetId: providedBudgetId, transactionName } = params;

  // Get user's budget ID if not provided
  let budgetId = providedBudgetId;
  if (!budgetId) {
    const budget = await getUserBudget(userId);
    if (!budget) {
      return null; // No budget exists
    }
    budgetId = budget.id;
  }

  // Get available budget categories
  const allCategories = await getBudgetCategories(userId);
  if (!allCategories || allCategories.length === 0) {
    return null;
  }

  // Filter out Surplus category - it should not be used for regular spending transactions
  const categories = allCategories.filter(cat => cat.categoryType !== 'surplus');
  if (categories.length === 0) {
    return null; // No valid categories available
  }

  // Check if this is a transfer transaction - if so, return Excluded category
  if (detectTransferTransaction(merchantName, plaidCategory, transactionName)) {
    const excludedCategory = categories.find(cat => cat.categoryType === 'excluded');
    if (excludedCategory) {
      return excludedCategory.id;
    }
  }

  // Get merchant history (last 3 transactions)
  const merchantHistory = merchantName ? await getMerchantHistory(userId, merchantName, 3) : [];

  // Get user's category overrides (we'll add this later, for now empty array)
  const userOverrides: any[] = []; // TODO: Get from transactionCategoryOverrides

  // Format merchant history for prompt
  const historyText = merchantHistory.length > 0
    ? merchantHistory.map((tx, idx) => {
        const categoryNames = tx.categories.map(c => c.categoryName).join(', ');
        return `  - Transaction ${idx + 1}: $${tx.amount} on ${tx.date} → Category: "${categoryNames}"`;
      }).join('\n')
    : '  (No history available)';

  // Format categories for prompt (excluding Surplus)
  const categoriesText = categories.map(cat => `  - ID: ${cat.id}, Name: "${cat.name}"${cat.categoryType === 'excluded' ? ' (for transfers/payments)' : ''}`).join('\n');

  // Format overrides for prompt
  const overridesText = userOverrides.length > 0
    ? userOverrides.map(ov => `  - Merchant: "${ov.merchantName}" → Category: "${ov.categoryId}"`).join('\n')
    : '  (No overrides)';

  const prompt = `You are a financial transaction categorizer. Given:
- Current Transaction:
  - Amount: $${amount.toFixed(2)}
  - Merchant: "${merchantName || 'Unknown'}"
  - Plaid Category: ${plaidCategory ? JSON.stringify(plaidCategory) : 'null'}
- Historical Transactions from Same Merchant (last 3):
${historyText}
- User's manual overrides:
${overridesText}
- Available budget categories:
${categoriesText}

IMPORTANT RULES:
1. If this transaction is a transfer between accounts, credit card payment, or similar internal money movement, use the "Excluded" category (it will be in the list above with categoryType 'excluded').
2. DO NOT use "Surplus" category unless this is truly surplus income (like a bonus or unexpected income). Surplus is for leftover money after all expenses, not for regular spending transactions.
3. Choose the most appropriate spending category based on the merchant, amount, and Plaid category.

Based on the historical pattern and available categories, return ONLY the most appropriate budget category ID for this transaction as a number.
If no category matches well, return null.
Return ONLY the number (e.g., 5) or null, nothing else.`;

  try {
    const client = getOpenAIClient();
    const completion = await client.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a financial transaction categorizer. Return only the category ID number or null.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3,
      max_tokens: 10,
    });

    const response = completion.choices[0]?.message?.content?.trim();
    if (!response || response.toLowerCase() === 'null') {
      return null;
    }

    const categoryId = parseInt(response, 10);
    if (isNaN(categoryId)) {
      return null;
    }

    // Verify category exists in budget
    const categoryExists = categories.some(cat => cat.id === categoryId);
    return categoryExists ? categoryId : null;
  } catch (error) {
    console.error('Error categorizing transaction with OpenAI:', error);
    return null;
  }
}

