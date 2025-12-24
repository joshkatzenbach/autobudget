import express, { Response, Request } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { verifyPlaidWebhook } from '../middleware/webhook-verification';
import { db } from '../db';
import { plaidItems, plaidAccounts, plaidTransactions, budgets, plaidWebhooks } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import {
  createLinkToken,
  exchangePublicToken,
  getAccounts,
  getItem,
  getInstitution,
  getAccountBalances,
  syncTransactions,
  removeItem,
  fireTestWebhook,
} from '../services/plaid';
import { storeTransaction, assignTransactionCategory } from '../services/transactions';
import { categorizeTransaction } from '../services/categorization';
import { sendTransactionNotification } from '../services/slack-notifications';
import { encrypt, decrypt } from '../utils/encryption';

const router = express.Router();

// Webhook endpoint (public, but requires webhook verification)
router.post('/webhook', verifyPlaidWebhook, async (req: Request, res: Response) => {
  let webhookRecordId: number | null = null;
  
  try {
    const { webhook_type, item_id, webhook_code } = req.body;

    // Store webhook in database immediately
    const [webhookRecord] = await db
      .insert(plaidWebhooks)
      .values({
        itemId: item_id || null,
        webhookType: webhook_type || 'UNKNOWN',
        webhookCode: webhook_code || null,
        payload: JSON.stringify(req.body),
        processed: false,
      })
      .returning();
    
    webhookRecordId = webhookRecord.id;
    console.log(`[WEBHOOK] Stored webhook #${webhookRecordId}: ${webhook_type} for item ${item_id || 'N/A'}`);

    // Acknowledge receipt immediately
    res.status(200).json({ received: true });

    // Handle webhook asynchronously
    if (webhook_type === 'SYNC_UPDATES_AVAILABLE') {
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

      // Decrypt access token before using
      const decryptedAccessToken = decrypt(plaidItem.accessToken);
      
      // Sync transactions using the stored cursor (or null for initial sync)
      let currentCursor = plaidItem.transactionsCursor || null;
      let hasMore = true;
      let totalAdded = 0;
      let totalModified = 0;
      let totalRemoved = 0;

      // Helper function to process a transaction (added or modified)
      const processTransaction = async (tx: any, isNew: boolean) => {
        try {
          // Extract category information from Plaid transaction
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
            // Check if transaction already exists (shouldn't happen with sync API, but safety check)
            const [existing] = await db
              .select()
              .from(plaidTransactions)
              .where(eq(plaidTransactions.transactionId, tx.transaction_id))
              .limit(1);

            if (existing) {
              console.log(`[SYNC] Transaction ${tx.transaction_id} already exists, skipping`);
              return;
            }

            // Store new transaction
            const storedTx = await storeTransaction(
              plaidItem.userId,
              plaidItem.id,
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

            // Categorize and notify for new transactions
            await categorizeAndNotify(storedTx, tx);
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
              
              console.log(`[SYNC] Updated transaction ${tx.transaction_id}`);
            } else {
              // Modified transaction doesn't exist, treat as new
              const storedTx = await storeTransaction(
                plaidItem.userId,
                plaidItem.id,
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
              await categorizeAndNotify(storedTx, tx);
            }
          }
        } catch (error: any) {
          console.error(`Error processing transaction ${tx.transaction_id}:`, error);
        }
      };

      // Helper function to categorize and send notifications
      const categorizeAndNotify = async (storedTx: any, tx: any) => {
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
              userId: plaidItem.userId,
              transactionName: tx.name || null,
            });

            if (categorizationResult.categoryId) {
              await assignTransactionCategory(
                storedTx.id,
                categorizationResult.categoryId,
                tx.amount.toString(),
                false // LLM-assigned
              );

              // Send Slack notification
              try {
                await sendTransactionNotification(
                  plaidItem.userId,
                  storedTx.id,
                  categorizationResult.categoryId
                );
              } catch (slackError: any) {
                console.error(`Error sending Slack notification:`, slackError);
              }
            }
          } catch (error: any) {
            console.error(`Error categorizing transaction:`, error);
          }
        }
      };

      // Continue syncing until all updates are fetched
      while (hasMore) {
        const syncResult = await syncTransactions(decryptedAccessToken, currentCursor);
        
        // Process added transactions
        for (const tx of syncResult.added) {
          totalAdded++;
          await processTransaction(tx, true);
        }

        // Process modified transactions
        for (const tx of syncResult.modified) {
          totalModified++;
          await processTransaction(tx, false);
        }

        // Process removed transactions
        for (const removedTx of syncResult.removed) {
          totalRemoved++;
          try {
            await db
              .delete(plaidTransactions)
              .where(eq(plaidTransactions.transactionId, removedTx.transaction_id));
            console.log(`[SYNC] Removed transaction ${removedTx.transaction_id}`);
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
            .where(eq(plaidItems.id, plaidItem.id));
        }
      }

      console.log(`[SYNC] Webhook sync complete: ${totalAdded} added, ${totalModified} modified, ${totalRemoved} removed`);
      
      // Update webhook record as processed
      if (webhookRecordId) {
        await db
          .update(plaidWebhooks)
          .set({
            processed: true,
            errorMessage: null,
          })
          .where(eq(plaidWebhooks.id, webhookRecordId));
      }
    } else {
      // Webhook type not handled, but still mark as processed
      console.log(`[WEBHOOK] Received unhandled webhook type: ${webhook_type}`);
      if (webhookRecordId) {
        await db
          .update(plaidWebhooks)
          .set({
            processed: true,
            errorMessage: `Unhandled webhook type: ${webhook_type}`,
          })
          .where(eq(plaidWebhooks.id, webhookRecordId));
      }
    }
  } catch (error: any) {
    console.error('Error processing webhook:', error);
    
    // Update webhook record with error
    if (webhookRecordId) {
      try {
        await db
          .update(plaidWebhooks)
          .set({
            processed: false,
            errorMessage: error.message || String(error),
          })
          .where(eq(plaidWebhooks.id, webhookRecordId));
      } catch (updateError: any) {
        console.error('Error updating webhook record:', updateError);
      }
    }
    
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

    // Parse keepTransactions query parameter (defaults to true if not provided)
    const keepTransactions = req.query.keepTransactions !== 'false';

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

    // Handle transactions based on user preference
    if (keepTransactions) {
      // Set itemId to null on all transactions for this item (preserves transaction history)
      // This happens automatically via the foreign key constraint (SET NULL), but we'll do it explicitly for clarity
      await db
        .update(plaidTransactions)
        .set({ itemId: null })
        .where(eq(plaidTransactions.itemId, itemId));
    } else {
      // Delete all transactions for this item (transactionCategories will cascade delete)
      await db
        .delete(plaidTransactions)
        .where(eq(plaidTransactions.itemId, itemId));
    }

    // Delete item from database (cascade will delete accounts, but NOT transactions)
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

// Test endpoint to simulate a Plaid webhook transaction
router.post('/test/generate-transaction', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get user's first Plaid item and account
    const [plaidItem] = await db
      .select()
      .from(plaidItems)
      .where(eq(plaidItems.userId, req.userId))
      .limit(1);

    if (!plaidItem) {
      return res.status(400).json({ error: 'No Plaid account connected. Please connect an account first.' });
    }

    const [account] = await db
      .select()
      .from(plaidAccounts)
      .where(eq(plaidAccounts.itemId, plaidItem.id))
      .limit(1);

    if (!account) {
      return res.status(400).json({ error: 'No account found for connected Plaid item.' });
    }

    // Generate a test transaction
    const testMerchants = [
      'Walmart',
      'Target',
      'Amazon',
      'Starbucks',
      'Shell',
      'CVS Pharmacy',
      'Whole Foods',
      'Home Depot',
      'Best Buy',
      'McDonald\'s'
    ];
    const testMerchant = testMerchants[Math.floor(Math.random() * testMerchants.length)];
    // Generate positive amount for OUTGOING transactions (money going out) - matches Plaid's convention
    // See PLAID_AMOUNT_CONVENTION.md for full documentation
    // Plaid convention: positive = outgoing (debits), negative = incoming (credits)
    // Amount between $10-$210, stored as positive string (e.g., "123.45")
    // This represents an expense/purchase, so it should be positive (outgoing)
    const testAmount = (Math.random() * 200 + 10).toFixed(2);
    const testTransactionId = `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const today = new Date().toISOString().split('T')[0];

    // Create test Plaid category
    const plaidCategory = JSON.stringify({
      primary: 'GENERAL_MERCHANDISE',
      detailed: 'GENERAL_MERCHANDISE_SUPERSTORES'
    });
    const plaidCategoryId = 'GENERAL_MERCHANDISE_SUPERSTORES';

    // Store transaction
    const storedTx = await storeTransaction(
      req.userId,
      plaidItem.id,
      account.accountId,
      testTransactionId,
      testAmount,
      testMerchant,
      `${testMerchant} Purchase`,
      today,
      plaidCategory,
      plaidCategoryId,
      false
    );

    // Get user's budget
    const [userBudget] = await db
      .select()
      .from(budgets)
      .where(and(
        eq(budgets.userId, req.userId),
        eq(budgets.isActive, true)
      ))
      .limit(1);

    if (!userBudget) {
      return res.status(400).json({ error: 'No active budget found. Please create a budget first.' });
    }

    // Categorize transaction
    let categoryId: number | null = null;

    try {
      const categorizationResult = await categorizeTransaction({
        amount: parseFloat(testAmount),
        merchantName: testMerchant,
        plaidCategory: ['GENERAL_MERCHANDISE', 'GENERAL_MERCHANDISE_SUPERSTORES'],
        userId: req.userId,
        transactionName: `${testMerchant} Purchase`,
      });

      if (categorizationResult.categoryId) {
        categoryId = categorizationResult.categoryId;

        await assignTransactionCategory(
          storedTx.id,
          categorizationResult.categoryId,
          testAmount,
          false // LLM-assigned
        );

        // Send Slack notification
        try {
          await sendTransactionNotification(
            req.userId,
            storedTx.id,
            categorizationResult.categoryId
          );
        } catch (slackError: any) {
          console.error(`Error sending Slack notification for test transaction ${storedTx.id}:`, slackError);
          // Don't fail the request if Slack fails
        }
      }
    } catch (catError: any) {
      console.error(`Error categorizing test transaction:`, catError);
      // Continue - transaction stored but uncategorized
    }

    res.json({
      success: true,
      transaction: {
        id: storedTx.id,
        transactionId: testTransactionId,
        merchant: testMerchant,
        amount: testAmount,
        date: today,
        categoryId
      }
    });
  } catch (error: any) {
    console.error('Error generating test transaction:', error);
    res.status(500).json({ error: 'Failed to generate test transaction', details: error.message });
  }
});

// Test endpoint to fire a Plaid webhook (Sandbox only)
router.post('/test/fire-webhook', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (process.env.PLAID_ENV !== 'sandbox') {
      return res.status(400).json({ 
        error: 'This endpoint only works in sandbox environment',
        currentEnv: process.env.PLAID_ENV 
      });
    }

    // Get user's first Plaid item
    const [plaidItem] = await db
      .select()
      .from(plaidItems)
      .where(eq(plaidItems.userId, req.userId))
      .limit(1);

    if (!plaidItem) {
      return res.status(400).json({ error: 'No Plaid account connected. Please connect an account first.' });
    }

    // Decrypt access token
    const decryptedAccessToken = decrypt(plaidItem.accessToken);

    // Fire the webhook
    const webhookCode = req.body.webhook_code || 'SYNC_UPDATES_AVAILABLE';
    const result = await fireTestWebhook(decryptedAccessToken, webhookCode);

    res.json({
      success: true,
      message: `Webhook fired successfully. Check your server logs to see if it was received.`,
      webhook_code: webhookCode,
      item_id: plaidItem.itemId,
      plaid_response: result,
    });
  } catch (error: any) {
    console.error('Error firing test webhook:', error);
    res.status(500).json({ 
      error: 'Failed to fire test webhook', 
      details: error.message,
      note: 'This endpoint only works in sandbox environment'
    });
  }
});

export default router;

