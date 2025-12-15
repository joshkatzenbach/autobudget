export type FilingStatus = 'single' | 'married-jointly' | 'married-separately' | 'head-of-household';

export type CategoryType = 'fixed' | 'savings' | 'variable' | 'surplus' | 'excluded';

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
  goalLimit?: string | null;
  color?: string | null;
  // Variable category fields
  autoMoveSurplus?: boolean;
  surplusTargetCategoryId?: number | null;
  autoMoveDeficit?: boolean;
  deficitSourceCategoryId?: number | null;
  // Fixed category fields
  expectedMerchantName?: string | null;
  hideFromTransactionLists?: boolean;
  // Savings category fields
  isTaxDeductible?: boolean;
  isSubjectToFica?: boolean;
  isUnconnectedAccount?: boolean;
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
  color?: string | null;
  // Variable category fields
  autoMoveSurplus?: boolean;
  surplusTargetCategoryId?: number | null;
  autoMoveDeficit?: boolean;
  deficitSourceCategoryId?: number | null;
  // Fixed category fields
  expectedMerchantName?: string | null;
  hideFromTransactionLists?: boolean;
  // Savings category fields
  isTaxDeductible?: boolean;
  isSubjectToFica?: boolean;
  isUnconnectedAccount?: boolean;
}

export interface UpdateBudgetCategoryRequest {
  name?: string;
  allocatedAmount?: string;
  spentAmount?: string;
  categoryType?: CategoryType;
  accumulatedTotal?: string;
  color?: string | null;
  // Variable category fields
  autoMoveSurplus?: boolean;
  surplusTargetCategoryId?: number | null;
  autoMoveDeficit?: boolean;
  deficitSourceCategoryId?: number | null;
  // Fixed category fields
  expectedMerchantName?: string | null;
  hideFromTransactionLists?: boolean;
  // Savings category fields
  isTaxDeductible?: boolean;
  isSubjectToFica?: boolean;
  isUnconnectedAccount?: boolean;
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
  amount: string;
  isManual: boolean;
  categoryName?: string;
}

export interface TransactionWithCategories extends Transaction {
  categories: TransactionCategory[];
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
  accumulatedTotal?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FundMovement {
  id: number;
  userId: number;
  budgetId: number;
  fromCategoryId: number | null;
  toCategoryId: number | null;
  amount: string;
  movementType: 'surplus' | 'deficit';
  variableCategoryId: number;
  month: number;
  year: number;
  createdAt: string;
}

export interface SavingsSnapshot {
  id: number;
  userId: number;
  budgetId: number;
  categoryId: number;
  year: number;
  month: number;
  accumulatedTotal: string;
  createdAt: string;
}

