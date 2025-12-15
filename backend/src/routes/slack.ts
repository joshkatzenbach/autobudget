import express, { Request, Response } from 'express';
import crypto from 'crypto';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { verifySlackWebhook } from '../middleware/slack-webhook-verification';
import { sendMessage, createChannel, authTest, listChannels, listUsers, joinChannel, createGroupDM, getConversationMembers, createSlackClient } from '../services/slack';
import { exchangeCodeForToken, storeOAuthTokens, getUserAccessToken, getUserOAuth, updateNotificationChannel, getNotificationChannel } from '../services/slack-oauth';
import { storeMessage, processIncomingMessage, updateMessageStatus } from '../services/slack-messages';
import { assignTransactionCategory, updateTransactionCategories } from '../services/transactions';
import { getBudgetCategories } from '../services/budgets';
import { budgetCategories, budgetCategorySubcategories } from '../db/schema';
import { db } from '../db';
import { slackMessages, plaidTransactions } from '../db/schema';
import { eq, desc } from 'drizzle-orm';
import * as dotenv from 'dotenv';

dotenv.config();

const router = express.Router();
const CLIENT_ID = process.env.SLACK_CLIENT_ID;
const REDIRECT_URI = process.env.SLACK_REDIRECT_URI || 'http://localhost:3000/api/slack/oauth/callback';

// OAuth Endpoints

/**
 * GET /api/slack/oauth/authorize
 * Get OAuth authorization URL (requires authentication)
 * Returns the URL instead of redirecting, so frontend can handle the redirect
 */
router.get('/oauth/authorize', authenticateToken, (req: AuthRequest, res: Response) => {
  if (!CLIENT_ID) {
    return res.status(500).json({ error: 'SLACK_CLIENT_ID not configured' });
  }

  if (!req.userId) {
    return res.status(401).json({ error: 'Unauthorized. Please log in first.' });
  }

  // Bot token scopes (for OAuth v2)
  const scopes = [
    'chat:write',           // Send messages
    'channels:manage',      // Create and manage channels (replaces channels:write)
    'channels:join',        // Join public channels
    'channels:read',        // View channel information
    'channels:history',     // View channel message history
    'groups:read',         // View private channel information
    'groups:history',      // View private channel message history
    'im:write',            // Send direct messages
    'im:read',             // View direct message information
    'im:history',          // View direct message history
    'mpim:write',          // Create and manage group DMs
    'mpim:read',           // View group DM information
    'users:read',          // View user information
  ].join(',');

  // Pass userId in state parameter so we can retrieve it in the callback
  const state = req.userId.toString();

  const authUrl = `https://slack.com/oauth/v2/authorize?client_id=${CLIENT_ID}&scope=${scopes}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=${state}`;

  // Return the URL instead of redirecting
  res.json({ authUrl });
});

/**
 * GET /api/slack/oauth/callback
 * Handle OAuth callback, exchange code for token
 */
router.get('/oauth/callback', async (req: Request, res: Response) => {
  try {
    const code = req.query.code as string;
    const error = req.query.error as string;
    const state = req.query.state as string;

    if (error) {
      return res.status(400).json({ error: `OAuth error: ${error}` });
    }

    if (!code) {
      return res.status(400).json({ error: 'Missing authorization code' });
    }

    // Exchange code for token
    const tokenData = await exchangeCodeForToken(code, REDIRECT_URI);

    // Get userId from state parameter (passed during OAuth initiation)
    const userId = state ? parseInt(state, 10) : null;

    if (!userId || isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid state parameter. Please try connecting again.' });
    }

    // Store OAuth tokens
    await storeOAuthTokens(userId, tokenData);

    // Redirect to frontend success page
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
    res.redirect(`${frontendUrl}/messaging?connected=true`);
  } catch (error: any) {
    console.error('Error handling OAuth callback:', error);
    res.status(500).json({ error: error.message || 'Failed to complete OAuth flow' });
  }
});

// Webhook Endpoints (public, but requires webhook verification)

/**
 * POST /api/slack/events
 * Handle Events API webhooks (endpoint #6)
 */
router.post('/events',
  express.json({ verify: (req: any, res, buf) => { req.rawBody = buf; } }), // Preserve raw body for signature verification
  async (req: Request, res: Response) => {
    try {
      const body = req.body;

      // URL verification challenge - handle BEFORE signature verification
      // Slack's challenge request doesn't include signature headers
      if (body.type === 'url_verification') {
        console.log('Slack URL verification challenge received:', body.challenge);
        return res.json({ challenge: body.challenge });
      }

      // For actual events, verify signature
      // We need to manually call the verification middleware here
      const signingSecret = process.env.SLACK_SIGNING_SECRET;
      if (signingSecret) {
        const signature = req.headers['x-slack-signature'] as string;
        const timestamp = req.headers['x-slack-request-timestamp'] as string;

        if (!signature || !timestamp) {
          console.warn('Slack webhook missing signature or timestamp');
          return res.status(401).json({ error: 'Missing webhook signature or timestamp' });
        }

        // Prevent replay attacks
        const currentTime = Math.floor(Date.now() / 1000);
        const requestTime = parseInt(timestamp, 10);
        if (Math.abs(currentTime - requestTime) > 300) {
          console.warn('Slack webhook timestamp too old');
          return res.status(401).json({ error: 'Request timestamp too old' });
        }

        // Verify signature
        const rawBody = (req as any).rawBody 
          ? (req as any).rawBody.toString('utf8')
          : JSON.stringify(body);
        const sigBaseString = `v0:${timestamp}:${rawBody}`;
        const hmac = crypto.createHmac('sha256', signingSecret);
        hmac.update(sigBaseString);
        const mySignature = `v0=${hmac.digest('hex')}`;

        if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(mySignature))) {
          console.warn('Invalid Slack webhook signature');
          return res.status(401).json({ error: 'Invalid webhook signature' });
        }
      }

      // Event callback
      if (body.type === 'event_callback') {
        const event = body.event;

        // Acknowledge receipt immediately
        res.status(200).json({ ok: true });

        // Process event in background
        try {
          // Handle message events
          if (event.type === 'message' && !event.subtype) {
            // Regular message (not a bot message, thread reply, etc.)
            const responseMessage = await processIncomingMessage({
              type: event.type,
              user: event.user,
              channel: event.channel,
              text: event.text,
              ts: event.ts,
              thread_ts: event.thread_ts,
            });

            // If there's a response message, send it back
            if (responseMessage) {
              // Get user's access token to send response
              // Note: This requires finding the user by Slack team/channel
              // For now, we'll skip auto-responses
              // TODO: Implement auto-response logic
            }
          }

          // Handle app mentions
          if (event.type === 'app_mention') {
            // Bot was mentioned
            // TODO: Process mention and respond
          }
        } catch (error: any) {
          console.error('Error processing Slack event:', error);
          // Don't fail the webhook - we've already acknowledged receipt
        }

        return;
      }

      // Unknown event type
      res.status(200).json({ ok: true });
    } catch (error: any) {
      console.error('Error handling Slack events webhook:', error);
      res.status(200).json({ ok: true }); // Always return 200 to Slack
    }
  }
);

/**
 * POST /api/slack/interactive
 * Handle Interactive Components webhooks (endpoint #7)
 * Note: Slack sends challenges as JSON, but interactive components as URL-encoded form data
 */
// Interactive webhook handler
// Note: Body parser is applied at app level in server.ts to capture raw body
router.post('/interactive',
  express.urlencoded({ 
    extended: false, 
    verify: (req: any, res, buf) => {
      req.rawBody = buf;
    }
  }),
  async (req: Request, res: Response) => {
    try {
      // Handle URL verification challenge first
      if (req.body && req.body.type === 'url_verification') {
        return res.json({ challenge: req.body.challenge });
      }

      // Slack sends interactive components as URL-encoded form data
      if (!req.body || !req.body.payload) {
        return res.status(200).json({ ok: true });
      }

      // Parse the payload JSON first to check the type
      let payload;
      try {
        payload = JSON.parse(req.body.payload);
      } catch (parseError) {
        console.error('Error parsing Slack interactive payload:', parseError);
        return res.status(200).json({ ok: true });
      }

      // Handle URL verification challenges first (before signature verification)
      if (payload.type === 'url_verification') {
        return res.json({ challenge: req.body.challenge });
      }

      // Verify signature
      const signingSecret = process.env.SLACK_SIGNING_SECRET;
      let signatureValid = true;
      
      if (signingSecret) {
        const signature = req.headers['x-slack-signature'] as string;
        const timestamp = req.headers['x-slack-request-timestamp'] as string;

        if (!signature || !timestamp) {
          signatureValid = false;
        } else {
          // Prevent replay attacks
          const currentTime = Math.floor(Date.now() / 1000);
          const requestTime = parseInt(timestamp, 10);
          if (Math.abs(currentTime - requestTime) > 300) {
            signatureValid = false;
          } else {
            // Verify signature using raw body
            const rawBody = (req as any).rawBody 
              ? (req as any).rawBody.toString('utf8')
              : '';
            
            if (!rawBody) {
              signatureValid = false;
            } else {
              const sigBaseString = `v0:${timestamp}:${rawBody}`;
              const hmac = crypto.createHmac('sha256', signingSecret);
              hmac.update(sigBaseString);
              const mySignature = `v0=${hmac.digest('hex')}`;

              if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(mySignature))) {
                signatureValid = false;
              }
            }
          }
        }
      }

      // If signature is invalid, send error response
      if (!signatureValid) {
        console.error('Slack interactive webhook signature verification failed - request ignored');
        if (!res.headersSent) {
          return res.status(200).json({ ok: true });
        }
        return;
      }

      // Handle modal submissions immediately (must respond within 3 seconds)
      // For view_submission, we send the response in the handler, not here
      if (payload.type === 'view_submission') {
        try {
          const view = payload.view;
          const callbackId = view.callback_id;

          if (callbackId?.startsWith('num_splits_')) {
          // First modal: user entered number of splits, now open the actual split modal
          // Get metadata from the modal (includes transactionId and messageInfo)
          let metadata: any = {};
          try {
            metadata = view.private_metadata ? JSON.parse(view.private_metadata) : {};
          } catch (e) {
            console.error('[DEBUG] Error parsing num_splits metadata:', e);
          }
          
          const transactionId = metadata.transactionId || parseInt(callbackId.split('_')[2], 10);
          if (isNaN(transactionId)) {
            console.error('Invalid transaction ID in num_splits modal');
            return res.status(200).json({ response_action: 'errors', errors: {} });
          }

          // Get number of splits from input
          const numSplitsValue = view.state.values.num_splits?.num_splits_input?.value || '2';
          const numSplits = parseInt(numSplitsValue, 10);
          
          if (isNaN(numSplits) || numSplits < 2) {
            return res.status(200).json({
              response_action: 'errors',
              errors: {
                num_splits: 'Please enter a number greater than or equal to 2'
              }
            });
          }

          // Get transaction details
          const [transaction] = await db
            .select({ 
              userId: plaidTransactions.userId,
              amount: plaidTransactions.amount
            })
            .from(plaidTransactions)
            .where(eq(plaidTransactions.id, transactionId))
            .limit(1);

          if (!transaction) {
            console.error(`Transaction ${transactionId} not found`);
            return res.status(200).json({ response_action: 'errors', errors: {} });
          }

          // Get user's access token
          const accessToken = await getUserAccessToken(transaction.userId);
          if (!accessToken) {
            console.error(`No Slack access token for user ${transaction.userId}`);
            return res.status(200).json({ response_action: 'errors', errors: {} });
          }

          // Get all categories and subcategories
          const allCategories = await getBudgetCategories(transaction.userId);
          if (!allCategories || allCategories.length === 0) {
            console.error('No categories found for user');
            return res.status(200).json({ response_action: 'errors', errors: {} });
          }

          // Filter out surplus category
          const categories = allCategories.filter(cat => cat.categoryType !== 'surplus');

          // Build category options for dropdown
          const categoryOptions: any[] = [];
          for (const cat of categories) {
            if (cat.subcategories && cat.subcategories.length > 0) {
              for (const subcat of cat.subcategories) {
                categoryOptions.push({
                  text: {
                    type: 'plain_text',
                    text: `${cat.name} - ${subcat.name}`
                  },
                  value: `cat_${cat.id}_sub_${subcat.id}`
                });
              }
            } else {
              categoryOptions.push({
                text: {
                  type: 'plain_text',
                  text: cat.name
                },
                value: `cat_${cat.id}`
              });
            }
          }

          // Build split blocks - last split doesn't have amount field
          const blocks: any[] = [];
          const transactionAmount = Math.abs(parseFloat(transaction.amount));
          
          for (let i = 1; i <= numSplits; i++) {
            const isLastSplit = i === numSplits;
            
            blocks.push({
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Split ${i}*`
              }
            });

            // Category input
            blocks.push({
              type: 'input',
              block_id: `split_${i}_category`,
              label: {
                type: 'plain_text',
                text: 'Category'
              },
              element: {
                type: 'static_select',
                action_id: 'category',
                placeholder: {
                  type: 'plain_text',
                  text: 'Select category'
                },
                options: categoryOptions
              }
            });

            if (isLastSplit) {
              // Last split: no amount field, just a note
              blocks.push({
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: '_The rest of the money will be used for this split._'
                }
              });
            } else {
              // Amount input for non-last splits
              blocks.push({
                type: 'input',
                block_id: `split_${i}_amount`,
                label: {
                  type: 'plain_text',
                  text: 'Amount'
                },
                element: {
                  type: 'plain_text_input',
                  action_id: 'amount',
                  placeholder: {
                    type: 'plain_text',
                    text: '0.00'
                  },
                  initial_value: ''
                }
              });
            }
          }

                      // Open the actual split modal
                      // Preserve messageInfo from the first modal
                      const splitModal = {
                        type: 'modal',
                        callback_id: `split_transaction_${transactionId}`,
                        private_metadata: JSON.stringify({ 
                          numSplits, 
                          transactionId,
                          messageInfo: metadata?.messageInfo || null // Preserve message info
                        }),
                        title: {
                          type: 'plain_text',
                          text: 'Split Transaction'
                        },
                        submit: {
                          type: 'plain_text',
                          text: 'Save Split'
                        },
                        close: {
                          type: 'plain_text',
                          text: 'Cancel'
                        },
                        blocks: blocks
                      };

          const slackClient = createSlackClient(accessToken);
          await slackClient.views.update({
            view_id: view.id,
            view: splitModal
          });

          // Don't send response if headers already sent
          if (!res.headersSent) {
            return res.status(200).json({ response_action: 'update', view: splitModal });
          }
          } else if (callbackId?.startsWith('split_transaction_')) {
          console.log('[DEBUG] Split transaction modal submitted');
          const transactionId = parseInt(callbackId.split('_')[2], 10);
          console.log('[DEBUG] Parsed transaction ID:', transactionId);
          if (isNaN(transactionId)) {
            console.error('Invalid transaction ID in modal submission');
            return res.status(200).json({ response_action: 'errors', errors: {} });
          }

          // Get transaction
          const [transaction] = await db
            .select({ 
              userId: plaidTransactions.userId,
              amount: plaidTransactions.amount
            })
            .from(plaidTransactions)
            .where(eq(plaidTransactions.id, transactionId))
            .limit(1);

          if (!transaction) {
            console.error(`Transaction ${transactionId} not found`);
            return res.status(200).json({ response_action: 'errors', errors: {} });
          }

          console.log('[DEBUG] Transaction found:', {
            transactionId,
            userId: transaction.userId,
            amount: transaction.amount
          });

          // Parse splits from view state
          const splits: Array<{ categoryId: number; subcategoryId: number | null; amount: string }> = [];
          const transactionAmount = Math.abs(parseFloat(transaction.amount));
          let totalAmount = 0;

          console.log('[DEBUG] Transaction amount (absolute):', transactionAmount);
          console.log('[DEBUG] View state values:', JSON.stringify(view.state?.values, null, 2));

          // Get metadata to know how many splits we expect
          let metadata: any = {};
          try {
            metadata = view.private_metadata ? JSON.parse(view.private_metadata) : { numSplits: 2 };
          } catch (e) {
            console.error('[DEBUG] Error parsing metadata:', e);
            metadata = { numSplits: 2 };
          }

          const numSplits = metadata.numSplits || 2;
          console.log('[DEBUG] Expected number of splits:', numSplits);

          // Process each split
          console.log('[DEBUG] Processing splits...');
          for (let i = 1; i <= numSplits; i++) {
            console.log(`[DEBUG] Processing split ${i} of ${numSplits}`);
            const categoryBlock = view.state.values[`split_${i}_category`];
            const amountBlock = view.state.values[`split_${i}_amount`];

            console.log(`[DEBUG] Split ${i} - categoryBlock:`, categoryBlock ? 'exists' : 'missing');
            console.log(`[DEBUG] Split ${i} - amountBlock:`, amountBlock ? 'exists' : 'missing');

            if (!categoryBlock?.category?.selected_option) {
              console.log(`[DEBUG] Split ${i} - No category selected`);
              if (!res.headersSent) {
                return res.status(200).json({
                  response_action: 'errors',
                  errors: {
                    [`split_${i}_category`]: 'Please select a category'
                  }
                });
              }
              return;
            }

            const categoryValue = categoryBlock.category.selected_option.value;
            const categoryId = parseInt(categoryValue.split('_')[1], 10);
            const subcategoryId = categoryValue.includes('_sub_') 
              ? parseInt(categoryValue.split('_sub_')[1], 10) 
              : null;

            console.log(`[DEBUG] Split ${i} - categoryValue:`, categoryValue);
            console.log(`[DEBUG] Split ${i} - categoryId:`, categoryId);
            console.log(`[DEBUG] Split ${i} - subcategoryId:`, subcategoryId);

            const isLastSplit = i === numSplits;
            console.log(`[DEBUG] Split ${i} - isLastSplit:`, isLastSplit);

            if (isLastSplit) {
              // Last split: use remaining amount
              const remainingAmount = transactionAmount - totalAmount;
              console.log(`[DEBUG] Split ${i} (last) - remainingAmount:`, remainingAmount);
              console.log(`[DEBUG] Split ${i} (last) - totalAmount so far:`, totalAmount);
              if (remainingAmount <= 0) {
                console.log(`[DEBUG] Split ${i} (last) - ERROR: remainingAmount <= 0`);
                if (!res.headersSent) {
                  return res.status(200).json({
                    response_action: 'errors',
                    errors: {
                      [`split_${i - 1}_amount`]: 'Previous splits already use the full transaction amount'
                    }
                  });
                }
                return;
              }
              splits.push({
                categoryId,
                subcategoryId,
                amount: remainingAmount.toFixed(2)
              });
              console.log(`[DEBUG] Split ${i} (last) - Added split with amount:`, remainingAmount.toFixed(2));
            } else {
              // Non-last split: require amount
              if (!amountBlock?.amount?.value) {
                console.log(`[DEBUG] Split ${i} - ERROR: No amount provided`);
                if (!res.headersSent) {
                  return res.status(200).json({
                    response_action: 'errors',
                    errors: {
                      [`split_${i}_amount`]: 'Please enter an amount'
                    }
                  });
                }
                return;
              }

              const amountValue = amountBlock.amount.value;
              const amount = parseFloat(amountValue) || 0;
              console.log(`[DEBUG] Split ${i} - amountValue:`, amountValue);
              console.log(`[DEBUG] Split ${i} - parsed amount:`, amount);

              if (amount <= 0) {
                console.log(`[DEBUG] Split ${i} - ERROR: amount <= 0`);
                if (!res.headersSent) {
                  return res.status(200).json({
                    response_action: 'errors',
                    errors: {
                      [`split_${i}_amount`]: 'Amount must be greater than 0'
                    }
                  });
                }
                return;
              }

              totalAmount += amount;
              console.log(`[DEBUG] Split ${i} - totalAmount after adding:`, totalAmount);

              if (totalAmount >= transactionAmount) {
                console.log(`[DEBUG] Split ${i} - ERROR: totalAmount (${totalAmount}) >= transactionAmount (${transactionAmount})`);
                if (!res.headersSent) {
                  return res.status(200).json({
                    response_action: 'errors',
                    errors: {
                      [`split_${i}_amount`]: 'Split amounts exceed transaction total'
                    }
                  });
                }
                return;
              }

              splits.push({
                categoryId,
                subcategoryId,
                amount: amount.toFixed(2)
              });
              console.log(`[DEBUG] Split ${i} - Added split with amount:`, amount.toFixed(2));
            }
          }

          console.log('[DEBUG] All splits processed. Total splits:', splits.length);
          console.log('[DEBUG] Final splits array:', JSON.stringify(splits, null, 2));
          console.log('[DEBUG] Final totalAmount:', totalAmount);
          console.log('[DEBUG] Transaction amount:', transactionAmount);

          // Get message info from metadata (stored when Split button was clicked)
          let messageInfo: { channel: string; ts: string } | null = null;
          try {
            const metadata = view.private_metadata ? JSON.parse(view.private_metadata) : {};
            messageInfo = metadata.messageInfo || null;
            console.log('[DEBUG] Message info from metadata:', messageInfo);
          } catch (e) {
            console.error('[DEBUG] Error parsing messageInfo from metadata:', e);
          }

          // Update transaction with splits (async, but acknowledge first)
          console.log('[DEBUG] About to update transaction categories...');
          setImmediate(async () => {
            try {
              console.log('[DEBUG] Calling updateTransactionCategories with:', {
                transactionId,
                splits: splits.map(s => ({
                  categoryId: s.categoryId,
                  subcategoryId: s.subcategoryId,
                  amount: s.amount
                }))
              });
              await updateTransactionCategories(
                transactionId,
                splits.map(s => ({
                  categoryId: s.categoryId,
                  subcategoryId: s.subcategoryId,
                  amount: s.amount
                })),
                true // Manual
              );
              console.log('[DEBUG] Successfully updated transaction categories');

              // Fetch category and subcategory names for each split
              const splitsWithNames = await Promise.all(
                splits.map(async (split) => {
                  const [category] = await db
                    .select({ name: budgetCategories.name })
                    .from(budgetCategories)
                    .where(eq(budgetCategories.id, split.categoryId))
                    .limit(1);

                  let subcategoryName: string | null = null;
                  if (split.subcategoryId) {
                    const [subcategory] = await db
                      .select({ name: budgetCategorySubcategories.name })
                      .from(budgetCategorySubcategories)
                      .where(eq(budgetCategorySubcategories.id, split.subcategoryId))
                      .limit(1);
                    subcategoryName = subcategory?.name || null;
                  }

                  return {
                    categoryName: category?.name || 'Unknown',
                    subcategoryName,
                    amount: split.amount
                  };
                })
              );

              // Only update Slack message AFTER successful database update
              console.log('[DEBUG] Updating Slack message after successful split...');
              const accessToken = await getUserAccessToken(transaction.userId);
              console.log('[DEBUG] Access token retrieved:', accessToken ? 'yes' : 'no');
              console.log('[DEBUG] Message info exists:', messageInfo ? 'yes' : 'no');
              
              if (accessToken && messageInfo) {
                const slackClient = createSlackClient(accessToken);
                
                // First, get the current message to preserve its content
                let currentMessage;
                try {
                  const messageResult = await slackClient.conversations.history({
                    channel: messageInfo.channel,
                    latest: messageInfo.ts,
                    limit: 1,
                    inclusive: true
                  });
                  
                  if (messageResult.messages && messageResult.messages.length > 0) {
                    currentMessage = messageResult.messages[0];
                    console.log('[DEBUG] Retrieved current message from Slack');
                  } else {
                    console.log('[DEBUG] Could not find message in channel history');
                    return; // Can't update if we can't find the message
                  }
                } catch (error: any) {
                  console.error('[DEBUG] Error retrieving message from Slack:', error);
                  return; // Can't update if we can't retrieve the message
                }
                
                // Remove action blocks (buttons) from the message
                const updatedBlocks = currentMessage.blocks
                  ? currentMessage.blocks.filter((block: any) => block.type !== 'actions')
                  : [];
                
                // Build split details text
                const splitDetails = splitsWithNames.map((split, index) => {
                  const categoryDisplay = split.subcategoryName 
                    ? `${split.categoryName} - ${split.subcategoryName}`
                    : split.categoryName;
                  return `• ${categoryDisplay}: $${parseFloat(split.amount).toFixed(2)}`;
                }).join('\n');
                
                // Add confirmation message as a new section block with split details
                updatedBlocks.push({
                  type: 'section',
                  text: {
                    type: 'mrkdwn',
                    text: `✓ *Transaction split into ${splits.length} categories:*\n${splitDetails}`
                  }
                });
                
                // Update fallback text for push notifications
                const splitSummary = splitsWithNames.map(s => {
                  const catName = s.subcategoryName ? `${s.categoryName} - ${s.subcategoryName}` : s.categoryName;
                  return `${catName} ($${parseFloat(s.amount).toFixed(2)})`;
                }).join(', ');
                const updatedText = `${currentMessage.text || 'Transaction'}\n✓ Transaction split: ${splitSummary}`;
                
                console.log('[DEBUG] Updating Slack message with:', {
                  channel: messageInfo.channel,
                  ts: messageInfo.ts,
                  text: updatedText
                });
                
                await slackClient.chat.update({
                  channel: messageInfo.channel,
                  ts: messageInfo.ts,
                  text: updatedText,
                  blocks: updatedBlocks
                });
                console.log('[DEBUG] Slack message updated successfully - buttons removed');
              } else {
                console.log('[DEBUG] Skipping Slack message update - missing accessToken or messageInfo');
              }
            } catch (error: any) {
              console.error('[DEBUG] Error updating transaction splits:', error);
              console.error('[DEBUG] Error stack:', error.stack);
              // Don't update Slack message if database update failed
              console.log('[DEBUG] Database update failed - Slack message will NOT be updated (buttons remain)');
            }
          });

          // Acknowledge modal submission
          console.log('[DEBUG] Acknowledging modal submission...');
          console.log('[DEBUG] res.headersSent:', res.headersSent);
          if (!res.headersSent) {
            console.log('[DEBUG] Sending response_action: clear');
            return res.status(200).json({ response_action: 'clear' });
          }
          console.log('[DEBUG] Headers already sent, returning without response');
          return; // Explicit return to prevent catch block from executing
        }
        } catch (error: any) {
          console.error('Error handling view_submission:', error);
          console.error('Error stack:', error.stack);
          // Always send a response to Slack, even on error
          if (!res.headersSent) {
            // Try to determine which callback this is to set error on appropriate field
            const view = payload.view;
            const callbackId = view?.callback_id || '';
            
            let errorField = 'num_splits';
            if (callbackId?.startsWith('split_transaction_')) {
              errorField = 'split_1_category';
            }
            
            return res.status(200).json({ 
              response_action: 'errors', 
              errors: {
                [errorField]: error.message || 'An unexpected error occurred. Please try again.'
              }
            });
          }
        }
      } else {
        // For non-view_submission payloads, acknowledge immediately
        // Acknowledge receipt IMMEDIATELY (Slack requires response within 3 seconds)
        res.status(200).json({ ok: true });
      }

      // Process interactive payload in background (only for non-view_submission)
      if (payload.type !== 'view_submission') {
        setImmediate(async () => {
        try {
          if (payload.type === 'block_actions') {
            const actions = payload.actions || [];
            
            for (const action of actions) {
            if (action.action_id === 'transaction_correct') {
              // User clicked "Correct" - mark as reviewed
              const transactionId = parseInt(action.value.split('_')[1], 10);
              if (!isNaN(transactionId)) {
                try {
                  await db
                    .update(plaidTransactions)
                    .set({ isReviewed: true, updatedAt: new Date() })
                    .where(eq(plaidTransactions.id, transactionId));
                  
                  // Update the Slack message to remove buttons
                  const [transaction] = await db
                    .select({ userId: plaidTransactions.userId })
                    .from(plaidTransactions)
                    .where(eq(plaidTransactions.id, transactionId))
                    .limit(1);
                  
                  if (transaction && payload.message) {
                    const accessToken = await getUserAccessToken(transaction.userId);
                    
                    if (accessToken) {
                      const slackClient = createSlackClient(accessToken);
                      
                      // Remove action blocks (buttons) from the message
                      const updatedBlocks = payload.message.blocks
                        ? payload.message.blocks.filter((block: any) => block.type !== 'actions')
                        : [];
                      
                      // Add confirmation message as a new section block
                      updatedBlocks.push({
                        type: 'section',
                        text: {
                          type: 'mrkdwn',
                          text: '✓ *Marked as correct*'
                        }
                      });
                      
                      // Update fallback text for push notifications
                      const updatedText = `${payload.message.text}\n✓ Marked as correct`;
                      
                      await slackClient.chat.update({
                        channel: payload.channel?.id || payload.message.channel,
                        ts: payload.message.ts,
                        text: updatedText,
                        blocks: updatedBlocks
                      });
                    }
                  }
                } catch (error: any) {
                  console.error(`Error marking transaction ${transactionId} as reviewed:`, error);
                }
              }
              } else if (action.action_id?.startsWith('transaction_category_')) {
                // User clicked a category or subcategory button
                // action_id format: transaction_category_${categoryId} or transaction_category_${categoryId}_${subcategoryId}
                // value format: category_${transactionId}_${categoryId} or category_${transactionId}_${categoryId}_${subcategoryId}
                const valueParts = action.value.split('_');
                const transactionId = parseInt(valueParts[1], 10);
                const categoryId = parseInt(valueParts[2], 10);
                const subcategoryId = valueParts.length > 3 ? parseInt(valueParts[3], 10) : null;
                
                if (isNaN(transactionId) || isNaN(categoryId)) {
                  console.error('Invalid transaction or category ID in button click');
                  continue;
                }

                // Get transaction to find user and amount
                const [transaction] = await db
                  .select({ 
                    userId: plaidTransactions.userId,
                    amount: plaidTransactions.amount
                  })
                  .from(plaidTransactions)
                  .where(eq(plaidTransactions.id, transactionId))
                  .limit(1);

                if (!transaction) {
                  console.error(`Transaction ${transactionId} not found`);
                  continue;
                }

                // Update transaction category
                try {
                  await assignTransactionCategory(
                    transactionId,
                    categoryId,
                    transaction.amount,
                    true, // Manual override
                    subcategoryId || null // Use subcategory if provided
                  );

                  // Update the Slack message to show it was updated and remove buttons
                  const accessToken = await getUserAccessToken(transaction.userId);
                  
                  if (accessToken && payload.message) {
                    const slackClient = createSlackClient(accessToken);
                    
                    // Remove action blocks (buttons) from the message
                    const updatedBlocks = payload.message.blocks
                      ? payload.message.blocks.filter((block: any) => block.type !== 'actions')
                      : [];
                    
                    // Add confirmation message as a new section block
                    updatedBlocks.push({
                      type: 'section',
                      text: {
                        type: 'mrkdwn',
                        text: `✓ *Category updated to:* ${action.text.text}`
                      }
                    });
                    
                    // Update fallback text for push notifications
                    const updatedText = `${payload.message.text}\n✓ Category updated to: ${action.text.text}`;
                    
                    await slackClient.chat.update({
                      channel: payload.channel?.id || payload.message.channel,
                      ts: payload.message.ts,
                      text: updatedText,
                      blocks: updatedBlocks
                    });
                  }
                } catch (updateError: any) {
                  console.error(`Error updating transaction category:`, updateError);
                }
              } else if (action.action_id === 'transaction_split') {
                // User clicked "Split" button - first ask how many splits
                const transactionId = parseInt(action.value.split('_')[1], 10);
                if (isNaN(transactionId)) {
                  console.error('Invalid transaction ID in split button click');
                  continue;
                }

                // Get transaction details
                const [transaction] = await db
                  .select({ 
                    userId: plaidTransactions.userId,
                    amount: plaidTransactions.amount
                  })
                  .from(plaidTransactions)
                  .where(eq(plaidTransactions.id, transactionId))
                  .limit(1);

                if (!transaction) {
                  console.error(`Transaction ${transactionId} not found`);
                  continue;
                }

                // Get user's access token
                const accessToken = await getUserAccessToken(transaction.userId);
                if (!accessToken) {
                  console.error(`No Slack access token for user ${transaction.userId}`);
                  continue;
                }

                // Store message info in private_metadata so we can update it later
                const messageInfo = payload.message ? {
                  channel: payload.channel?.id || payload.message.channel,
                  ts: payload.message.ts
                } : null;
                
                // Open first modal asking for number of splits
                const transactionAmount = Math.abs(parseFloat(transaction.amount));
                const numSplitsModal = {
                  type: 'modal',
                  callback_id: `num_splits_${transactionId}`,
                  private_metadata: JSON.stringify({
                    transactionId,
                    messageInfo // Store message channel and timestamp
                  }),
                  title: {
                    type: 'plain_text',
                    text: 'Split Transaction'
                  },
                  submit: {
                    type: 'plain_text',
                    text: 'Continue'
                  },
                  close: {
                    type: 'plain_text',
                    text: 'Cancel'
                  },
                  blocks: [
                    {
                      type: 'section',
                      text: {
                        type: 'mrkdwn',
                        text: `*Transaction Amount:* $${transactionAmount.toFixed(2)}\n\nHow many ways would you like to split this transaction?`
                      }
                    },
                    {
                      type: 'input',
                      block_id: 'num_splits',
                      label: {
                        type: 'plain_text',
                        text: 'Number of Splits'
                      },
                      element: {
                        type: 'plain_text_input',
                        action_id: 'num_splits_input',
                        placeholder: {
                          type: 'plain_text',
                          text: 'e.g., 2, 3, 4...'
                        },
                        initial_value: '2'
                      }
                    }
                  ]
                };

                const slackClient = createSlackClient(accessToken);
                await slackClient.views.open({
                  trigger_id: payload.trigger_id,
                  view: numSplitsModal
                });
              }
            }
          }
        } catch (error: any) {
          console.error('Error processing interactive component:', error);
        }
        });
      }
    } catch (error: any) {
      console.error('Error handling Slack interactive webhook:', error);
      if (!res.headersSent) {
        res.status(200).json({ ok: true });
      }
    }
  }
);

// All routes below require authentication
router.use(authenticateToken);

/**
 * GET /api/slack/messages
 * Get user's message history
 */
router.get('/messages', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const messages = await db
      .select()
      .from(slackMessages)
      .where(eq(slackMessages.userId, req.userId))
      .orderBy(desc(slackMessages.createdAt));

    res.json(messages);
  } catch (error: any) {
    console.error('Error getting messages:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

/**
 * POST /api/slack/send
 * Send message to channel/DM (uses endpoint #1: chat.postMessage)
 */
router.post('/send', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { channelId, userId, message, threadTs } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    if (!channelId && !userId) {
      return res.status(400).json({ error: 'Either channelId or userId is required' });
    }

    // Get user's access token
    const accessToken = await getUserAccessToken(req.userId);
    if (!accessToken) {
      return res.status(400).json({ error: 'Slack account not connected. Please connect your Slack account first.' });
    }

    // Determine channel ID
    let targetChannelId = channelId;
    if (!targetChannelId && userId) {
      // For DMs, we need to open a conversation first
      // For now, require channelId
      return res.status(400).json({ error: 'channelId is required. DM support coming soon.' });
    }

    // Send message via Slack API
    const messageTs = await sendMessage(accessToken, targetChannelId, message, threadTs);

    // Store outbound message in database
    try {
      await storeMessage({
        userId: req.userId,
        direction: 'outbound',
        channelId: targetChannelId,
        messageBody: message,
        messageTs: messageTs,
        threadTs: threadTs || null,
        status: 'sent',
      });
    } catch (error: any) {
      console.error('Error storing outbound message:', error);
      // Don't fail the request if storage fails
    }

    res.json({
      success: true,
      messageTs: messageTs,
      channelId: targetChannelId,
    });
  } catch (error: any) {
    console.error('Error sending Slack message:', error);
    res.status(500).json({ error: error.message || 'Failed to send Slack message' });
  }
});

/**
 * POST /api/slack/channels/create
 * Create a new channel (uses endpoint #13: conversations.create)
 */
router.post('/channels/create', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { name, isPrivate } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Channel name is required' });
    }

    // Get user's access token
    const accessToken = await getUserAccessToken(req.userId);
    if (!accessToken) {
      return res.status(400).json({ error: 'Slack account not connected. Please connect your Slack account first.' });
    }

    // Create channel via Slack API
    const channel = await createChannel(accessToken, name, isPrivate || false);

    res.json({
      success: true,
      channel: channel,
    });
  } catch (error: any) {
    console.error('Error creating Slack channel:', error);
    res.status(500).json({ error: error.message || 'Failed to create Slack channel' });
  }
});

/**
 * GET /api/slack/auth/test
 * Test authentication token (uses endpoint #22: auth.test)
 */
router.get('/auth/test', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get user's access token
    const accessToken = await getUserAccessToken(req.userId);
    if (!accessToken) {
      return res.status(400).json({ error: 'Slack account not connected. Please connect your Slack account first.' });
    }

    // Test authentication via Slack API
    const authInfo = await authTest(accessToken);

    res.json({
      success: true,
      auth: authInfo,
    });
  } catch (error: any) {
    console.error('Error testing Slack auth:', error);
    res.status(500).json({ error: error.message || 'Failed to test Slack authentication' });
  }
});

/**
 * GET /api/slack/channels
 * List all channels the bot has access to
 */
router.get('/channels', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get user's access token
    const accessToken = await getUserAccessToken(req.userId);
    if (!accessToken) {
      return res.status(400).json({ error: 'Slack account not connected. Please connect your Slack account first.' });
    }

    // List channels via Slack API
    const channels = await listChannels(accessToken);

    res.json({
      success: true,
      channels: channels,
    });
  } catch (error: any) {
    console.error('Error listing Slack channels:', error);
    res.status(500).json({ error: error.message || 'Failed to list Slack channels' });
  }
});

/**
 * GET /api/slack/users
 * List all users in the workspace
 */
router.get('/users', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get user's access token
    const accessToken = await getUserAccessToken(req.userId);
    if (!accessToken) {
      return res.status(400).json({ error: 'Slack account not connected. Please connect your Slack account first.' });
    }

    // List users via Slack API
    const users = await listUsers(accessToken);

    res.json({
      success: true,
      users: users,
    });
  } catch (error: any) {
    console.error('Error listing Slack users:', error);
    res.status(500).json({ error: error.message || 'Failed to list Slack users' });
  }
});

/**
 * POST /api/slack/channels/:channelId/join
 * Join a Slack channel
 */
router.post('/channels/:channelId/join', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const channelId = req.params.channelId;

    if (!channelId) {
      return res.status(400).json({ error: 'Channel ID is required' });
    }

    // Get user's access token
    const accessToken = await getUserAccessToken(req.userId);
    if (!accessToken) {
      return res.status(400).json({ error: 'Slack account not connected. Please connect your Slack account first.' });
    }

    // Join channel via Slack API
    const channel = await joinChannel(accessToken, channelId);

    res.json({
      success: true,
      channel: channel,
    });
  } catch (error: any) {
    console.error('Error joining Slack channel:', error);
    res.status(500).json({ error: error.message || 'Failed to join Slack channel' });
  }
});

/**
 * POST /api/slack/group-dm/create
 * Create a group DM (multi-person instant message)
 */
router.post('/group-dm/create', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { userIds } = req.body;

    if (!userIds || !Array.isArray(userIds) || userIds.length < 2) {
      return res.status(400).json({ error: 'At least 2 user IDs are required for a group DM' });
    }

    if (userIds.length > 8) {
      return res.status(400).json({ error: 'Group DM can have at most 8 users' });
    }

    // Get user's access token
    const accessToken = await getUserAccessToken(req.userId);
    if (!accessToken) {
      return res.status(400).json({ error: 'Slack account not connected. Please connect your Slack account first.' });
    }

    // Create group DM via Slack API
    const groupDM = await createGroupDM(accessToken, userIds);

    res.json({
      success: true,
      channelId: groupDM.id,
      name: groupDM.name,
    });
  } catch (error: any) {
    console.error('Error creating group DM:', error);
    res.status(500).json({ error: error.message || 'Failed to create group DM' });
  }
});

/**
 * GET /api/slack/integration/status
 * Get Slack integration status and notification settings
 */
router.get('/integration/status', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Check if connected
    const accessToken = await getUserAccessToken(req.userId);
    const notificationChannelId = await getNotificationChannel(req.userId);

    if (!accessToken) {
      return res.json({
        connected: false,
        notificationChannelId: null,
      });
    }

    // Test auth to get workspace info
    try {
      const authInfo = await authTest(accessToken);
      // If there's a notification channel, get its members (excluding the bot)
      let notificationUserIds: string[] = [];
      if (notificationChannelId) {
        try {
          const members = await getConversationMembers(accessToken, notificationChannelId);
          // Filter out the bot user ID
          const oauth = await getUserOAuth(req.userId);
          const botUserId = oauth?.botUserId;
          if (botUserId) {
            notificationUserIds = members.filter((userId: string) => userId !== botUserId);
          } else {
            notificationUserIds = members;
          }
        } catch (error: any) {
          console.error('Error getting notification channel members:', error);
          // Don't fail the whole request if we can't get members
        }
      }
      
      return res.json({
        connected: true,
        workspace: {
          team: authInfo.team,
          teamId: authInfo.team_id,
          user: authInfo.user,
          userId: authInfo.user_id,
        },
        notificationChannelId: notificationChannelId,
        notificationUserIds: notificationUserIds,
      });
    } catch (error: any) {
      // Token might be invalid
      return res.json({
        connected: false,
        notificationChannelId: null,
        notificationUserIds: [],
      });
    }
  } catch (error: any) {
    console.error('Error getting integration status:', error);
    res.status(500).json({ error: error.message || 'Failed to get integration status' });
  }
});

/**
 * POST /api/slack/integration/notifications
 * Update notification group DM settings
 */
router.post('/integration/notifications', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { userIds } = req.body;

    // Get user's access token
    const accessToken = await getUserAccessToken(req.userId);
    if (!accessToken) {
      return res.status(400).json({ error: 'Slack account not connected. Please connect your Slack account first.' });
    }

    let channelId: string | null = null;

    if (userIds && Array.isArray(userIds) && userIds.length > 0) {
      // Validate user count
      if (userIds.length > 8) {
        return res.status(400).json({ error: 'Group DM can have at most 8 users' });
      }

      // Create or update group DM
      const groupDM = await createGroupDM(accessToken, userIds);
      channelId = groupDM.id;
    }
    // If userIds is empty array or null, we're clearing the notification channel

    // Update notification channel in database
    await updateNotificationChannel(req.userId, channelId);

    res.json({
      success: true,
      channelId: channelId,
    });
  } catch (error: any) {
    console.error('Error updating notification settings:', error);
    res.status(500).json({ error: error.message || 'Failed to update notification settings' });
  }
});

export default router;

