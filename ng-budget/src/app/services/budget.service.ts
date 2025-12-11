import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import {
  Budget,
  BudgetCategory,
  BudgetCategorySubcategory,
  CreateBudgetRequest,
  UpdateBudgetRequest,
  CreateBudgetCategoryRequest,
  UpdateBudgetCategoryRequest,
  CreateBudgetCategorySubcategoryRequest,
  UpdateBudgetCategorySubcategoryRequest
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

  // Subcategory methods
  getBudgetCategorySubcategories(categoryId: number): Observable<BudgetCategorySubcategory[]> {
    return this.api.get<BudgetCategorySubcategory[]>(`/budgets/categories/${categoryId}/subcategories`);
  }

  createBudgetCategorySubcategory(
    categoryId: number,
    data: CreateBudgetCategorySubcategoryRequest
  ): Observable<BudgetCategorySubcategory> {
    return this.api.post<BudgetCategorySubcategory>(
      `/budgets/categories/${categoryId}/subcategories`,
      data
    );
  }

  updateBudgetCategorySubcategory(
    categoryId: number,
    subcategoryId: number,
    data: UpdateBudgetCategorySubcategoryRequest
  ): Observable<BudgetCategorySubcategory> {
    return this.api.put<BudgetCategorySubcategory>(
      `/budgets/categories/${categoryId}/subcategories/${subcategoryId}`,
      data
    );
  }

  deleteBudgetCategorySubcategory(
    categoryId: number,
    subcategoryId: number
  ): Observable<void> {
    return this.api.delete<void>(
      `/budgets/categories/${categoryId}/subcategories/${subcategoryId}`
    );
  }

  // Buffer reduction
  reduceBufferCategories(categoryId: number, overageAmount: number): Observable<any> {
    return this.api.post<any>(
      `/budgets/categories/${categoryId}/reduce-buffer`,
      { overageAmount }
    );
  }
}

