import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { BudgetService } from '../../services/budget.service';
import { AuthService } from '../../services/auth.service';
import { PlaidService } from '../../services/plaid.service';
import { TransactionService } from '../../services/transaction.service';
import { Budget, TransactionWithCategories, BudgetCategory } from '../../models/budget.model';
import { PlaidLinkComponent } from '../plaid-link/plaid-link.component';
import { BudgetAnalytics } from './budget-analytics/budget-analytics';

@Component({
  selector: 'app-budgets',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, PlaidLinkComponent, BudgetAnalytics],
  templateUrl: './budgets.component.html',
  styleUrl: './budgets.component.scss'
})
export class BudgetsComponent implements OnInit {
  budget = signal<Budget | null>(null);
  loading = signal(false);
  error = signal<string | null>(null);
  
  // Tab management
  activeTab = signal<'summary' | 'transactions' | 'analytics'>('summary');
  
  transactions = signal<TransactionWithCategories[]>([]);
  transactionsLoading = signal(false);
  transactionsError = signal<string | null>(null);
  transactionsOffset = signal(0);
  hasMoreTransactions = signal(true);
  
  syncLoading = signal(false);
  
  balanceSnapshot = signal<{
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
  } | null>(null);
  balanceLoading = signal(false);
  balanceError = signal<string | null>(null);
  editingAccountId = signal<string | null>(null);
  editingAccountName = signal<string>('');

  // Transaction editing
  categories = signal<BudgetCategory[]>([]);
  selectedTransaction = signal<TransactionWithCategories | null>(null);
  splitMode = signal(false);
  splitSplits = signal<Array<{categoryId: number | null; subcategoryId: number | null; amount: string; useRemaining: boolean}>>([]);
  
  // Inline editing state
  editingTransactionId = signal<number | null>(null);
  editingSplits = signal<Map<number, Array<{categoryId: number | null; subcategoryId: number | null; amount: string; useRemaining: boolean}>>>(new Map());

  constructor(
    private budgetService: BudgetService,
    private authService: AuthService,
    private plaidService: PlaidService,
    private transactionService: TransactionService,
    private router: Router
  ) {}

  ngOnInit() {
    this.loadBudget();
    this.loadBalanceSnapshot();
    this.loadTransactions(15, 0);
    this.loadCategories();
  }

  loadBudget() {
    this.loading.set(true);
    this.error.set(null);

    this.budgetService.getBudget().subscribe({
      next: (budget) => {
        this.budget.set(budget);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err.error?.error || 'Failed to load budget');
        this.loading.set(false);
      }
    });
  }

  loadTransactions(limit: number, offset: number) {
    this.transactionsLoading.set(true);
    this.transactionsError.set(null);

    this.transactionService.getTransactions(limit, offset).subscribe({
      next: (transactions) => {
        // Debug: Log first transaction to verify accountName is present
        if (transactions.length > 0 && offset === 0) {
          console.log('[loadTransactions] First transaction accountName:', transactions[0].accountName);
        }
        
        if (offset === 0) {
          this.transactions.set(transactions);
        } else {
          this.transactions.set([...this.transactions(), ...transactions]);
        }
        this.transactionsOffset.set(offset + transactions.length);
        this.hasMoreTransactions.set(transactions.length === limit);
        this.transactionsLoading.set(false);
      },
      error: (err) => {
        this.transactionsError.set(err.error?.error || 'Failed to load transactions');
        this.transactionsLoading.set(false);
      }
    });
  }

  loadMoreTransactions() {
    this.loadTransactions(15, this.transactionsOffset());
  }

  syncTransactions() {
    this.syncLoading.set(true);
    this.transactionService.syncTransactions().subscribe({
      next: (result) => {
        this.syncLoading.set(false);
        // Reload transactions after sync
        this.transactionsOffset.set(0);
        this.loadTransactions(15, 0);
      },
      error: (err) => {
        this.syncLoading.set(false);
        alert(err.error?.error || 'Failed to sync transactions');
      }
    });
  }

  logout() {
    this.authService.logout();
    this.router.navigate(['/login']);
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[date.getMonth()];
    const day = date.getDate();
    const year = date.getFullYear();
    return `${month} ${day} ${year}`;
  }

  formatCurrency(amount: string | number): string {
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(numAmount);
  }

  loadBalanceSnapshot() {
    this.balanceLoading.set(true);
    this.balanceError.set(null);

    this.plaidService.getBalanceSnapshot().subscribe({
      next: (snapshot) => {
        this.balanceSnapshot.set(snapshot);
        this.balanceLoading.set(false);
      },
      error: (err) => {
        // Don't show error if user just hasn't connected accounts yet
        if (err.status !== 404 && err.status !== 500) {
          this.balanceError.set(err.error?.error || 'Failed to load balance snapshot');
        }
        this.balanceLoading.set(false);
      }
    });
  }

  getAssetAccounts() {
    const snapshot = this.balanceSnapshot();
    if (!snapshot) return [];
    return snapshot.accounts.filter(acc => acc.isAsset);
  }

  getLiabilityAccounts() {
    const snapshot = this.balanceSnapshot();
    if (!snapshot) return [];
    return snapshot.accounts.filter(acc => !acc.isAsset);
  }

  getAccountTypeLabel(account: { type?: string | null; subtype?: string | null }): string {
    if (account.subtype) {
      return account.subtype.charAt(0).toUpperCase() + account.subtype.slice(1);
    }
    if (account.type) {
      return account.type.charAt(0).toUpperCase() + account.type.slice(1);
    }
    return 'Account';
  }

  parseAmount(value: string | number): number {
    return typeof value === 'string' ? parseFloat(value) : value;
  }

  loadCategories() {
    this.budgetService.getBudgetCategories().subscribe({
      next: (categories) => {
        // Ensure all categories are included, including Excluded
        // Do NOT filter out any categories here - they should all appear in transaction dropdowns
        this.categories.set(categories);
        // Debug: Log to verify Excluded category is loaded
        const excludedCategory = categories.find(c => c.categoryType === 'excluded');
        if (!excludedCategory) {
          console.warn('Excluded category not found in loaded categories. Categories loaded:', categories.map(c => ({ id: c.id, name: c.name, type: c.categoryType })));
        } else {
          console.log('Excluded category found:', excludedCategory);
        }
      },
      error: (err) => {
        console.error('Failed to load categories:', err);
      }
    });
  }

  quickChangeSubcategory(transactionId: number, categoryIndex: number, subcategoryId: number | null) {
    const transaction = this.transactions().find(t => t.id === transactionId);
    if (!transaction) return;

    const category = transaction.categories[categoryIndex];
    if (!category) return;

    // Store current transaction count to maintain pagination
    const currentCount = this.transactions().length;

    // Update the category assignment with the new subcategoryId
    // For single category transactions, we can just reassign with subcategory
    // For split transactions, we need to update all splits
    if (transaction.categories.length === 1) {
      // Single category - just reassign with subcategory
      this.transactionService.assignTransactionCategory(
        transactionId,
        category.categoryId,
        this.parseAmount(category.amount),
        subcategoryId
      ).subscribe({
        next: () => {
          // Reload all currently visible transactions to maintain pagination state
          this.transactionsOffset.set(0);
          this.loadTransactions(currentCount, 0);
        },
        error: (err) => {
          alert(err.error?.error || 'Failed to update subcategory');
        }
      });
    } else {
      // Split transaction - need to update all splits
      const splits = transaction.categories.map(cat => ({
        categoryId: cat.categoryId,
        subcategoryId: cat.id === category.id ? subcategoryId : (cat.subcategoryId || null),
        amount: this.parseAmount(cat.amount)
      }));
      
      this.transactionService.splitTransaction(transactionId, splits).subscribe({
        next: () => {
          // Reload all currently visible transactions to maintain pagination state
          this.transactionsOffset.set(0);
          this.loadTransactions(currentCount, 0);
        },
        error: (err) => {
          alert(err.error?.error || 'Failed to update subcategory');
        }
      });
    }
  }

  onCategoryChangeInModal(splitIndex: number, newCategoryId: number | null) {
    const splits = this.splitSplits().map((split, i) => {
      if (i === splitIndex) {
        return {
          ...split,
          categoryId: newCategoryId,
          subcategoryId: null // Reset subcategory when category changes
        };
      }
      return split;
    });
    // Create a new array to ensure change detection
    this.splitSplits.set([...splits]);
  }

  onSubcategoryChangeInModal(splitIndex: number, newSubcategoryId: number | null) {
    const splits = this.splitSplits().map((split, i) => {
      if (i === splitIndex) {
        return {
          ...split,
          subcategoryId: newSubcategoryId
        };
      }
      return split;
    });
    // Create a new array to ensure change detection
    this.splitSplits.set([...splits]);
  }

  onAmountChangeInModal(splitIndex: number, newAmount: string) {
    const splits = this.splitSplits().map((split, i) => {
      if (i === splitIndex) {
        return {
          ...split,
          amount: newAmount,
          useRemaining: false // Uncheck useRemaining when manually editing amount
        };
      }
      return split;
    });
    // Create a new array to ensure change detection
    this.splitSplits.set([...splits]);
    // Recalculate useRemaining if needed
    this.recalculateUseRemainingInModal();
  }

  recalculateUseRemainingInModal() {
    const splits = [...this.splitSplits()];
    const hasUseRemaining = splits.some(split => split.useRemaining);
    
    if (hasUseRemaining) {
      splits.forEach((split, i) => {
        if (split.useRemaining) {
          split.amount = this.calculateRemainingAmountInModal(i).toFixed(2);
        }
      });
      this.splitSplits.set([...splits]);
    }
  }

  quickChangeCategory(transactionId: number, categoryIndex: number, newCategoryId: number | null, amount: number) {
    const transaction = this.transactions().find(t => t.id === transactionId);
    if (!transaction) return;

    // If selecting "Uncategorized" (null), remove the category assignment
    if (newCategoryId === null) {
      const category = transaction.categories[categoryIndex];
      if (!category) return;

      this.transactionService.removeTransactionCategory(transactionId, category.categoryId).subscribe({
        next: () => {
          // Reload all currently visible transactions to maintain pagination state
          const currentCount = this.transactions().length;
          this.transactionsOffset.set(0);
          this.loadTransactions(currentCount, 0);
        },
        error: (err) => {
          alert(err.error?.error || 'Failed to remove category');
        }
      });
      return;
    }

    // If this is for an uncategorized transaction (categoryIndex 0 and no categories)
    if (transaction.categories.length === 0 && categoryIndex === 0) {
      // Assign the category
      this.transactionService.assignTransactionCategory(transactionId, newCategoryId, amount).subscribe({
        next: () => {
          // Reload all currently visible transactions to maintain pagination state
          const currentCount = this.transactions().length;
          this.transactionsOffset.set(0);
          this.loadTransactions(currentCount, 0);
        },
        error: (err) => {
          alert(err.error?.error || 'Failed to update category');
        }
      });
    } else if (transaction.categories.length > 1) {
      // This is a split transaction - update all splits, changing only the one at categoryIndex
      const category = transaction.categories[categoryIndex];
      if (!category) return;

      const splits = transaction.categories.map((cat, i) => ({
        categoryId: i === categoryIndex ? newCategoryId : cat.categoryId,
        subcategoryId: i === categoryIndex ? null : (cat.subcategoryId || null), // Reset subcategory when category changes
        amount: this.parseAmount(cat.amount)
      }));

      this.transactionService.splitTransaction(transactionId, splits).subscribe({
        next: () => {
          this.transactionsOffset.set(0);
          this.loadTransactions(15, 0);
        },
        error: (err) => {
          alert(err.error?.error || 'Failed to update category');
        }
      });
    } else {
      // Single category transaction - just update it
      const category = transaction.categories[categoryIndex];
      if (!category) return;

      // Store current transaction count to maintain pagination
      const currentCount = this.transactions().length;

      this.transactionService.assignTransactionCategory(transactionId, newCategoryId, amount, category.subcategoryId || null).subscribe({
        next: () => {
          // Reload all currently visible transactions to maintain pagination state
          this.transactionsOffset.set(0);
          this.loadTransactions(currentCount, 0);
        },
        error: (err) => {
          alert(err.error?.error || 'Failed to update category');
        }
      });
    }
  }

  onCategoryMenuClick(transaction: TransactionWithCategories, categoryIndex: number, event: Event) {
    event.stopPropagation();
    // Open modal with this specific category pre-selected
    this.selectedTransaction.set(transaction);
    // Initialize split mode based on current categories
    if (transaction.categories.length > 1) {
      this.splitMode.set(true);
      this.splitSplits.set(transaction.categories.map(cat => ({
        categoryId: cat.categoryId,
        subcategoryId: cat.subcategoryId || null,
        amount: cat.amount,
        useRemaining: false
      })));
    } else if (transaction.categories.length === 1) {
      this.splitMode.set(false);
      this.splitSplits.set([{
        categoryId: transaction.categories[0].categoryId,
        subcategoryId: null,
        amount: transaction.amount,
        useRemaining: false
      }]);
    } else {
      this.splitMode.set(false);
      this.splitSplits.set([{
        categoryId: null,
        subcategoryId: null,
        amount: transaction.amount,
        useRemaining: false
      }]);
    }
  }

  getCategoryColor(categoryId: number | null): string {
    if (!categoryId) return '#e3f2fd';
    const category = this.categories().find(c => c.id === categoryId);
    return category?.color || '#e3f2fd';
  }

  getCategoryTextColor(categoryId: number | null): string {
    if (!categoryId) return '#1976d2';
    if (this.isExcludedCategory(categoryId)) return '#616161';
    // For colored backgrounds, use white text for better contrast
    const category = this.categories().find(c => c.id === categoryId);
    if (category?.color) {
      // Use white text for colored backgrounds
      return '#fff';
    }
    return '#1976d2';
  }

  onTransactionRowClick(transaction: TransactionWithCategories) {
    this.selectedTransaction.set(transaction);
    // Initialize split mode based on current categories
    if (transaction.categories.length > 1) {
      this.splitMode.set(true);
      this.splitSplits.set(transaction.categories.map(cat => ({
        categoryId: cat.categoryId,
        subcategoryId: cat.subcategoryId || null,
        amount: cat.amount,
        useRemaining: false
      })));
    } else if (transaction.categories.length === 1) {
      this.splitMode.set(false);
      this.splitSplits.set([{
        categoryId: transaction.categories[0].categoryId,
        subcategoryId: null,
        amount: transaction.amount,
        useRemaining: false
      }]);
    } else {
      this.splitMode.set(false);
      this.splitSplits.set([{
        categoryId: null,
        subcategoryId: null,
        amount: transaction.amount,
        useRemaining: false
      }]);
    }
  }

  closeModal() {
    this.selectedTransaction.set(null);
    this.splitMode.set(false);
    this.splitSplits.set([]);
  }


  addSplit() {
    const transaction = this.selectedTransaction();
    if (!transaction) return;

    const currentTotal = this.splitSplits().reduce((sum, split, i) => {
      if (split.useRemaining) {
        return sum + this.calculateRemainingAmountInModal(i);
      }
      return sum + parseFloat(split.amount || '0');
    }, 0);
    const remaining = parseFloat(transaction.amount) - currentTotal;

    this.splitSplits.set([
      ...this.splitSplits(),
      {
        categoryId: null,
        subcategoryId: null,
        amount: remaining > 0 ? remaining.toFixed(2) : '0.00',
        useRemaining: false
      }
    ]);
  }

  removeSplit(index: number) {
    if (this.splitSplits().length <= 1) return;
    const newSplits = this.splitSplits().filter((_, i) => i !== index);
    this.splitSplits.set(newSplits);
  }

  getSplitTotal(): number {
    return this.splitSplits().reduce((sum, split, i) => {
      if (split.useRemaining) {
        return sum + this.calculateRemainingAmountInModal(i);
      }
      return sum + parseFloat(split.amount || '0');
    }, 0);
  }

  calculateRemainingAmountInModal(excludeIndex: number): number {
    const transaction = this.selectedTransaction();
    if (!transaction) return 0;
    
    const transactionTotal = parseFloat(transaction.amount);
    const otherSplitsTotal = this.splitSplits().reduce((sum, split, i) => {
      if (i === excludeIndex) return sum;
      if (split.useRemaining) return sum; // Don't count other useRemaining splits
      return sum + parseFloat(split.amount || '0');
    }, 0);
    
    return Math.max(0, transactionTotal - otherSplitsTotal);
  }

  toggleUseRemainingInModal(index: number) {
    const splits = [...this.splitSplits()];
    const newValue = !splits[index].useRemaining;
    
    // Uncheck all other useRemaining checkboxes
    splits.forEach((split, i) => {
      if (i === index) {
        split.useRemaining = newValue;
        if (newValue) {
          split.amount = this.calculateRemainingAmountInModal(i).toFixed(2);
        }
      } else {
        split.useRemaining = false;
      }
    });
    
    this.splitSplits.set(splits);
  }

  getSplitValidationError(): string | null {
    const transaction = this.selectedTransaction();
    if (!transaction) return null;

    const total = this.getSplitTotal();
    const transactionAmount = parseFloat(transaction.amount);
    const difference = Math.abs(total - transactionAmount);

    if (difference > 0.01) {
      return `Split total (${this.formatCurrency(total)}) must equal transaction amount (${this.formatCurrency(transactionAmount)})`;
    }

    // Check all splits have categories
    for (const split of this.splitSplits()) {
      if (!split.categoryId) {
        return 'All splits must have a category selected';
      }
      
      // Check if category has subcategories and if subcategory is selected
      if (this.hasSubcategories(split.categoryId)) {
        if (!split.subcategoryId) {
          const category = this.categories().find(c => c.id === split.categoryId);
          return `Please select a subcategory for "${category?.name || 'this category'}"`;
        }
      }
      
      const amount = split.useRemaining ? this.calculateRemainingAmountInModal(this.splitSplits().indexOf(split)) : parseFloat(split.amount || '0');
      if (amount <= 0) {
        return 'All splits must have an amount greater than 0';
      }
    }

    return null;
  }

  saveSplit() {
    const transaction = this.selectedTransaction();
    if (!transaction) return;

    const error = this.getSplitValidationError();
    if (error) {
      alert(error);
      return;
    }

    const splits = this.splitSplits().map((split, i) => ({
      categoryId: split.categoryId!,
      subcategoryId: split.subcategoryId || null,
      amount: split.useRemaining ? this.calculateRemainingAmountInModal(i) : parseFloat(split.amount || '0')
    }));

    // Store current transaction count to maintain pagination
    const currentCount = this.transactions().length;

    this.transactionService.splitTransaction(transaction.id, splits).subscribe({
      next: () => {
        this.closeModal();
        // Reload all currently visible transactions to maintain pagination state
        this.transactionsOffset.set(0);
        this.loadTransactions(currentCount, 0);
      },
      error: (err) => {
        alert(err.error?.error || 'Failed to save split');
      }
    });
  }

  saveSingleCategory() {
    const transaction = this.selectedTransaction();
    if (!transaction) return;

    const split = this.splitSplits()[0];
    if (!split || !split.categoryId) {
      alert('Please select a category');
      return;
    }

    // Check if category has subcategories and if subcategory is selected
    if (this.hasSubcategories(split.categoryId)) {
      if (!split.subcategoryId) {
        const category = this.categories().find(c => c.id === split.categoryId);
        alert(`Please select a subcategory for "${category?.name || 'this category'}"`);
        return;
      }
    }

    // Store current transaction count to maintain pagination
    const currentCount = this.transactions().length;

    this.transactionService.assignTransactionCategory(
      transaction.id,
      split.categoryId,
      parseFloat(split.amount || transaction.amount),
      split.subcategoryId || null
    ).subscribe({
      next: () => {
        this.closeModal();
        // Reload all currently visible transactions to maintain pagination state
        this.transactionsOffset.set(0);
        this.loadTransactions(currentCount, 0);
      },
      error: (err) => {
        alert(err.error?.error || 'Failed to save category');
      }
    });
  }

  toggleSplitMode() {
    const transaction = this.selectedTransaction();
    if (!transaction) return;

    this.splitMode.set(!this.splitMode());
    
    if (this.splitMode()) {
      // Switch to split mode - initialize with current single category or empty
      if (this.splitSplits().length === 1 && this.splitSplits()[0].categoryId) {
        // Keep the current category as first split
        this.splitSplits.set([{
          categoryId: this.splitSplits()[0].categoryId,
          subcategoryId: this.splitSplits()[0].subcategoryId,
          amount: this.splitSplits()[0].amount,
          useRemaining: false
        }]);
      } else {
        // Start fresh
        this.splitSplits.set([{
          categoryId: null,
          subcategoryId: null,
          amount: transaction.amount,
          useRemaining: false
        }]);
      }
    } else {
      // Switch to single mode - combine all splits into one
      const total = this.getSplitTotal();
      const firstCategory = this.splitSplits()[0]?.categoryId || null;
      const firstSubcategory = this.splitSplits()[0]?.subcategoryId || null;
      this.splitSplits.set([{
        categoryId: firstCategory,
        subcategoryId: firstSubcategory,
        amount: total.toFixed(2),
        useRemaining: false
      }]);
    }
  }

  getCategoryName(categoryId: number | null): string {
    if (!categoryId) return 'Select category...';
    const category = this.categories().find(c => c.id === categoryId);
    return category?.name || 'Unknown';
  }

  isExcludedCategory(categoryId: number | null): boolean {
    if (!categoryId) return false;
    const category = this.categories().find(c => c.id === categoryId);
    return category?.categoryType === 'excluded';
  }

  startEditingAccountName(account: { accountId: string; name: string; originalName: string; customName?: string | null }) {
    this.editingAccountId.set(account.accountId);
    this.editingAccountName.set(account.customName || account.originalName);
  }

  cancelEditingAccountName() {
    this.editingAccountId.set(null);
    this.editingAccountName.set('');
  }

  saveAccountName(accountId: string) {
    const customName = this.editingAccountName().trim() || null;
    const snapshot = this.balanceSnapshot();
    if (!snapshot) return;

    // Find the account to get original name
    const account = snapshot.accounts.find(acc => acc.accountId === accountId);
    if (!account) return;

    // If custom name matches original, set to null
    const finalCustomName = customName === account.originalName ? null : customName;

    this.plaidService.updateAccountName(accountId, finalCustomName).subscribe({
      next: () => {
        // Update local snapshot
        const updatedAccounts = snapshot.accounts.map(acc => {
          if (acc.accountId === accountId) {
            return {
              ...acc,
              name: finalCustomName || acc.originalName,
              customName: finalCustomName
            };
          }
          return acc;
        });
        this.balanceSnapshot.set({
          ...snapshot,
          accounts: updatedAccounts
        });
        this.cancelEditingAccountName();
        
        // Reload transactions to show updated account names
        const currentCount = this.transactions().length;
        this.transactionsOffset.set(0);
        this.loadTransactions(currentCount, 0);
      },
      error: (err) => {
        alert(err.error?.error || 'Failed to update account name');
      }
    });
  }

  // Inline editing methods
  getSplitsForTransaction(transactionId: number): Array<{categoryId: number | null; subcategoryId: number | null; amount: string; useRemaining: boolean}> {
    const transaction = this.transactions().find(t => t.id === transactionId);
    if (!transaction) return [];

    // If editing, return editing splits
    if (this.editingTransactionId() === transactionId) {
      const editingSplits = this.editingSplits().get(transactionId);
      if (editingSplits) {
        return editingSplits;
      }
    }

    // Otherwise, return current transaction categories
    if (transaction.categories.length === 0) {
      return [{
        categoryId: null,
        subcategoryId: null,
        amount: transaction.amount,
        useRemaining: false
      }];
    }

    return transaction.categories.map(cat => ({
      categoryId: cat.categoryId,
      subcategoryId: cat.subcategoryId || null,
      amount: cat.amount,
      useRemaining: false
    }));
  }

  getSubcategoriesForCategory(categoryId: number | null): Array<{id: number; name: string}> {
    if (!categoryId) return [];
    // Force reactivity by accessing the categories signal
    const categories = this.categories();
    const category = categories.find(c => c.id === categoryId);
    if (!category || !category.subcategories) return [];
    return category.subcategories.map(sub => ({ id: sub.id, name: sub.name }));
  }

  hasSubcategories(categoryId: number | null): boolean {
    return this.getSubcategoriesForCategory(categoryId).length > 0;
  }

  toggleInlineSplitMode(transactionId: number) {
    const transaction = this.transactions().find(t => t.id === transactionId);
    if (!transaction) return;

    if (this.editingTransactionId() === transactionId) {
      // Currently editing - toggle split mode
      const currentSplits = this.editingSplits().get(transactionId) || [];
      if (currentSplits.length > 1) {
        // Remove split mode - combine into one
        const total = currentSplits.reduce((sum, split) => {
          if (split.useRemaining) {
            return sum + this.calculateRemainingAmount(transactionId, currentSplits.indexOf(split));
          }
          return sum + parseFloat(split.amount || '0');
        }, 0);
        const firstCategory = currentSplits[0]?.categoryId || null;
        this.editingSplits().set(transactionId, [{
          categoryId: firstCategory,
          subcategoryId: currentSplits[0]?.subcategoryId || null,
          amount: total.toFixed(2),
          useRemaining: false
        }]);
        this.editingSplits.set(new Map(this.editingSplits()));
      } else {
        // Add split mode - split current into two
        const currentSplit = currentSplits[0] || {
          categoryId: null,
          subcategoryId: null,
          amount: transaction.amount,
          useRemaining: false
        };
        const halfAmount = (parseFloat(currentSplit.amount) / 2).toFixed(2);
        this.editingSplits().set(transactionId, [
          {
            categoryId: currentSplit.categoryId,
            subcategoryId: currentSplit.subcategoryId,
            amount: halfAmount,
            useRemaining: false
          },
          {
            categoryId: null,
            subcategoryId: null,
            amount: halfAmount,
            useRemaining: false
          }
        ]);
        this.editingSplits.set(new Map(this.editingSplits()));
      }
    } else {
      // Start editing - immediately split into 2 if currently single category
      this.editingTransactionId.set(transactionId);
      const splits = this.getSplitsForTransaction(transactionId);
      
      if (splits.length === 1) {
        // Split into 2 rows
        const currentSplit = splits[0];
        const halfAmount = (parseFloat(currentSplit.amount) / 2).toFixed(2);
        this.editingSplits().set(transactionId, [
          {
            categoryId: currentSplit.categoryId,
            subcategoryId: currentSplit.subcategoryId,
            amount: halfAmount,
            useRemaining: false
          },
          {
            categoryId: null,
            subcategoryId: null,
            amount: halfAmount,
            useRemaining: false
          }
        ]);
      } else {
        // Already has multiple splits, just enter edit mode
        this.editingSplits().set(transactionId, [...splits]);
      }
      this.editingSplits.set(new Map(this.editingSplits()));
    }
  }

  addSplitRow(transactionId: number) {
    const transaction = this.transactions().find(t => t.id === transactionId);
    if (!transaction) return;

    const currentSplits = this.editingSplits().get(transactionId) || [];
    const remaining = this.calculateRemainingAmount(transactionId, -1);
    
    currentSplits.push({
      categoryId: null,
      subcategoryId: null,
      amount: remaining > 0 ? remaining.toFixed(2) : '0.00',
      useRemaining: false
    });
    
    this.editingSplits().set(transactionId, currentSplits);
    this.editingSplits.set(new Map(this.editingSplits()));
  }

  removeSplitRow(transactionId: number, index: number) {
    const currentSplits = this.editingSplits().get(transactionId) || [];
    if (currentSplits.length <= 1) return;
    
    const newSplits = currentSplits.filter((_, i) => i !== index);
    this.editingSplits().set(transactionId, newSplits);
    this.editingSplits.set(new Map(this.editingSplits()));
    
    // If any split had useRemaining, recalculate
    this.recalculateUseRemaining(transactionId);
  }

  updateSplitAmount(transactionId: number, index: number, amount: string) {
    const currentSplits = this.editingSplits().get(transactionId) || [];
    if (!currentSplits[index]) return;
    
    currentSplits[index] = {
      ...currentSplits[index],
      amount: amount,
      useRemaining: false // Uncheck useRemaining when manually editing amount
    };
    
    this.editingSplits().set(transactionId, currentSplits);
    this.editingSplits.set(new Map(this.editingSplits()));
    this.recalculateUseRemaining(transactionId);
  }

  updateSplitCategory(transactionId: number, index: number, categoryId: number | null) {
    const currentSplits = this.editingSplits().get(transactionId) || [];
    if (!currentSplits[index]) return;
    
    currentSplits[index] = {
      ...currentSplits[index],
      categoryId: categoryId,
      subcategoryId: null // Reset subcategory when category changes
    };
    
    this.editingSplits().set(transactionId, currentSplits);
    this.editingSplits.set(new Map(this.editingSplits()));
  }

  updateSplitSubcategory(transactionId: number, index: number, subcategoryId: number | null) {
    const currentSplits = this.editingSplits().get(transactionId) || [];
    if (!currentSplits[index]) return;
    
    currentSplits[index] = {
      ...currentSplits[index],
      subcategoryId: subcategoryId
    };
    
    this.editingSplits().set(transactionId, currentSplits);
    this.editingSplits.set(new Map(this.editingSplits()));
  }

  toggleUseRemaining(transactionId: number, index: number) {
    const currentSplits = this.editingSplits().get(transactionId) || [];
    if (!currentSplits[index]) return;
    
    const newValue = !currentSplits[index].useRemaining;
    
    // Uncheck all other useRemaining checkboxes
    currentSplits.forEach((split, i) => {
      if (i === index) {
        split.useRemaining = newValue;
        if (newValue) {
          split.amount = this.calculateRemainingAmount(transactionId, index).toFixed(2);
        }
      } else {
        split.useRemaining = false;
      }
    });
    
    this.editingSplits().set(transactionId, currentSplits);
    this.editingSplits.set(new Map(this.editingSplits()));
  }

  calculateRemainingAmount(transactionId: number, excludeIndex: number): number {
    const transaction = this.transactions().find(t => t.id === transactionId);
    if (!transaction) return 0;
    
    const currentSplits = this.editingSplits().get(transactionId) || [];
    const transactionTotal = parseFloat(transaction.amount);
    
    const otherSplitsTotal = currentSplits.reduce((sum, split, i) => {
      if (i === excludeIndex) return sum;
      if (split.useRemaining) return sum; // Don't count other useRemaining splits
      return sum + parseFloat(split.amount || '0');
    }, 0);
    
    return Math.max(0, transactionTotal - otherSplitsTotal);
  }

  recalculateUseRemaining(transactionId: number) {
    const currentSplits = this.editingSplits().get(transactionId) || [];
    const hasUseRemaining = currentSplits.some(split => split.useRemaining);
    
    if (hasUseRemaining) {
      currentSplits.forEach((split, i) => {
        if (split.useRemaining) {
          split.amount = this.calculateRemainingAmount(transactionId, i).toFixed(2);
        }
      });
      this.editingSplits().set(transactionId, currentSplits);
      this.editingSplits.set(new Map(this.editingSplits()));
    }
  }

  getInlineSplitTotal(transactionId: number): number {
    const currentSplits = this.editingSplits().get(transactionId) || [];
    return currentSplits.reduce((sum, split, i) => {
      if (split.useRemaining) {
        return sum + this.calculateRemainingAmount(transactionId, i);
      }
      return sum + parseFloat(split.amount || '0');
    }, 0);
  }

  getInlineSplitValidationError(transactionId: number): string | null {
    const transaction = this.transactions().find(t => t.id === transactionId);
    if (!transaction) return null;

    const total = this.getInlineSplitTotal(transactionId);
    const transactionAmount = parseFloat(transaction.amount);
    const difference = Math.abs(total - transactionAmount);

    if (difference > 0.01) {
      return `Split amounts (${this.formatCurrency(total)}) don't match transaction total (${this.formatCurrency(transactionAmount)})`;
    }

    // Check all splits have categories
    const currentSplits = this.editingSplits().get(transactionId) || [];
    for (const split of currentSplits) {
      if (!split.categoryId) {
        return 'All splits must have a category selected';
      }
      const amount = split.useRemaining ? this.calculateRemainingAmount(transactionId, currentSplits.indexOf(split)) : parseFloat(split.amount || '0');
      if (amount <= 0) {
        return 'All splits must have an amount greater than 0';
      }
    }

    return null;
  }

  saveInlineSplits(transactionId: number) {
    const error = this.getInlineSplitValidationError(transactionId);
    if (error) {
      alert(error);
      return;
    }

    const currentSplits = this.editingSplits().get(transactionId) || [];
    const splits = currentSplits.map((split, i) => ({
      categoryId: split.categoryId!,
      amount: split.useRemaining ? this.calculateRemainingAmount(transactionId, i) : parseFloat(split.amount || '0')
    }));

    if (splits.length === 1) {
      // Single category assignment
      this.transactionService.assignTransactionCategory(transactionId, splits[0].categoryId, splits[0].amount).subscribe({
        next: () => {
          this.cancelInlineEdit(transactionId);
          this.transactionsOffset.set(0);
          this.loadTransactions(15, 0);
        },
        error: (err) => {
          alert(err.error?.error || 'Failed to save category');
        }
      });
    } else {
      // Split transaction
      this.transactionService.splitTransaction(transactionId, splits).subscribe({
        next: () => {
          this.cancelInlineEdit(transactionId);
          this.transactionsOffset.set(0);
          this.loadTransactions(15, 0);
        },
        error: (err) => {
          alert(err.error?.error || 'Failed to save split');
        }
      });
    }
  }

  cancelInlineEdit(transactionId: number) {
    this.editingTransactionId.set(null);
    this.editingSplits().delete(transactionId);
    this.editingSplits.set(new Map(this.editingSplits()));
  }
}

