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

export interface CategorizeTransactionResult {
  categoryId: number | null;
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

export async function categorizeTransaction(params: CategorizeTransactionParams): Promise<CategorizeTransactionResult> {
  const { amount, merchantName, plaidCategory, userId, budgetId: providedBudgetId, transactionName } = params;

  // Get user's budget ID if not provided
  let budgetId = providedBudgetId;
  if (!budgetId) {
    const budget = await getUserBudget(userId);
    if (!budget) {
      return { categoryId: null }; // No budget exists
    }
    budgetId = budget.id;
  }

  // Get available budget categories
  const allCategories = await getBudgetCategories(userId);
  if (!allCategories || allCategories.length === 0) {
    return { categoryId: null };
  }

  // Filter out Surplus category - it should not be used for regular spending transactions
  const categories = allCategories.filter(cat => cat.categoryType !== 'surplus');
  if (categories.length === 0) {
    return { categoryId: null }; // No valid categories available
  }

  // Check if this is a transfer transaction - if so, return Excluded category
  if (detectTransferTransaction(merchantName ?? null, plaidCategory, transactionName ?? null)) {
    const excludedCategory = categories.find(cat => cat.categoryType === 'excluded');
    if (excludedCategory) {
      return { categoryId: excludedCategory.id };
    }
  }

  // Get merchant history (last 5 transactions)
  const merchantHistory = (merchantName ?? null) ? await getMerchantHistory(userId, merchantName ?? null, 5) : [];

  // Format merchant history for prompt
  const historyText = merchantHistory.length > 0
    ? merchantHistory.map((tx, idx) => {
        const categoryInfo = tx.categories.map(c => c.categoryName).join(', ');
        return `  - Transaction ${idx + 1}: $${tx.amount} on ${tx.date} → Category: "${categoryInfo}"`;
      }).join('\n')
    : '  (No history available)';

  // Get Fixed categories with expected merchant names
  const fixedCategoriesWithMerchants = categories.filter(cat => 
    cat.categoryType === 'fixed' && cat.expectedMerchantName
  );

  // Check if current merchant matches any Fixed category
  const matchingFixedCategory = merchantName 
    ? fixedCategoriesWithMerchants.find(cat => 
        cat.expectedMerchantName && 
        merchantName.toLowerCase().includes(cat.expectedMerchantName.toLowerCase())
      )
    : null;

  // Format categories for prompt (excluding Surplus)
  const categoriesText = categories.map(cat => {
    let description = '';
    if (cat.categoryType === 'excluded') {
      description = ' (for transfers/payments)';
    } else if (cat.categoryType === 'fixed' && cat.expectedMerchantName) {
      description = ` (Fixed bill - expected merchant: "${cat.expectedMerchantName}")`;
    }
    return `  - ID: ${cat.id}, Name: "${cat.name}"${description}`;
  }).join('\n');

  // Add Fixed category matching information
  const fixedCategoryMatchText = matchingFixedCategory
    ? `\n\nIMPORTANT: This merchant "${merchantName}" matches the expected merchant "${matchingFixedCategory.expectedMerchantName}" for the Fixed category "${matchingFixedCategory.name}" (ID: ${matchingFixedCategory.id}). This should be prioritized for categorization.`
    : '';

  const prompt = `You are a financial transaction categorizer. Given:
- Current Transaction:
  - Amount: $${amount.toFixed(2)}
  - Merchant: "${merchantName || 'Unknown'}"
  - Plaid Category: ${plaidCategory ? JSON.stringify(plaidCategory) : 'null'}
- Historical Transactions from Same Merchant (last 5):
${historyText}
- Available budget categories:
${categoriesText}${fixedCategoryMatchText}

IMPORTANT RULES:
1. If this transaction is a transfer between accounts, credit card payment, or similar internal money movement, use the "Excluded" category (it will be in the list above with categoryType 'excluded').
2. DO NOT use "Surplus" category unless this is truly surplus income (like a bonus or unexpected income). Surplus is for leftover money after all expenses, not for regular spending transactions.
3. If a Fixed category has an expected merchant name that matches this transaction's merchant, prioritize that Fixed category.
4. Choose the most appropriate spending category based on the merchant, amount, and Plaid category.

Based on the historical pattern and available categories, return a JSON object with:
- categoryId: the budget category ID (number or null)

Example responses:
- Category match: {"categoryId": 5}
- No match: {"categoryId": null}

Return ONLY the JSON object, nothing else.`;

  try {
    const client = getOpenAIClient();
    const completion = await client.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a financial transaction categorizer. Return only a JSON object with categoryId.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3,
      max_tokens: 50,
      response_format: { type: 'json_object' },
    });

    const response = completion.choices[0]?.message?.content?.trim();
    if (!response) {
      return { categoryId: null };
    }

    try {
      const result = JSON.parse(response);
      const categoryId = result.categoryId !== null && result.categoryId !== undefined 
        ? parseInt(String(result.categoryId), 10) 
        : null;

      // Verify category exists in budget
      if (categoryId !== null) {
        const category = categories.find(cat => cat.id === categoryId);
        if (!category) {
          return { categoryId: null };
        }
      }

      return { categoryId };
    } catch (parseError) {
      console.error('Error parsing LLM response:', parseError);
      return { categoryId: null };
    }
  } catch (error) {
    console.error('Error categorizing transaction with OpenAI:', error);
    return { categoryId: null };
  }
}

