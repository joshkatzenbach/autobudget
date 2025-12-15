import { Injectable } from '@angular/core';
import { Observable, from } from 'rxjs';
import { ApiService } from './api.service';

export interface PlaidLinkTokenResponse {
  link_token: string;
}

export interface PlaidAccount {
  id: number;
  itemId: number;
  accountId: string;
  name: string;
  officialName?: string | null;
  type?: string | null;
  subtype?: string | null;
  mask?: string | null;
}

export interface PlaidItem {
  id: number;
  userId: number;
  itemId: string;
  institutionId?: string | null;
  institutionName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectedAccount {
  item: PlaidItem;
  accounts: PlaidAccount[];
}

@Injectable({
  providedIn: 'root'
})
export class PlaidService {
  constructor(private api: ApiService) {}

  createLinkToken(): Observable<PlaidLinkTokenResponse> {
    return this.api.post<PlaidLinkTokenResponse>('/plaid/link/token', {});
  }

  exchangePublicToken(publicToken: string): Observable<any> {
    return this.api.post('/plaid/item/public_token/exchange', {
      public_token: publicToken
    });
  }

  getAccounts(): Observable<ConnectedAccount[]> {
    return this.api.get<ConnectedAccount[]>('/plaid/accounts');
  }

  deleteItem(itemId: number): Observable<void> {
    return this.api.delete<void>(`/plaid/item/${itemId}`);
  }

  getBalanceSnapshot(): Observable<{
    netBalance: number;
    totalAssets: number;
    totalDebts: number;
    accounts: Array<{
      accountId: string;
      name: string;
      originalName: string;
      customName?: string | null;
      type: string;
      subtype?: string | null;
      balance: number;
      mask?: string | null;
      institutionName?: string | null;
      isAsset: boolean;
    }>;
    timestamp: string;
  }> {
    return this.api.get('/plaid/balance-snapshot');
  }

  updateAccountName(accountId: string, customName: string | null): Observable<any> {
    return this.api.put(`/plaid/accounts/${accountId}/name`, { customName });
  }

  generateTestTransaction(): Observable<{
    success: boolean;
    transaction: {
      id: number;
      transactionId: string;
      merchant: string;
      amount: string;
      date: string;
      categoryId: number | null;
    };
  }> {
    return this.api.post('/plaid/test/generate-transaction', {});
  }
}

