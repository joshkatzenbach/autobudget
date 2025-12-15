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
  subcategoryId: number | null;
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
      return { categoryId: null, subcategoryId: null }; // No budget exists
    }
    budgetId = budget.id;
  }

  // Get available budget categories
  const allCategories = await getBudgetCategories(userId);
  if (!allCategories || allCategories.length === 0) {
    return { categoryId: null, subcategoryId: null };
  }

  // Filter out Surplus category - it should not be used for regular spending transactions
  const categories = allCategories.filter(cat => cat.categoryType !== 'surplus');
  if (categories.length === 0) {
    return { categoryId: null, subcategoryId: null }; // No valid categories available
  }

  // Check if this is a transfer transaction - if so, return Excluded category
  if (detectTransferTransaction(merchantName, plaidCategory, transactionName)) {
    const excludedCategory = categories.find(cat => cat.categoryType === 'excluded');
    if (excludedCategory) {
      return { categoryId: excludedCategory.id, subcategoryId: null };
    }
  }

  // Get merchant history (last 3 transactions)
  const merchantHistory = merchantName ? await getMerchantHistory(userId, merchantName, 3) : [];

  // Get user's category overrides (we'll add this later, for now empty array)
  const userOverrides: any[] = []; // TODO: Get from transactionCategoryOverrides

  // Format merchant history for prompt (including subcategories)
  const historyText = merchantHistory.length > 0
    ? merchantHistory.map((tx, idx) => {
        const categoryInfo = tx.categories.map(c => {
          if (c.subcategoryName) {
            return `${c.categoryName} > ${c.subcategoryName}`;
          }
          return c.categoryName;
        }).join(', ');
        return `  - Transaction ${idx + 1}: $${tx.amount} on ${tx.date} → Category: "${categoryInfo}"`;
      }).join('\n')
    : '  (No history available)';

  // Format categories for prompt (excluding Surplus), including subcategories
  const categoriesText = categories.map(cat => {
    let categoryLine = `  - ID: ${cat.id}, Name: "${cat.name}"${cat.categoryType === 'excluded' ? ' (for transfers/payments)' : ''}`;
    
    // Add subcategories if they exist
    if (cat.subcategories && cat.subcategories.length > 0) {
      const subcategoriesList = cat.subcategories.map(sub => `    - Subcategory ID: ${sub.id}, Name: "${sub.name}"`).join('\n');
      categoryLine += `\n    Subcategories:\n${subcategoriesList}`;
    }
    
    return categoryLine;
  }).join('\n');

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
4. If the selected category has subcategories, you MUST also select the most appropriate subcategory. If the category has no subcategories, return null for subcategoryId.

Based on the historical pattern and available categories, return a JSON object with:
- categoryId: the budget category ID (number or null)
- subcategoryId: the subcategory ID if the category has subcategories, otherwise null

Example responses:
- Category with subcategories: {"categoryId": 5, "subcategoryId": 12}
- Category without subcategories: {"categoryId": 5, "subcategoryId": null}
- No match: {"categoryId": null, "subcategoryId": null}

Return ONLY the JSON object, nothing else.`;

  try {
    const client = getOpenAIClient();
    const completion = await client.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a financial transaction categorizer. Return only a JSON object with categoryId and subcategoryId.',
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
      return { categoryId: null, subcategoryId: null };
    }

    try {
      const result = JSON.parse(response);
      const categoryId = result.categoryId !== null && result.categoryId !== undefined 
        ? parseInt(String(result.categoryId), 10) 
        : null;
      const subcategoryId = result.subcategoryId !== null && result.subcategoryId !== undefined
        ? parseInt(String(result.subcategoryId), 10)
        : null;

      // Verify category exists in budget
      if (categoryId !== null) {
        const category = categories.find(cat => cat.id === categoryId);
        if (!category) {
          return { categoryId: null, subcategoryId: null };
        }

        // Verify subcategory exists and belongs to the category
        if (subcategoryId !== null) {
          const subcategory = category.subcategories?.find(sub => sub.id === subcategoryId);
          if (!subcategory) {
            // If category has subcategories but the selected one doesn't exist, return null for subcategory
            // The category will still be assigned, but without a subcategory
            return { categoryId, subcategoryId: null };
          }
        } else if (category.subcategories && category.subcategories.length > 0) {
          // Category has subcategories but LLM didn't select one - return null for both
          // This will require manual selection
          return { categoryId: null, subcategoryId: null };
        }
      }

      return { categoryId, subcategoryId };
    } catch (parseError) {
      console.error('Error parsing LLM response:', parseError);
      return { categoryId: null, subcategoryId: null };
    }
  } catch (error) {
    console.error('Error categorizing transaction with OpenAI:', error);
    return { categoryId: null, subcategoryId: null };
  }
}

