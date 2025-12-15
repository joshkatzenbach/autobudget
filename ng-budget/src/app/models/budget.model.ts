export type FilingStatus = 'single' | 'married-jointly' | 'married-separately' | 'head-of-household';

export type CategoryType = 'expected' | 'savings' | 'variable' | 'surplus' | 'excluded';

export interface Budget {
  id: number;
  userId: number;
  name: string;
  startDate: string;
  endDate: string;
  income: string; // Monthly income
  taxRate: string; // Effective tax rate as percentage (calculated)
  filingStatus: FilingStatus;
  deductions: string; // Additional deductions beyond standard
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetCategory {
  id: number;
  budgetId: number;
  name: string;
  description?: string | null;
  allocatedAmount: string;
  spentAmount: string;
  categoryType: CategoryType;
  accumulatedTotal?: string;
  billCount?: number | null;
  thresholdAmount?: string | null;
  estimationMonths?: number;
  isBufferCategory?: boolean;
  bufferPriority?: number;
  goalLimit?: string | null;
  color?: string | null;
  subcategories?: BudgetCategorySubcategory[];
  createdAt: string;
  updatedAt: string;
}

export interface BudgetCategorySubcategory {
  id: number;
  categoryId: number;
  name: string;
  expectedAmount: string;
  actualAmount?: string | null;
  billDate?: string | null;
  useEstimation?: boolean;
  estimationMonths?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBudgetRequest {
  name: string;
  startDate: string;
  endDate: string;
  income: string; // Monthly income
  taxRate?: string; // Effective tax rate as percentage (calculated)
  filingStatus?: FilingStatus;
  deductions?: string; // Additional deductions beyond standard
}

export interface UpdateBudgetRequest {
  name?: string;
  startDate?: string;
  endDate?: string;
  income?: string;
  repeatPattern?: string;
  isActive?: boolean;
}

export interface CreateBudgetCategoryRequest {
  name: string;
  allocatedAmount: string;
  categoryType?: CategoryType;
  accumulatedTotal?: string;
  estimationMonths?: number;
  isBufferCategory?: boolean;
  bufferPriority?: number;
  color?: string | null;
}

export interface UpdateBudgetCategoryRequest {
  name?: string;
  allocatedAmount?: string;
  spentAmount?: string;
  categoryType?: CategoryType;
  accumulatedTotal?: string;
  estimationMonths?: number;
  isBufferCategory?: boolean;
  bufferPriority?: number;
  color?: string | null;
}

export interface CreateBudgetCategorySubcategoryRequest {
  name: string;
  expectedAmount: string;
  useEstimation?: boolean;
  estimationMonths?: number;
}

export interface UpdateBudgetCategorySubcategoryRequest {
  name?: string;
  expectedAmount?: string;
  actualAmount?: string | null;
  billDate?: string | null;
  useEstimation?: boolean;
  estimationMonths?: number;
}

export interface Transaction {
  id: number;
  userId: number;
  itemId: number;
  accountId: string;
  transactionId: string;
  amount: string;
  merchantName: string | null;
  name: string;
  date: string;
  plaidCategory: string | null;
  plaidCategoryId: string | null;
  isPending: boolean;
  isReviewed: boolean;
  createdAt: string;
  updatedAt: string;
  accountName?: string | null;
  accountMask?: string | null;
}

export interface TransactionCategory {
  id: number;
  categoryId: number;
  subcategoryId?: number | null;
  amount: string;
  isManual: boolean;
  categoryName?: string;
}

export interface TransactionWithCategories extends Transaction {
  categories: TransactionCategory[];
}

export interface TransactionCategoryOverride {
  id: number;
  userId: number;
  merchantName: string | null;
  plaidCategoryId: string | null;
  categoryId: number;
  createdAt: string;
  updatedAt: string;
}

export interface MonthlyCategorySummary {
  id: number;
  userId: number;
  budgetId: number | null;
  categoryId: number;
  year: number;
  month: number;
  totalSpent: string;
  transactionCount: number;
  createdAt: string;
  updatedAt: string;
}

