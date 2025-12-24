import express, { Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import {
  getTransactionsForUser,
  assignTransactionCategory,
  splitTransaction,
  removeTransactionCategory,
  generateMonthlySummary,
  getMonthlySummaries,
} from '../services/transactions';
import { budgets, plaidItems, plaidTransactions, plaidAccounts } from '../db/schema';
import { db } from '../db';
import { eq, and } from 'drizzle-orm';
import { syncTransactions } from '../services/plaid';
import { storeTransaction } from '../services/transactions';
import { categorizeTransaction } from '../services/categorization';
import { decrypt } from '../utils/encryption';

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
    const reviewed = req.query.reviewed === 'true' ? true : req.query.reviewed === 'false' ? false : null;
    const includeHiddenFixed = req.query.includeHiddenFixed === 'true'; // Default: false (hide Fixed categories with hideFromTransactionLists)

    const transactions = await getTransactionsForUser(req.userId, limit, offset, reviewed, includeHiddenFixed);

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

    const { categoryId, amount } = req.body;
    if (!categoryId || !amount) {
      return res.status(400).json({ error: 'categoryId and amount are required' });
    }

    const assignment = await assignTransactionCategory(
      transactionId,
      categoryId,
      amount.toString(),
      true // Manual assignment
    );

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

    const userId = req.userId; // Type narrowing for TypeScript

    // Get user's budget
    const [budget] = await db
      .select()
      .from(budgets)
      .where(eq(budgets.userId, userId))
      .limit(1);

    if (!budget) {
      return res.status(404).json({ error: 'Budget not found. Please create a budget first.' });
    }

    // Get all Plaid items for user
    const items = await db
      .select()
      .from(plaidItems)
      .where(eq(plaidItems.userId, userId));

    if (items.length === 0) {
      return res.status(400).json({ error: 'No Plaid accounts connected' });
    }

    console.log(`\n=== Starting transaction sync for user ${userId} ===`);
    console.log(`User has ${items.length} Plaid item(s) connected`);

    let totalAdded = 0;
    let totalModified = 0;
    let totalRemoved = 0;
    let totalCategorized = 0;

    // Helper function to process a transaction
    const processTransaction = async (tx: any, isNew: boolean, item: any) => {
      try {
        let plaidCategory: string | null = null;
        let plaidCategoryId: string | null = null;
        
        if (tx.personal_finance_category) {
          plaidCategory = JSON.stringify({
            primary: tx.personal_finance_category.primary,
            detailed: tx.personal_finance_category.detailed,
          });
          plaidCategoryId = tx.personal_finance_category.detailed || null;
        } else if (tx.category) {
          plaidCategory = JSON.stringify(tx.category);
          plaidCategoryId = tx.category_id || null;
        }

        const amountToStore = tx.amount.toString();

        if (isNew) {
          const storedTx = await storeTransaction(
            userId,
            item.id,
            tx.account_id,
            tx.transaction_id,
            amountToStore,
            tx.merchant_name || null,
            tx.name,
            tx.date,
            plaidCategory,
            plaidCategoryId,
            tx.pending || false
          );

          // Categorize new transactions
          try {
            let plaidCategoryForLLM: string[] | null = null;
            if (tx.personal_finance_category) {
              plaidCategoryForLLM = [
                tx.personal_finance_category.primary,
                tx.personal_finance_category.detailed,
              ];
            } else if (tx.category) {
              plaidCategoryForLLM = tx.category;
            }

            const categorizationResult = await categorizeTransaction({
              amount: parseFloat(tx.amount.toString()),
              merchantName: tx.merchant_name || null,
              plaidCategory: plaidCategoryForLLM,
              userId: userId,
              transactionName: tx.name || null,
            });

            if (categorizationResult.categoryId) {
              await assignTransactionCategory(
                storedTx.id,
                categorizationResult.categoryId,
                tx.amount.toString(),
                false // LLM-assigned
              );
              totalCategorized++;
            }
          } catch (catError: any) {
            console.error(`Error categorizing transaction ${tx.transaction_id}:`, catError);
          }
        } else {
          // Update existing transaction
          const [existing] = await db
            .select()
            .from(plaidTransactions)
            .where(eq(plaidTransactions.transactionId, tx.transaction_id))
            .limit(1);

          if (existing) {
            await db
              .update(plaidTransactions)
              .set({
                amount: amountToStore,
                merchantName: tx.merchant_name || null,
                name: tx.name,
                date: tx.date,
                plaidCategory,
                plaidCategoryId,
                isPending: tx.pending || false,
                updatedAt: new Date(),
              })
              .where(eq(plaidTransactions.transactionId, tx.transaction_id));
          } else {
            // Modified transaction doesn't exist, treat as new
            const storedTx = await storeTransaction(
              userId,
              item.id,
              tx.account_id,
              tx.transaction_id,
              amountToStore,
              tx.merchant_name || null,
              tx.name,
              tx.date,
              plaidCategory,
              plaidCategoryId,
              tx.pending || false
            );

            // Categorize
            try {
              let plaidCategoryForLLM: string[] | null = null;
              if (tx.personal_finance_category) {
                plaidCategoryForLLM = [
                  tx.personal_finance_category.primary,
                  tx.personal_finance_category.detailed,
                ];
              } else if (tx.category) {
                plaidCategoryForLLM = tx.category;
              }

              const categorizationResult = await categorizeTransaction({
                amount: parseFloat(tx.amount.toString()),
                merchantName: tx.merchant_name || null,
                plaidCategory: plaidCategoryForLLM,
                userId: userId,
                transactionName: tx.name || null,
              });

              if (categorizationResult.categoryId) {
                await assignTransactionCategory(
                  storedTx.id,
                  categorizationResult.categoryId,
                  tx.amount.toString(),
                  false
                );
                totalCategorized++;
              }
            } catch (catError: any) {
              console.error(`Error categorizing transaction:`, catError);
            }
          }
        }
      } catch (error: any) {
        console.error(`Error processing transaction ${tx.transaction_id}:`, error);
      }
    };

    // For each item, sync transactions
    for (const item of items) {
      try {
        console.log(`\nSyncing transactions for item ${item.id} (${item.institutionName || 'Unknown'})`);
        const decryptedAccessToken = decrypt(item.accessToken);
        
        let currentCursor = item.transactionsCursor || null;
        let hasMore = true;
        let itemAdded = 0;
        let itemModified = 0;
        let itemRemoved = 0;

        // Continue syncing until all updates are fetched
        while (hasMore) {
          const syncResult = await syncTransactions(decryptedAccessToken, currentCursor);
          
          // Process added transactions
          for (const tx of syncResult.added) {
            itemAdded++;
            totalAdded++;
            await processTransaction(tx, true, item);
          }

          // Process modified transactions
          for (const tx of syncResult.modified) {
            itemModified++;
            totalModified++;
            await processTransaction(tx, false, item);
          }

          // Process removed transactions
          for (const removedTx of syncResult.removed) {
            itemRemoved++;
            totalRemoved++;
            try {
              await db
                .delete(plaidTransactions)
                .where(eq(plaidTransactions.transactionId, removedTx.transaction_id));
            } catch (error: any) {
              console.error(`Error removing transaction ${removedTx.transaction_id}:`, error);
            }
          }

          // Update cursor and check if more data is available
          currentCursor = syncResult.nextCursor;
          hasMore = syncResult.hasMore;

          // Update cursor in database after each batch
          if (currentCursor) {
            await db
              .update(plaidItems)
              .set({
                transactionsCursor: currentCursor,
                updatedAt: new Date(),
              })
              .where(eq(plaidItems.id, item.id));
          }
        }

        console.log(`  📊 Item ${item.id} summary: ${itemAdded} added, ${itemModified} modified, ${itemRemoved} removed`);
      } catch (itemError: any) {
        console.error(`  ❌ Error syncing transactions for item ${item.id}:`, itemError.message || itemError);
        if (itemError.response?.data) {
          console.error(`  Plaid API error:`, JSON.stringify(itemError.response.data, null, 2));
        }
      }
    }

    console.log(`\n=== Transaction sync complete ===`);
    console.log(`Total: ${totalAdded} added, ${totalModified} modified, ${totalRemoved} removed, ${totalCategorized} categorized\n`);

    res.json({
      success: true,
      message: `${totalAdded} added, ${totalModified} modified, ${totalRemoved} removed, ${totalCategorized} categorized`,
      added: totalAdded,
      modified: totalModified,
      removed: totalRemoved,
      categorized: totalCategorized,
    });
  } catch (error: any) {
    console.error('Error syncing transactions:', error);
    res.status(500).json({ error: 'Failed to sync transactions' });
  }
});

export default router;

