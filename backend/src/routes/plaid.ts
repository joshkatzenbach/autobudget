import express, { Response, Request } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { verifyPlaidWebhook } from '../middleware/webhook-verification';
import { db } from '../db';
import { plaidItems, plaidAccounts, plaidTransactions, budgets } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import {
  createLinkToken,
  exchangePublicToken,
  getAccounts,
  getItem,
  getInstitution,
  getAccountBalances,
  syncTransactionsForItem,
  removeItem,
} from '../services/plaid';
import { storeTransaction, assignTransactionCategory } from '../services/transactions';
import { categorizeTransaction } from '../services/categorization';
import { encrypt, decrypt } from '../utils/encryption';

const router = express.Router();

// Webhook endpoint (public, but requires webhook verification)
router.post('/webhook', verifyPlaidWebhook, async (req: Request, res: Response) => {
  try {
    const { webhook_type, item_id, new_transactions } = req.body;

    // Acknowledge receipt immediately
    res.status(200).json({ received: true });

    // Handle webhook asynchronously
    if (webhook_type === 'TRANSACTIONS' || webhook_type === 'SYNC_UPDATES_AVAILABLE') {
      // Find Plaid item in database
      const [plaidItem] = await db
        .select()
        .from(plaidItems)
        .where(eq(plaidItems.itemId, item_id))
        .limit(1);

      if (!plaidItem) {
        console.error(`Plaid item not found for item_id: ${item_id}`);
        return;
      }

      // Get date range for fetching new transactions (last 30 days)
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);

      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];

      // Decrypt access token before using
      const decryptedAccessToken = decrypt(plaidItem.accessToken);
      
      // Fetch new transactions
      const transactions = await syncTransactionsForItem(
        decryptedAccessToken,
        plaidItem.userId,
        plaidItem.id,
        startDateStr,
        endDateStr
      );

      // Store and categorize each transaction
      for (const tx of transactions) {
        try {
          // Check if transaction already exists
          const [existing] = await db
            .select()
            .from(plaidTransactions)
            .where(eq(plaidTransactions.transactionId, tx.transaction_id))
            .limit(1);

          if (existing) {
            continue; // Skip if already stored
          }

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

          // Store transaction
          const storedTx = await storeTransaction(
            plaidItem.userId,
            plaidItem.id,
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

          // Categorize transaction (get first active budget for user)
          const [userBudget] = await db
            .select()
            .from(budgets)
            .where(and(
              eq(budgets.userId, plaidItem.userId),
              eq(budgets.isActive, true)
            ))
            .limit(1);

          if (userBudget) {
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
                userId: plaidItem.userId,
                transactionName: tx.name || null,
              });

              if (categoryId) {
                await assignTransactionCategory(
                  storedTx.id,
                  categoryId,
                  tx.amount.toString(),
                  false // LLM-assigned
                );
              }
            } catch (error: any) {
              console.error(`Error categorizing transaction ${tx.transaction_id}:`, error);
              // Continue - transaction stored but uncategorized
            }
          }
        } catch (error: any) {
          console.error(`Error processing transaction ${tx.transaction_id}:`, error);
          // Continue with next transaction
        }
      }
    }
  } catch (error: any) {
    console.error('Error processing webhook:', error);
    // Don't send error response - webhook already acknowledged
  }
});

// All routes below require authentication
router.use(authenticateToken);

// Create link token for Plaid Link
router.post('/link/token', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const linkToken = await createLinkToken(req.userId);
    res.json({ link_token: linkToken });
  } catch (error: any) {
    console.error('Error creating link token:', error);
    // Return more detailed error information
    const errorMessage = error.response?.data?.error_message || error.message || 'Failed to create link token';
    const errorCode = error.response?.data?.error_code || 'UNKNOWN_ERROR';
    res.status(500).json({ 
      error: 'Failed to create link token',
      details: errorMessage,
      code: errorCode
    });
  }
});

// Exchange public token for access token
router.post('/item/public_token/exchange', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { public_token } = req.body;
    if (!public_token) {
      return res.status(400).json({ error: 'public_token is required' });
    }

    // Exchange public token for access token
    const { accessToken, itemId } = await exchangePublicToken(public_token);

    // Get item and institution info
    const item = await getItem(accessToken);
    const institution = item.institution_id
      ? await getInstitution(item.institution_id)
      : null;

    // Encrypt access token before storing
    const encryptedAccessToken = encrypt(accessToken);
    
    // Store Plaid item in database
    const [plaidItem] = await db
      .insert(plaidItems)
      .values({
        userId: req.userId,
        itemId: itemId,
        accessToken: encryptedAccessToken,
        institutionId: item.institution_id || null,
        institutionName: institution?.name || null,
      })
      .returning();

    // Get accounts for this item
    const accounts = await getAccounts(accessToken);

    // Store accounts in database
    const accountRecords = accounts.map((account) => ({
      itemId: plaidItem.id,
      accountId: account.account_id,
      name: account.name,
      officialName: account.official_name || null,
      type: account.type || null,
      subtype: account.subtype || null,
      mask: account.mask || null,
    }));

    if (accountRecords.length > 0) {
      await db.insert(plaidAccounts).values(accountRecords);
    }

    res.json({
      item: plaidItem,
      accounts: accountRecords,
    });
  } catch (error: any) {
    console.error('Error exchanging public token:', error);
    res.status(500).json({ error: 'Failed to exchange public token' });
  }
});

// Get all connected accounts for user
router.get('/accounts', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const items = await db
      .select()
      .from(plaidItems)
      .where(eq(plaidItems.userId, req.userId));

    const accountsWithItems = await Promise.all(
      items.map(async (item) => {
        const accounts = await db
          .select()
          .from(plaidAccounts)
          .where(eq(plaidAccounts.itemId, item.id));

        return {
          item,
          accounts,
        };
      })
    );

    res.json(accountsWithItems);
  } catch (error: any) {
    console.error('Error getting accounts:', error);
    res.status(500).json({ error: 'Failed to get accounts' });
  }
});

// Update account custom name
router.put('/accounts/:accountId/name', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const accountId = req.params.accountId;
    const { customName } = req.body;

    // Verify account belongs to user (through item)
    const [account] = await db
      .select({
        id: plaidAccounts.id,
        itemId: plaidAccounts.itemId,
      })
      .from(plaidAccounts)
      .where(eq(plaidAccounts.accountId, accountId))
      .limit(1);

    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    // Verify item belongs to user
    const [item] = await db
      .select()
      .from(plaidItems)
      .where(and(eq(plaidItems.id, account.itemId), eq(plaidItems.userId, req.userId)))
      .limit(1);

    if (!item) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Update custom name
    const [updated] = await db
      .update(plaidAccounts)
      .set({
        customName: customName || null,
        updatedAt: new Date(),
      })
      .where(eq(plaidAccounts.id, account.id))
      .returning();

    res.json(updated);
  } catch (error: any) {
    console.error('Error updating account name:', error);
    res.status(500).json({ error: 'Failed to update account name' });
  }
});

// Remove a connected account (item)
router.delete('/item/:itemId', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const itemId = parseInt(req.params.itemId);
    if (isNaN(itemId)) {
      return res.status(400).json({ error: 'Invalid item ID' });
    }

    // Verify item belongs to user
    const [item] = await db
      .select()
      .from(plaidItems)
      .where(and(eq(plaidItems.id, itemId), eq(plaidItems.userId, req.userId)));

    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // Revoke access token with Plaid before deleting from database
    try {
      const decryptedAccessToken = decrypt(item.accessToken);
      await removeItem(decryptedAccessToken);
      console.log(`Successfully revoked Plaid access token for item ${itemId}`);
    } catch (error: any) {
      // Log error but continue with database deletion
      // The token might already be invalid, or there might be a network issue
      console.error(`Error revoking Plaid access token for item ${itemId}:`, error);
      console.warn('Continuing with database deletion despite Plaid revocation error');
    }

    // Delete item from database (cascade will delete accounts)
    await db.delete(plaidItems).where(eq(plaidItems.id, itemId));

    res.json({ message: 'Item deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting item:', error);
    res.status(500).json({ error: 'Failed to delete item' });
  }
});

// Get balance snapshot (sum of all assets minus debts)
router.get('/balance-snapshot', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get all Plaid items for the user
    const items = await db
      .select()
      .from(plaidItems)
      .where(eq(plaidItems.userId, req.userId));

    let totalAssets = 0;
    let totalDebts = 0;
    const accountDetails: any[] = [];

    // For each item, get account balances
    for (const item of items) {
      try {
        // Decrypt access token before using
        const decryptedAccessToken = decrypt(item.accessToken);
        const balances = await getAccountBalances(decryptedAccessToken);
        
        for (const account of balances) {
          const balance = account.balances?.current || 0;
          const accountType = account.type;
          
          // Get account record from database to check for custom name
          const [accountRecord] = await db
            .select()
            .from(plaidAccounts)
            .where(and(
              eq(plaidAccounts.accountId, account.account_id),
              eq(plaidAccounts.itemId, item.id)
            ))
            .limit(1);
          
          // Use custom name if available, otherwise use original name
          const displayName = accountRecord?.customName || account.name;
          const originalName = account.name;
          
          // Assets: depository, investment accounts (positive balances)
          // Debts: credit, loan accounts (negative balances or positive for credit cards)
          if (accountType === 'depository' || accountType === 'investment') {
            totalAssets += balance;
            accountDetails.push({
              accountId: account.account_id,
              name: displayName,
              originalName: originalName,
              customName: accountRecord?.customName || null,
              type: accountType,
              subtype: account.subtype,
              balance: balance,
              mask: account.mask,
              institutionName: item.institutionName,
              isAsset: true,
            });
          } else if (accountType === 'credit' || accountType === 'loan') {
            // For credit cards and loans, the balance represents what you owe
            // In Plaid, credit card balances are typically positive (what you owe)
            // Negative balances mean you have a credit/overpayment
            const debtAmount = balance > 0 ? balance : 0; // Only count positive balances as debt
            totalDebts += debtAmount;
            accountDetails.push({
              accountId: account.account_id,
              name: displayName,
              originalName: originalName,
              customName: accountRecord?.customName || null,
              type: accountType,
              subtype: account.subtype,
              balance: -debtAmount, // Store as negative for debts
              mask: account.mask,
              institutionName: item.institutionName,
              isAsset: false,
            });
          }
        }
      } catch (error: any) {
        console.error(`Error getting balances for item ${item.id}:`, error);
        // Continue with other items even if one fails
      }
    }

    const netBalance = totalAssets - totalDebts;

    res.json({
      netBalance,
      totalAssets,
      totalDebts,
      accounts: accountDetails,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error getting balance snapshot:', error);
    res.status(500).json({ error: 'Failed to get balance snapshot' });
  }
});

export default router;

