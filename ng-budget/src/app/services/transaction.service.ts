import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import {
  TransactionWithCategories,
  MonthlyCategorySummary
} from '../models/budget.model';

@Injectable({
  providedIn: 'root'
})
export class TransactionService {
  constructor(private api: ApiService) {}

  getTransactions(limit?: number, offset?: number, reviewed?: boolean | null, includeHiddenFixed?: boolean): Observable<TransactionWithCategories[]> {
    const params: any = {};
    if (limit !== undefined) params.limit = limit;
    if (offset !== undefined) params.offset = offset;
    if (reviewed !== null && reviewed !== undefined) params.reviewed = reviewed.toString();
    if (includeHiddenFixed !== undefined) params.includeHiddenFixed = includeHiddenFixed.toString();
    const queryString = new URLSearchParams(params).toString();
    return this.api.get<TransactionWithCategories[]>(`/transactions${queryString ? '?' + queryString : ''}`);
  }

  assignTransactionCategory(transactionId: number, categoryId: number, amount: number): Observable<any> {
    return this.api.post(`/transactions/${transactionId}/category`, {
      categoryId,
      amount
    });
  }

  splitTransaction(transactionId: number, splits: Array<{categoryId: number, amount: number}>): Observable<any> {
    return this.api.post(`/transactions/${transactionId}/split`, {
      splits
    });
  }

  removeTransactionCategory(transactionId: number, categoryId: number): Observable<void> {
    return this.api.delete<void>(`/transactions/${transactionId}/categories/${categoryId}`);
  }

  generateMonthlySummary(year: number, month: number, budgetId?: number): Observable<any> {
    return this.api.post('/transactions/summaries/generate', {
      year,
      month,
      budgetId
    });
  }

  getMonthlySummaries(year?: number, month?: number, budgetId?: number): Observable<MonthlyCategorySummary[]> {
    const params: any = {};
    if (year) params.year = year;
    if (month) params.month = month;
    if (budgetId) params.budgetId = budgetId;

    const queryString = new URLSearchParams(params).toString();
    return this.api.get<MonthlyCategorySummary[]>(`/transactions/summaries${queryString ? '?' + queryString : ''}`);
  }

  syncTransactions(): Observable<{ success: boolean; message: string; fetched: number; categorized: number }> {
    return this.api.post(`/transactions/sync`, {});
  }
}

