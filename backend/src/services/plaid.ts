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
  const request = {
    user: {
      client_user_id: userId.toString(),
    },
    client_name: 'AutoBudget',
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: 'en',
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

export async function getTransactions(accessToken: string, startDate: string, endDate: string) {
  try {
    // Ensure dates are in YYYY-MM-DD format (Plaid requirement)
    // Handle both Date objects and ISO strings
    const normalizeDate = (date: string | Date): string => {
      if (date instanceof Date) {
        return date.toISOString().split('T')[0];
      }
      // If it's an ISO string, extract just the date part
      return String(date).split('T')[0];
    };

    const startDateStr = normalizeDate(startDate);
    const endDateStr = normalizeDate(endDate);

    const allTransactions: any[] = [];
    let cursor: string | undefined = undefined;

    do {
      const request: any = {
        access_token: accessToken,
        start_date: startDateStr,
        end_date: endDateStr,
      };

      if (cursor) {
        request.cursor = cursor;
      }

      const response = await plaidClient.transactionsGet(request);
      
      // Log for debugging
      if (response.data.transactions && response.data.transactions.length > 0) {
        console.log(`Fetched ${response.data.transactions.length} transactions from Plaid`);
        // Log first transaction structure for debugging
        if (allTransactions.length === 0) {
          console.log('Sample transaction structure:', JSON.stringify(response.data.transactions[0], null, 2));
        }
      }
      
      allTransactions.push(...response.data.transactions);
      cursor = response.data.next_cursor || undefined;
    } while (cursor);

    console.log(`Total transactions fetched: ${allTransactions.length}`);
    return allTransactions;
  } catch (error: any) {
    console.error('Error getting transactions from Plaid:', error);
    // Log more details if available
    if (error.response?.data) {
      console.error('Plaid error details:', JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
}

export async function syncTransactionsForItem(
  accessToken: string,
  userId: number,
  itemId: number,
  startDate: string,
  endDate: string
) {
  try {
    console.log(`    Calling Plaid API with dates: ${startDate} to ${endDate}`);
    const transactions = await getTransactions(accessToken, startDate, endDate);
    console.log(`    Plaid API returned ${transactions.length} transactions`);
    return transactions;
  } catch (error: any) {
    console.error(`    Error syncing transactions for item ${itemId}:`, error.message || error);
    if (error.response?.data) {
      console.error(`    Plaid API error response:`, JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
}

