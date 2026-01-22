export type FilingStatus = 'single' | 'married-jointly' | 'married-separately' | 'head-of-household';

export type CategoryType = 'fixed' | 'savings' | 'variable' | 'surplus' | 'excluded';

export type AutoSurplusDestination = 'rollover' | 'savings' | null;

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
  rolloverBalance?: string; // Rollover balance for variable/fixed, total for savings
  color?: string | null;
  // Variable category fields - surplus handling
  autoSurplusDestination?: AutoSurplusDestination;
  surplusTargetCategoryId?: number | null;
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
  rolloverBalance?: string;
  color?: string | null;
  // Variable category fields - surplus handling
  autoSurplusDestination?: AutoSurplusDestination;
  surplusTargetCategoryId?: number | null;
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
  rolloverBalance?: string;
  color?: string | null;
  // Variable category fields - surplus handling
  autoSurplusDestination?: AutoSurplusDestination;
  surplusTargetCategoryId?: number | null;
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
  itemId: number | null;
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

// New monthly snapshot interface (replaces MonthlyCategorySummary for most uses)
export interface MonthlySnapshot {
  id: number;
  userId: number;
  budgetId: number;
  categoryId: number;
  year: number;
  month: number;
  allotment: string;
  spent: string;
  surplusGiven: string;
  deficitReceived: string;
  finalRolloverBalance: string;
  isLocked: boolean;
  createdAt: string;
  updatedAt: string;
}

// Legacy - kept for backwards compatibility
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
  transferType: string; // 'surplus_to_savings', 'surplus_to_rollover', 'cover_deficit', etc.
  sourceType: string; // 'surplus', 'rollover', 'savings'
  relatedCategoryId: number | null;
  isAutomatic: boolean;
  month: number;
  year: number;
  description?: string | null;
  createdAt: string;
}

// Legacy - kept for backwards compatibility with analytics
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
