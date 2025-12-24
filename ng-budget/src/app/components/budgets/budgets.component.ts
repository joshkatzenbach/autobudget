import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { BudgetService } from '../../services/budget.service';
import { AuthService } from '../../services/auth.service';
import { PlaidService, ConnectedAccount } from '../../services/plaid.service';
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
  activeTab = signal<'summary' | 'transactions' | 'analytics' | 'edit' | 'test'>('summary');
  
  // Test tab state
  generatingTestTransaction = signal(false);
  testTransactionError = signal<string | null>(null);
  testTransactionSuccess = signal<string | null>(null);
  
  transactions = signal<TransactionWithCategories[]>([]);
  transactionsLoading = signal(false);
  transactionsError = signal<string | null>(null);
  transactionsOffset = signal(0);
  hasMoreTransactions = signal(true);
  reviewedFilter = signal<'all' | 'reviewed' | 'unreviewed'>('all');
  showHiddenFixed = signal(false); // Toggle to show/hide Fixed categories with hideFromTransactionLists
  
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
  splitSplits = signal<Array<{categoryId: number | null; amount: string; useRemaining: boolean}>>([]);
  
  // Inline editing state
  editingTransactionId = signal<number | null>(null);
  editingSplits = signal<Map<number, Array<{categoryId: number | null; amount: string; useRemaining: boolean}>>>(new Map());

  // Connected accounts management
  connectedAccounts = signal<ConnectedAccount[]>([]);
  connectedAccountsLoading = signal(false);
  disconnectingItemId = signal<number | null>(null);
  showDisconnectModal = signal(false);
  disconnectItemId = signal<number | null>(null);
  disconnectItemName = signal<string>('');
  keepTransactionsOnDisconnect = signal(true);

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
    this.loadConnectedAccounts();
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

    const reviewed = this.reviewedFilter() === 'all' ? null : this.reviewedFilter() === 'reviewed';

    this.transactionService.getTransactions(limit, offset, reviewed).subscribe({
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

  navigateToSlackIntegration() {
    this.router.navigate(['/settings/slack']);
  }

  navigateToEditBudget() {
    this.router.navigate(['/budgets/edit']);
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

  loadConnectedAccounts() {
    this.connectedAccountsLoading.set(true);
    this.plaidService.getAccounts().subscribe({
      next: (accounts) => {
        this.connectedAccounts.set(accounts);
        this.connectedAccountsLoading.set(false);
      },
      error: (err) => {
        console.error('Error loading connected accounts:', err);
        this.connectedAccountsLoading.set(false);
      }
    });
  }

  openDisconnectModal(itemId: number, institutionName: string | null) {
    this.disconnectItemId.set(itemId);
    this.disconnectItemName.set(institutionName || 'Unknown Institution');
    this.keepTransactionsOnDisconnect.set(true);
    this.showDisconnectModal.set(true);
  }

  closeDisconnectModal() {
    this.showDisconnectModal.set(false);
    this.disconnectItemId.set(null);
    this.disconnectItemName.set('');
    this.keepTransactionsOnDisconnect.set(true);
  }

  confirmDisconnect() {
    const itemId = this.disconnectItemId();
    if (!itemId) return;

    this.disconnectingItemId.set(itemId);
    const keepTransactions = this.keepTransactionsOnDisconnect();

    this.plaidService.deleteItem(itemId, keepTransactions).subscribe({
      next: () => {
        // Reload connected accounts and balance snapshot
        this.loadConnectedAccounts();
        this.loadBalanceSnapshot();
        // Reload transactions if we deleted them
        if (!keepTransactions) {
          this.loadTransactions(15, 0);
        }
        this.closeDisconnectModal();
        this.disconnectingItemId.set(null);
      },
      error: (err) => {
        console.error('Error disconnecting account:', err);
        alert(err.error?.error || 'Failed to disconnect account');
        this.disconnectingItemId.set(null);
      }
    });
  }

  getAssetAccounts() {
    const snapshot = this.balanceSnapshot();
    if (!snapshot) return [];
    const plaidAccounts = snapshot.accounts.filter(acc => acc.isAsset);
    
    // Add unconnected savings accounts as virtual accounts
    const unconnectedSavings = this.categories()
      .filter(cat => cat.categoryType === 'savings' && cat.isUnconnectedAccount)
      .map(cat => ({
        accountId: `unconnected_${cat.id}`,
        name: cat.name,
        originalName: cat.name,
        customName: null,
        type: 'depository',
        subtype: 'savings',
        balance: parseFloat(cat.accumulatedTotal || '0'),
        mask: null,
        institutionName: 'Unconnected Account',
        isAsset: true
      }));
    
    return [...plaidAccounts, ...unconnectedSavings];
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

  formatTransactionAmount(amount: string | number): string {
    const numAmount = this.parseAmount(amount);
    // See PLAID_AMOUNT_CONVENTION.md for full documentation
    // Plaid convention: positive = debits (outgoing), negative = credits (incoming)
    // Outgoing money: show as positive (no sign)
    // Incoming money: show with + sign
    if (numAmount > 0) {
      // Outgoing transaction (positive/debit) - show as positive number (no sign)
      return this.formatCurrency(numAmount);
    } else {
      // Incoming transaction (negative/credit) - show with + sign
      return `+${this.formatCurrency(Math.abs(numAmount))}`;
    }
  }

  isIncomingTransaction(amount: string | number): boolean {
    return this.parseAmount(amount) < 0;
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


  onCategoryChangeInModal(splitIndex: number, newCategoryId: number | null) {
    const splits = this.splitSplits().map((split, i) => {
      if (i === splitIndex) {
        return {
          ...split,
          categoryId: newCategoryId
        };
      }
      return split;
    });
    // Create a new array to ensure change detection
    this.splitSplits.set([...splits]);
  }

  onAmountChangeInModal(splitIndex: number, newAmount: string) {
    const splits = [...this.splitSplits()];
    const isLastSplit = splitIndex === splits.length - 1;
    
    // Don't allow editing the last split's amount (it uses remaining)
    if (isLastSplit) {
      return;
    }
    
    splits[splitIndex] = {
      ...splits[splitIndex],
      amount: newAmount
    };
    
    this.splitSplits.set(splits);
    // Update the last split's amount when other amounts change
    this.updateLastSplitAmount();
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

      this.transactionService.assignTransactionCategory(transactionId, newCategoryId, amount).subscribe({
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
        amount: cat.amount,
        useRemaining: false
      })));
    } else if (transaction.categories.length === 1) {
      this.splitMode.set(false);
      this.splitSplits.set([{
        categoryId: transaction.categories[0].categoryId,
        amount: transaction.amount,
        useRemaining: false
      }]);
    } else {
      this.splitMode.set(false);
      this.splitSplits.set([{
        categoryId: null,
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
      // For split transactions, all but the last get fixed amounts
      // The last one will automatically use remaining
      const splits = transaction.categories.map((cat, i) => ({
        categoryId: cat.categoryId,
        amount: cat.amount,
        useRemaining: false
      }));
      this.splitSplits.set(splits);
      // Update the last split to reflect it uses remaining
      this.updateLastSplitAmount();
    } else if (transaction.categories.length === 1) {
      this.splitMode.set(false);
      // Use the category amount (which is the portion assigned to this category)
      // For single category, this should be the absolute value of the transaction amount
      const categoryAmount = transaction.categories[0].amount;
      this.splitSplits.set([{
        categoryId: transaction.categories[0].categoryId,
        amount: categoryAmount,
        useRemaining: false
      }]);
    } else {
      this.splitMode.set(false);
      // For uncategorized transactions, use the absolute value of the transaction amount
      const transactionAmount = Math.abs(parseFloat(transaction.amount)).toFixed(2);
      this.splitSplits.set([{
        categoryId: null,
        amount: transactionAmount,
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

    // Calculate current total from all non-last splits (last split uses remaining)
    const splits = [...this.splitSplits()];
    const transactionAmount = Math.abs(parseFloat(transaction.amount));
    
    // Calculate total from all splits except the last one (if it exists)
    const nonLastTotal = splits.slice(0, -1).reduce((sum, split) => {
      return sum + parseFloat(split.amount || '0');
    }, 0);
    
    // Update the previous last split to have a fixed amount (half of remaining, or a reasonable default)
    if (splits.length > 0) {
      const remainingBeforeNew = transactionAmount - nonLastTotal;
      const newAmount = (remainingBeforeNew / 2).toFixed(2);
      splits[splits.length - 1] = {
        ...splits[splits.length - 1],
        amount: newAmount,
        useRemaining: false
      };
    }

    // Add new split (will become the last one and use remaining)
    splits.push({
      categoryId: null,
      amount: '0.00', // Will be calculated as remaining
      useRemaining: false
    });

    this.splitSplits.set(splits);
    // Recalculate the last split amount
    this.updateLastSplitAmount();
  }

  removeSplit(index: number) {
    if (this.splitSplits().length <= 1) return;
    const newSplits = this.splitSplits().filter((_, i) => i !== index);
    this.splitSplits.set(newSplits);
    // After removing, ensure the last split uses remaining
    this.updateLastSplitAmount();
  }

  getSplitTotal(): number {
    const splits = this.splitSplits();
    if (splits.length === 0) return 0;
    
    // Sum all splits except the last one
    const nonLastTotal = splits.slice(0, -1).reduce((sum, split) => {
      return sum + parseFloat(split.amount || '0');
    }, 0);
    
    // Add the last split's remaining amount
    const lastIndex = splits.length - 1;
    const lastAmount = this.calculateRemainingAmountInModal(lastIndex);
    
    return nonLastTotal + lastAmount;
  }

  calculateRemainingAmountInModal(excludeIndex: number): number {
    const transaction = this.selectedTransaction();
    if (!transaction) return 0;
    
    const transactionAmount = Math.abs(parseFloat(transaction.amount));
    const otherSplitsTotal = this.splitSplits().reduce((sum, split, i) => {
      if (i === excludeIndex) return sum;
      // Only count non-last splits (last split uses remaining)
      const isLastSplit = i === this.splitSplits().length - 1;
      if (isLastSplit) return sum;
      return sum + parseFloat(split.amount || '0');
    }, 0);
    
    return Math.max(0, transactionAmount - otherSplitsTotal);
  }

  updateLastSplitAmount() {
    const splits = [...this.splitSplits()];
    if (splits.length === 0) return;
    
    const lastIndex = splits.length - 1;
    const remainingAmount = this.calculateRemainingAmountInModal(lastIndex);
    splits[lastIndex] = {
      ...splits[lastIndex],
      amount: remainingAmount.toFixed(2)
    };
    this.splitSplits.set(splits);
  }


  getSplitValidationError(): string | null {
    const transaction = this.selectedTransaction();
    if (!transaction) return null;

    const transactionAmount = Math.abs(parseFloat(transaction.amount));
    const splits = this.splitSplits();
    
    // Calculate total from all non-last splits
    const nonLastTotal = splits.slice(0, -1).reduce((sum, split) => {
      return sum + parseFloat(split.amount || '0');
    }, 0);
    
    // Check if non-last splits exceed transaction amount
    if (nonLastTotal > transactionAmount) {
      return `Combined split amounts (${this.formatCurrency(nonLastTotal)}) exceed transaction amount (${this.formatCurrency(transactionAmount)})`;
    }

    // Check all splits have categories
    for (let i = 0; i < splits.length; i++) {
      const split = splits[i];
      if (!split.categoryId) {
        return 'All splits must have a category selected';
      }
      
      const isLastSplit = i === splits.length - 1;
      const amount = isLastSplit 
        ? this.calculateRemainingAmountInModal(i)
        : parseFloat(split.amount || '0');
      
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

    const splits = this.splitSplits().map((split, i) => {
      const isLastSplit = i === this.splitSplits().length - 1;
      return {
        categoryId: split.categoryId!,
        amount: isLastSplit 
          ? this.calculateRemainingAmountInModal(i)
          : parseFloat(split.amount || '0')
      };
    });

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

    // Store current transaction count to maintain pagination
    const currentCount = this.transactions().length;

    // Use the split amount (already positive), or calculate from transaction amount
    const amountToAssign = split.amount 
      ? parseFloat(split.amount) 
      : Math.abs(parseFloat(transaction.amount));

    this.transactionService.assignTransactionCategory(
      transaction.id,
      split.categoryId,
      amountToAssign
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
        // Keep the current category as first split, add a second split that uses remaining
        const transactionAmount = Math.abs(parseFloat(transaction.amount));
        const firstAmount = parseFloat(this.splitSplits()[0].amount || '0');
        const secondAmount = (transactionAmount - firstAmount).toFixed(2);
        
        this.splitSplits.set([
          {
            categoryId: this.splitSplits()[0].categoryId,
            amount: this.splitSplits()[0].amount,
            useRemaining: false
          },
          {
            categoryId: null,
            amount: secondAmount,
            useRemaining: false
          }
        ]);
        // Update last split to use remaining
        this.updateLastSplitAmount();
      } else {
        // Start fresh with two splits
        const transactionAmount = Math.abs(parseFloat(transaction.amount));
        this.splitSplits.set([
          {
            categoryId: null,
            amount: (transactionAmount / 2).toFixed(2),
            useRemaining: false
          },
          {
            categoryId: null,
            amount: '0.00', // Will be calculated as remaining
            useRemaining: false
          }
        ]);
        this.updateLastSplitAmount();
      }
    } else {
      // Switch to single mode - combine all splits into one
      const total = this.getSplitTotal();
      const firstCategory = this.splitSplits()[0]?.categoryId || null;
      this.splitSplits.set([{
        categoryId: firstCategory,
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
    // Don't allow editing unconnected accounts
    if (account.accountId.startsWith('unconnected_')) {
      return;
    }
    this.editingAccountId.set(account.accountId);
    this.editingAccountName.set(account.customName || account.originalName);
  }

  cancelEditingAccountName() {
    this.editingAccountId.set(null);
    this.editingAccountName.set('');
  }

  saveAccountName(accountId: string) {
    // Don't allow saving unconnected accounts
    if (accountId.startsWith('unconnected_')) {
      return;
    }
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
  getSplitsForTransaction(transactionId: number): Array<{categoryId: number | null; amount: string; useRemaining: boolean}> {
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
        amount: transaction.amount,
        useRemaining: false
      }];
    }

    return transaction.categories.map(cat => ({
      categoryId: cat.categoryId,
      amount: cat.amount,
      useRemaining: false
    }));
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
          amount: total.toFixed(2),
          useRemaining: false
        }]);
        this.editingSplits.set(new Map(this.editingSplits()));
      } else {
        // Add split mode - split current into two
        const currentSplit = currentSplits[0] || {
          categoryId: null,
          amount: transaction.amount,
          useRemaining: false
        };
        const halfAmount = (parseFloat(currentSplit.amount) / 2).toFixed(2);
        this.editingSplits().set(transactionId, [
          {
            categoryId: currentSplit.categoryId,
            amount: halfAmount,
            useRemaining: false
          },
          {
            categoryId: null,
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
            amount: halfAmount,
            useRemaining: false
          },
          {
            categoryId: null,
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
      categoryId: categoryId
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

  generateTestTransaction() {
    this.generatingTestTransaction.set(true);
    this.testTransactionError.set(null);
    this.testTransactionSuccess.set(null);

    this.plaidService.generateTestTransaction().subscribe({
      next: (response) => {
        this.generatingTestTransaction.set(false);
        this.testTransactionSuccess.set(
          `Test transaction created! Merchant: ${response.transaction.merchant}, Amount: $${Math.abs(parseFloat(response.transaction.amount)).toFixed(2)}`
        );
        
        // Reload transactions to show the new one
        this.transactionsOffset.set(0);
        this.loadTransactions(15, 0);
        
        // Clear success message after 5 seconds
        setTimeout(() => {
          this.testTransactionSuccess.set(null);
        }, 5000);
      },
      error: (err) => {
        this.generatingTestTransaction.set(false);
        this.testTransactionError.set(err.error?.error || 'Failed to generate test transaction');
      }
    });
  }

  onReviewFilterChange() {
    // Reset offset and reload transactions with new filter
    this.transactionsOffset.set(0);
    this.loadTransactions(15, 0);
  }

  getSavingsCategories(): BudgetCategory[] {
    return this.categories().filter(cat => cat.categoryType === 'savings');
  }

  getTotalSavingsAmount(): number {
    return this.getSavingsCategories().reduce((sum, cat) => {
      return sum + parseFloat(cat.accumulatedTotal || '0');
    }, 0);
  }

  getUnconnectedSavingsAmount(): number {
    return this.categories()
      .filter(cat => cat.categoryType === 'savings' && cat.isUnconnectedAccount)
      .reduce((sum, cat) => {
        return sum + parseFloat(cat.accumulatedTotal || '0');
      }, 0);
  }

  getAdjustedNetBalance(): number {
    const snapshot = this.balanceSnapshot();
    if (!snapshot) {
      return 0;
    }
    // Add unconnected savings to net balance
    const unconnectedSavings = this.getUnconnectedSavingsAmount();
    return snapshot.netBalance + unconnectedSavings;
  }

  getAdjustedTotalAssets(): number {
    const snapshot = this.balanceSnapshot();
    if (!snapshot) {
      return 0;
    }
    // Add unconnected savings to total assets
    const unconnectedSavings = this.getUnconnectedSavingsAmount();
    return snapshot.totalAssets + unconnectedSavings;
  }

  getNonSavingsMoney(): number {
    const snapshot = this.balanceSnapshot();
    if (!snapshot) {
      return 0;
    }
    const totalSavings = this.getTotalSavingsAmount();
    // Add unconnected savings to net balance for calculation
    const unconnectedSavings = this.getUnconnectedSavingsAmount();
    const adjustedNetBalance = snapshot.netBalance + unconnectedSavings;
    return adjustedNetBalance - totalSavings;
  }

  getSavingsCategoryAmount(category: BudgetCategory): number {
    return parseFloat(category.accumulatedTotal || '0');
  }
}

