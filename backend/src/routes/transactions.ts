import express, { Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import {
  getTransactionsForUser,
  getTransactionsForBudget,
  assignTransactionCategory,
  splitTransaction,
  removeTransactionCategory,
  getUserCategoryOverrides,
  generateMonthlySummary,
  getMonthlySummaries,
} from '../services/transactions';
import { transactionCategoryOverrides, budgets, plaidItems, plaidTransactions } from '../db/schema';
import { db } from '../db';
import { eq, and } from 'drizzle-orm';
import { syncTransactionsForItem } from '../services/plaid';
import { storeTransaction } from '../services/transactions';
import { categorizeTransaction } from '../services/categorization';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Get transactions for user (with pagination)
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;

    const transactions = await getTransactionsForUser(req.userId, limit, offset);

    res.json(transactions);
  } catch (error: any) {
    console.error('Error getting transactions:', error);
    res.status(500).json({ error: 'Failed to get transactions' });
  }
});

// Assign transaction to a category
router.post('/:transactionId/category', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const transactionId = parseInt(req.params.transactionId);
    if (isNaN(transactionId)) {
      return res.status(400).json({ error: 'Invalid transaction ID' });
    }

    const { categoryId, amount, subcategoryId } = req.body;
    if (!categoryId || !amount) {
      return res.status(400).json({ error: 'categoryId and amount are required' });
    }

    const assignment = await assignTransactionCategory(
      transactionId,
      categoryId,
      amount.toString(),
      true, // Manual assignment
      subcategoryId || null
    );

    // Store override for future LLM context
    // TODO: Get merchant name and plaid category from transaction
    // For now, just store the category override

    res.json(assignment);
  } catch (error: any) {
    console.error('Error assigning category:', error);
    res.status(500).json({ error: 'Failed to assign category' });
  }
});

// Split transaction across multiple categories
router.post('/:transactionId/split', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const transactionId = parseInt(req.params.transactionId);
    if (isNaN(transactionId)) {
      return res.status(400).json({ error: 'Invalid transaction ID' });
    }

    const { splits } = req.body;
    if (!splits || !Array.isArray(splits) || splits.length === 0) {
      return res.status(400).json({ error: 'splits array is required' });
    }

    const result = await splitTransaction(transactionId, splits);

    res.json({ success: true, splits: result });
  } catch (error: any) {
    console.error('Error splitting transaction:', error);
    res.status(500).json({ error: error.message || 'Failed to split transaction' });
  }
});

// Remove a category assignment from a transaction
router.delete('/:transactionId/categories/:categoryId', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const transactionId = parseInt(req.params.transactionId);
    const categoryId = parseInt(req.params.categoryId);
    
    if (isNaN(transactionId) || isNaN(categoryId)) {
      return res.status(400).json({ error: 'Invalid transaction or category ID' });
    }

    await removeTransactionCategory(transactionId, categoryId);

    res.json({ success: true });
  } catch (error: any) {
    console.error('Error removing category:', error);
    res.status(500).json({ error: 'Failed to remove category' });
  }
});

// Get user's category overrides
router.get('/overrides', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const overrides = await getUserCategoryOverrides(req.userId);
    res.json(overrides);
  } catch (error: any) {
    console.error('Error getting overrides:', error);
    res.status(500).json({ error: 'Failed to get overrides' });
  }
});

// Generate monthly summaries
router.post('/summaries/generate', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { year, month, budgetId } = req.body;
    if (!year || !month) {
      return res.status(400).json({ error: 'year and month are required' });
    }

    const summaries = await generateMonthlySummary(
      req.userId,
      year,
      month,
      budgetId
    );

    res.json({ success: true, summaries });
  } catch (error: any) {
    console.error('Error generating summaries:', error);
    res.status(500).json({ error: 'Failed to generate summaries' });
  }
});

// Get monthly summaries
router.get('/summaries', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const year = req.query.year ? parseInt(req.query.year as string) : undefined;
    const month = req.query.month ? parseInt(req.query.month as string) : undefined;
    const budgetId = req.query.budgetId ? parseInt(req.query.budgetId as string) : undefined;

    const summaries = await getMonthlySummaries(req.userId, year, month, budgetId);
    res.json(summaries);
  } catch (error: any) {
    console.error('Error getting summaries:', error);
    res.status(500).json({ error: 'Failed to get summaries' });
  }
});

// Sync transactions for user's budget (manual trigger)
router.post('/sync', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get user's budget
    const [budget] = await db
      .select()
      .from(budgets)
      .where(eq(budgets.userId, req.userId))
      .limit(1);

    if (!budget) {
      return res.status(404).json({ error: 'Budget not found. Please create a budget first.' });
    }

    // Get all Plaid items for user
    const items = await db
      .select()
      .from(plaidItems)
      .where(eq(plaidItems.userId, req.userId));

    if (items.length === 0) {
      return res.status(400).json({ error: 'No Plaid accounts connected' });
    }

    // Get date range from budget and convert to YYYY-MM-DD format
    // Budget dates are stored as date type in PostgreSQL, which Drizzle returns as Date objects
    // Plaid requires dates in 'YYYY-MM-DD' format (no time component)
    const startDate = budget.startDate instanceof Date 
      ? budget.startDate.toISOString().split('T')[0]
      : String(budget.startDate).split('T')[0]; // Extract just YYYY-MM-DD if it's a string
    const endDate = budget.endDate instanceof Date
      ? budget.endDate.toISOString().split('T')[0]
      : String(budget.endDate).split('T')[0]; // Extract just YYYY-MM-DD if it's a string

    console.log(`\n=== Starting transaction sync for user ${req.userId} ===`);
    console.log(`Budget date range: ${startDate} to ${endDate}`);
    console.log(`User has ${items.length} Plaid item(s) connected`);

    let totalFetched = 0;
    let totalCategorized = 0;

    // For each item, fetch transactions
    for (const item of items) {
      try {
        console.log(`\nFetching transactions for item ${item.id} (${item.institutionName || 'Unknown'})`);
        console.log(`  Access token: ${item.accessToken.substring(0, 20)}...`);
        console.log(`  Date range: ${startDate} to ${endDate}`);
        
        const transactions = await syncTransactionsForItem(
          item.accessToken,
          req.userId,
          item.id,
          startDate,
          endDate
        );

        console.log(`  ✅ Received ${transactions.length} transactions from Plaid`);

        // Store and categorize each transaction
        if (transactions.length === 0) {
          console.log(`  ⚠️  No transactions found in date range ${startDate} to ${endDate}`);
        } else {
          console.log(`  📝 Processing ${transactions.length} transactions...`);
        }

        let storedCount = 0;
        let duplicateCount = 0;
        let errorCount = 0;

        for (const tx of transactions) {
          try {
            // Log transaction structure for debugging
            if (totalFetched === 0) {
              console.log(`\n  Processing first transaction:`, {
                account_id: tx.account_id,
                transaction_id: tx.transaction_id,
                amount: tx.amount,
                merchant_name: tx.merchant_name,
                name: tx.name,
                date: tx.date,
                personal_finance_category: tx.personal_finance_category,
                pending: tx.pending,
              });
            }

            // Store transaction (will skip if duplicate due to unique constraint)
            try {

              // Extract category information from Plaid transaction
              // Plaid now uses personal_finance_category instead of category
              let plaidCategory: string | null = null;
              let plaidCategoryId: string | null = null;
              
              if (tx.personal_finance_category) {
                // Use the detailed category as the category string
                plaidCategory = JSON.stringify({
                  primary: tx.personal_finance_category.primary,
                  detailed: tx.personal_finance_category.detailed,
                });
                plaidCategoryId = tx.personal_finance_category.detailed || null;
              } else if (tx.category) {
                // Fallback to old category format if available
                plaidCategory = JSON.stringify(tx.category);
                plaidCategoryId = tx.category_id || null;
              }

              const storedTx = await storeTransaction(
                req.userId,
                item.id,
                tx.account_id,
                tx.transaction_id,
                tx.amount.toString(),
                tx.merchant_name || null,
                tx.name,
                tx.date,
                plaidCategory,
                plaidCategoryId,
                tx.pending || false
              );

              totalFetched++;
              storedCount++;

              // Automatically categorize using LLM
              try {
                // Extract category for LLM (use personal_finance_category if available)
                let plaidCategoryForLLM: string[] | null = null;
                if (tx.personal_finance_category) {
                  plaidCategoryForLLM = [
                    tx.personal_finance_category.primary,
                    tx.personal_finance_category.detailed,
                  ];
                } else if (tx.category) {
                  plaidCategoryForLLM = tx.category;
                }

                const categoryId = await categorizeTransaction({
                  amount: parseFloat(tx.amount.toString()),
                  merchantName: tx.merchant_name || null,
                  plaidCategory: plaidCategoryForLLM,
                  userId: req.userId,
                  transactionName: tx.name || null,
                });

                if (categoryId) {
                  await assignTransactionCategory(
                    storedTx.id,
                    categoryId,
                    tx.amount.toString(),
                    false // LLM-assigned
                  );
                  totalCategorized++;
                }
              } catch (catError: any) {
                console.error(`Error categorizing transaction ${tx.transaction_id}:`, catError);
                // Continue - transaction stored but uncategorized
              }
            } catch (txError: any) {
              // Check if it's a duplicate transaction error
              if (txError.message?.includes('unique') || txError.message?.includes('duplicate') || txError.code === '23505') {
                // Transaction already exists, skip
                duplicateCount++;
                if (duplicateCount <= 3) { // Only log first few duplicates to avoid spam
                  console.log(`  ⏭️  Transaction ${tx.transaction_id} already exists, skipping`);
                }
                continue;
              }
              errorCount++;
              console.error(`  ❌ Error storing transaction ${tx.transaction_id}:`, txError.message || txError);
              if (txError.code) {
                console.error(`     Error code: ${txError.code}`);
              }
              if (txError.detail) {
                console.error(`     Detail: ${txError.detail}`);
              }
              // Continue with next transaction
            }
          } catch (error: any) {
            console.error(`Error processing transaction ${tx.transaction_id}:`, error);
            // Continue with next transaction
          }
        }
        console.log(`  📊 Item ${item.id} summary: ${storedCount} stored, ${duplicateCount} duplicates, ${errorCount} errors`);
      } catch (itemError: any) {
        console.error(`  ❌ Error fetching transactions for item ${item.id}:`, itemError.message || itemError);
        if (itemError.response?.data) {
          console.error(`  Plaid API error:`, JSON.stringify(itemError.response.data, null, 2));
        }
        // Continue with next item
      }
    }

    console.log(`\n=== Transaction sync complete ===`);
    console.log(`Total fetched: ${totalFetched}, Total categorized: ${totalCategorized}\n`);

    res.json({
      success: true,
      message: `Fetched ${totalFetched} transactions, categorized ${totalCategorized}`,
      fetched: totalFetched,
      categorized: totalCategorized,
    });
  } catch (error: any) {
    console.error('Error syncing transactions:', error);
    res.status(500).json({ error: 'Failed to sync transactions' });
  }
});

export default router;

