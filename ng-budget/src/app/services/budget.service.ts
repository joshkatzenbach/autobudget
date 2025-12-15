import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import {
  Budget,
  BudgetCategory,
  CreateBudgetRequest,
  UpdateBudgetRequest,
  CreateBudgetCategoryRequest,
  UpdateBudgetCategoryRequest
} from '../models/budget.model';

@Injectable({
  providedIn: 'root'
})
export class BudgetService {
  constructor(private api: ApiService) {}

  getBudget(): Observable<Budget | null> {
    return this.api.get<Budget | null>('/budgets');
  }

  createBudget(data: CreateBudgetRequest): Observable<Budget> {
    return this.api.post<Budget>('/budgets', data);
  }

  updateBudget(data: UpdateBudgetRequest): Observable<Budget> {
    return this.api.put<Budget>('/budgets', data);
  }

  deleteBudget(): Observable<void> {
    return this.api.delete<void>('/budgets');
  }

  getBudgetCategories(): Observable<BudgetCategory[]> {
    return this.api.get<BudgetCategory[]>('/budgets/categories');
  }

  getBudgetCategory(categoryId: number): Observable<BudgetCategory> {
    return this.api.get<BudgetCategory>(`/budgets/categories/${categoryId}`);
  }

  createBudgetCategory(data: CreateBudgetCategoryRequest): Observable<BudgetCategory> {
    return this.api.post<BudgetCategory>('/budgets/categories', data);
  }

  updateBudgetCategory(
    categoryId: number,
    data: UpdateBudgetCategoryRequest
  ): Observable<BudgetCategory> {
    return this.api.put<BudgetCategory>(`/budgets/categories/${categoryId}`, data);
  }

  deleteBudgetCategory(categoryId: number): Observable<void> {
    return this.api.delete<void>(`/budgets/categories/${categoryId}`);
  }

  getSavingsSnapshots(categoryId?: number): Observable<any[]> {
    const params: any = {};
    if (categoryId) params.categoryId = categoryId;
    const queryString = new URLSearchParams(params).toString();
    return this.api.get<any[]>(`/budgets/savings-snapshots${queryString ? '?' + queryString : ''}`);
  }

  getFundMovements(): Observable<any[]> {
    return this.api.get<any[]>('/budgets/fund-movements');
  }

  processMonthEnd(year: number, month: number): Observable<any> {
    return this.api.post('/budgets/process-month-end', { year, month });
  }

}

