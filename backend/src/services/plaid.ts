import { Configuration, PlaidApi, PlaidEnvironments, CountryCode, Products } from 'plaid';
import * as dotenv from 'dotenv';

dotenv.config();

// Initialize Plaid client
const configuration = new Configuration({
  basePath: process.env.PLAID_ENV === 'production' 
    ? PlaidEnvironments.production 
    : PlaidEnvironments.sandbox,
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID!,
      'PLAID-SECRET': process.env.PLAID_SECRET!,
    },
  },
});

export const plaidClient = new PlaidApi(configuration);

export async function createLinkToken(userId: number) {
  // Get webhook URL from environment (BASE_URL) or construct it
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const webhookUrl = `${baseUrl}/api/plaid/webhook`;

  const request = {
    user: {
      client_user_id: userId.toString(),
    },
    client_name: 'AutoBudget',
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: 'en',
    webhook: webhookUrl,
  };

  try {
    const response = await plaidClient.linkTokenCreate(request);
    return response.data.link_token;
  } catch (error: any) {
    console.error('Error creating link token:', error);
    // Log more details if available
    if (error.response?.data) {
      console.error('Plaid error details:', JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
}

export async function exchangePublicToken(publicToken: string) {
  try {
    const response = await plaidClient.itemPublicTokenExchange({
      public_token: publicToken,
    });
    return {
      accessToken: response.data.access_token,
      itemId: response.data.item_id,
    };
  } catch (error) {
    console.error('Error exchanging public token:', error);
    throw error;
  }
}

export async function getAccounts(accessToken: string) {
  try {
    const response = await plaidClient.accountsGet({
      access_token: accessToken,
    });
    return response.data.accounts;
  } catch (error) {
    console.error('Error getting accounts:', error);
    throw error;
  }
}

export async function getItem(accessToken: string) {
  try {
    const response = await plaidClient.itemGet({
      access_token: accessToken,
    });
    return response.data.item;
  } catch (error) {
    console.error('Error getting item:', error);
    throw error;
  }
}

export async function getInstitution(institutionId: string) {
  try {
    const response = await plaidClient.institutionsGetById({
      institution_id: institutionId,
      country_codes: [CountryCode.Us],
    });
    return response.data.institution;
  } catch (error) {
    console.error('Error getting institution:', error);
    throw error;
  }
}

export async function getAccountBalances(accessToken: string) {
  try {
    // accountsGet already includes balance information
    const response = await plaidClient.accountsGet({
      access_token: accessToken,
    });
    return response.data.accounts;
  } catch (error) {
    console.error('Error getting account balances:', error);
    throw error;
  }
}

/**
 * Sync transactions using Plaid's Transactions Sync API
 * Returns added, modified, and removed transactions along with the new cursor
 */
export async function syncTransactions(
  accessToken: string,
  cursor: string | null = null
): Promise<{
  added: any[];
  modified: any[];
  removed: any[];
  nextCursor: string;
  hasMore: boolean;
}> {
  try {
    const request: any = {
      access_token: accessToken,
    };

    // If cursor is provided, use it for incremental sync
    // If null, this is the initial sync
    if (cursor) {
      request.cursor = cursor;
    }

    const response = await plaidClient.transactionsSync(request);
    const data = response.data;

    console.log(`[SYNC] Fetched ${data.added?.length || 0} added, ${data.modified?.length || 0} modified, ${data.removed?.length || 0} removed transactions`);
    
    return {
      added: data.added || [],
      modified: data.modified || [],
      removed: data.removed || [],
      nextCursor: data.next_cursor,
      hasMore: data.has_more,
    };
  } catch (error: any) {
    console.error('Error syncing transactions from Plaid:', error);
    // Log more details if available
    if (error.response?.data) {
      console.error('Plaid error details:', JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
}

export async function removeItem(accessToken: string) {
  try {
    const response = await plaidClient.itemRemove({
      access_token: accessToken,
    });
    return response.data;
  } catch (error: any) {
    console.error('Error removing Plaid item:', error);
    // Log more details if available
    if (error.response?.data) {
      console.error('Plaid error details:', JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
}

/**
 * Fire a test webhook in Sandbox environment
 * Only works in sandbox - use this to test webhook handling
 */
export async function fireTestWebhook(accessToken: string, webhookCode: string = 'SYNC_UPDATES_AVAILABLE') {
  try {
    // This endpoint only exists in sandbox
    if (process.env.PLAID_ENV !== 'sandbox') {
      throw new Error('fireTestWebhook only works in sandbox environment');
    }

    const response = await plaidClient.sandboxItemFireWebhook({
      access_token: accessToken,
      webhook_code: webhookCode as any,
    });
    return response.data;
  } catch (error: any) {
    console.error('Error firing test webhook:', error);
    if (error.response?.data) {
      console.error('Plaid error details:', JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
}

