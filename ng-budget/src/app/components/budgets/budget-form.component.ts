import { Component, signal, computed, effect, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatIconModule } from '@angular/material/icon';
import { BudgetService } from '../../services/budget.service';
import { TransactionService } from '../../services/transaction.service';
import { CreateBudgetRequest, CreateBudgetCategoryRequest, UpdateBudgetCategoryRequest, FilingStatus, CategoryType, Budget, BudgetCategory } from '../../models/budget.model';
import { calculateTax, getStandardDeduction, FilingStatus as TaxFilingStatus } from '../../utils/tax-calculator';

interface CategoryForm {
  id?: number;
  name: string;
  allocatedAmount: string;
  allocatedAmountPeriod: 'monthly' | 'annual'; // Whether allocatedAmount is monthly or annual
  categoryType: CategoryType;
  accumulatedTotal: string;
  color: string | null;
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

@Component({
  selector: 'app-budget-form',
  standalone: true,
  imports: [CommonModule, FormsModule, MatTooltipModule, MatIconModule],
  templateUrl: './budget-form.component.html',
  styleUrl: './budget-form.component.scss'
})
export class BudgetFormComponent implements OnInit {
  loading = signal(false);
  error = signal<string | null>(null);
  categoryError = signal<{index: number, message: string} | null>(null);
  
  isEditMode = signal(false);
  budgetId: number | null = null;

  budgetForm = {
    name: '',
    income: signal(''),
    incomePeriod: signal<'monthly' | 'annual'>('monthly'),
    filingStatus: signal('single' as FilingStatus),
    deductions: signal('0')
  };

  // Auto-generated dates for the current month (all budgets are monthly)
  private startDate = '';
  private endDate = '';

  categories = signal<CategoryForm[]>([]);
  expandedCategoryIndex = signal<number | null>(null);
  taxBreakdownView = signal<'annual' | 'monthly'>('annual');
  merchantSuggestions = signal<Record<number, string[]>>({});
  merchantSuggestionsVisible = signal<Record<number, boolean>>({});
  

  constructor(
    private budgetService: BudgetService,
    private transactionService: TransactionService,
    private router: Router,
    private route: ActivatedRoute
  ) {
    // Auto-generate dates for the current month (all budgets are monthly)
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    
    this.startDate = firstDay.toISOString().split('T')[0];
    this.endDate = lastDay.toISOString().split('T')[0];
    
    const monthName = firstDay.toLocaleString('default', { month: 'long' });
    this.budgetForm.name = `${monthName} ${year} Budget`;

    // Effect to update Surplus category whenever remaining budget changes
    effect(() => {
      const remaining = this.getRemainingBudget();
      const surplus = this.getSurplusCategory();
      if (surplus) {
        const currentAmount = parseFloat(surplus.allocatedAmount) || 0;
        if (Math.abs(currentAmount - remaining) > 0.01) {
          surplus.allocatedAmount = remaining.toFixed(2);
          // Trigger reactivity by updating the categories signal
          this.categories.set([...this.categories()]);
        }
      }
    });
  }

  async ngOnInit() {
    // Always try to load existing budget (single budget per user)
    await this.loadBudget();
  }

  async loadBudget() {
    this.loading.set(true);
    this.error.set(null);

    try {
      // Load budget data (single budget per user)
      const budget = await this.budgetService.getBudget().toPromise();
      if (budget) {
        this.budgetId = budget.id;
        this.isEditMode.set(true);

        // Populate form with budget data
        this.budgetForm.name = budget.name;
        this.startDate = budget.startDate;
        this.endDate = budget.endDate;
        
        // Determine if income is monthly or annual (assume monthly if not specified)
        const incomeNum = parseFloat(budget.income);
        // We'll default to monthly, but could check if it matches annual patterns
        this.budgetForm.income.set(budget.income);
        this.budgetForm.incomePeriod.set('monthly'); // Default to monthly
        
        this.budgetForm.filingStatus.set(budget.filingStatus);
        this.budgetForm.deductions.set(budget.deductions);

        // Load categories (exclude Excluded and Surplus categories from budget builder)
        const allCategories = await this.budgetService.getBudgetCategories().toPromise();
        if (allCategories) {
          // Filter out excluded and surplus categories - they shouldn't be editable in budget builder
          const categories = allCategories.filter(cat => 
            cat.categoryType !== 'excluded' && cat.categoryType !== 'surplus'
          );
          const categoryForms: CategoryForm[] = categories.map((cat, index) => {
            const form: CategoryForm = {
            id: cat.id,
            name: cat.name,
            allocatedAmount: cat.allocatedAmount,
            allocatedAmountPeriod: 'monthly' as 'monthly' | 'annual', // Default to monthly, could be enhanced to detect
            categoryType: cat.categoryType,
            accumulatedTotal: cat.accumulatedTotal || '0',
            color: cat.color || this.getNextAvailableColor(),
            // Variable category fields
            autoMoveSurplus: cat.autoMoveSurplus || false,
            surplusTargetCategoryId: cat.surplusTargetCategoryId || null,
            autoMoveDeficit: cat.autoMoveDeficit || false,
            deficitSourceCategoryId: cat.deficitSourceCategoryId || null,
            // Fixed category fields
            expectedMerchantName: cat.expectedMerchantName || null,
            hideFromTransactionLists: cat.hideFromTransactionLists || false,
            // Savings category fields
            isTaxDeductible: cat.isTaxDeductible ?? false,
            isSubjectToFica: cat.isSubjectToFica ?? false,
            isUnconnectedAccount: cat.isUnconnectedAccount ?? false,
          };

            return form;
          });
          this.categories.set(categoryForms);
        }
      }

      this.loading.set(false);
    } catch (error: any) {
      this.error.set(error.error?.error || 'Failed to load budget');
      this.loading.set(false);
    }
  }

  parseAmount(value: string | number): number {
    if (typeof value === 'number') {
      return value;
    }
    return parseFloat(value) || 0;
  }

  // Tax calculations
  taxCalculation = computed(() => {
    const income = parseFloat(this.budgetForm.income()) || 0;
    // Convert to annual if needed
    const annualIncome = this.budgetForm.incomePeriod() === 'annual' ? income : income * 12;
    const filingStatus = this.budgetForm.filingStatus();
    const deductions = parseFloat(this.budgetForm.deductions()) || 0;
    
    if (annualIncome <= 0) {
      return {
        taxableIncome: 0,
        federalIncomeTax: { amount: 0, effectiveRate: 0, marginalRate: 10, breakdown: [] },
        ficaTax: { socialSecurity: { amount: 0, rate: 6.2 }, medicare: { amount: 0, rate: 1.45 }, additionalMedicare: { amount: 0, rate: 0 }, total: { amount: 0, effectiveRate: 0 } },
        federalTax: { amount: 0, effectiveRate: 0 },
        stateTax: { amount: 0, rate: 4.95 },
        totalTax: { amount: 0, effectiveRate: 0 },
        standardDeduction: getStandardDeduction(filingStatus as TaxFilingStatus)
      };
    }
    
    // Calculate total tax-deductible savings (annual amount)
    const taxDeductibleSavings = this.categories()
      .filter(cat => cat.categoryType === 'savings' && cat.isTaxDeductible)
      .reduce((sum, cat) => {
        const amount = parseFloat(cat.allocatedAmount || '0');
        const annualAmount = cat.allocatedAmountPeriod === 'annual' ? amount : amount * 12;
        return sum + annualAmount;
      }, 0);

    // Calculate FICA-subject savings (tax-deductible savings that are subject to FICA)
    const ficaSubjectSavings = this.categories()
      .filter(cat => cat.categoryType === 'savings' && cat.isTaxDeductible && cat.isSubjectToFica)
      .reduce((sum, cat) => {
        const amount = parseFloat(cat.allocatedAmount || '0');
        const annualAmount = cat.allocatedAmountPeriod === 'annual' ? amount : amount * 12;
        return sum + annualAmount;
      }, 0);

    const result = calculateTax(annualIncome, filingStatus as TaxFilingStatus, deductions, taxDeductibleSavings, ficaSubjectSavings);
    return { ...result, standardDeduction: getStandardDeduction(filingStatus as TaxFilingStatus) };
  });

  getTaxRate = computed(() => this.taxCalculation().totalTax.effectiveRate);
  getTaxAmount = computed(() => this.taxCalculation().totalTax.amount / 12);
  getFederalTaxAmount = computed(() => this.taxCalculation().federalTax.amount / 12);
  getStateTaxAmount = computed(() => this.taxCalculation().stateTax.amount / 12);
  getFederalIncomeTaxAmount = computed(() => this.taxCalculation().federalIncomeTax.amount / 12);
  getFicaTaxAmount = computed(() => this.taxCalculation().ficaTax.total.amount / 12);
  getStandardDeduction = computed(() => this.taxCalculation().standardDeduction);
  getTotalDeductions = computed(() => this.getStandardDeduction() + (parseFloat(this.budgetForm.deductions()) || 0));
  getNetIncome = computed(() => (parseFloat(this.budgetForm.income()) || 0) - this.getTaxAmount());
  getRemainingIncome = computed(() => this.getNetIncome() - this.getTotalSavings() - this.getTotalAllocated());
  getAnnualIncome = computed(() => {
    const income = parseFloat(this.budgetForm.income()) || 0;
    return this.budgetForm.incomePeriod() === 'annual' ? income : income * 12;
  });
  getAnnualTaxAmount = computed(() => this.taxCalculation().totalTax.amount);
  getAnnualNetIncome = computed(() => this.getNetIncome() * 12);
  getAnnualTotalAllocated = computed(() => this.getTotalAllocated() * 12);
  getAnnualRemaining = computed(() => this.getRemainingIncome() * 12);

  getTotalAllocated(): number {
    // Exclude Surplus, Excluded, and Savings categories from total allocated
    // (Surplus is calculated automatically, Excluded doesn't count toward budget, Savings is deducted separately)
    return this.categories()
      .filter(cat => cat.categoryType !== 'surplus' && cat.categoryType !== 'excluded' && cat.categoryType !== 'savings')
      .reduce((sum, cat) => {
        const amount = parseFloat(cat.allocatedAmount) || 0;
        const monthlyAmount = cat.allocatedAmountPeriod === 'annual' ? amount / 12 : amount;
        return sum + monthlyAmount;
      }, 0);
  }

  getTotalSavings(): number {
    // Calculate total allocated to Savings categories
    return this.categories()
      .filter(cat => cat.categoryType === 'savings')
      .reduce((sum, cat) => {
        const amount = parseFloat(cat.allocatedAmount) || 0;
        const monthlyAmount = cat.allocatedAmountPeriod === 'annual' ? amount / 12 : amount;
        return sum + monthlyAmount;
      }, 0);
  }

  getSavingsCategories(): BudgetCategory[] {
    return this.categories()
      .filter(cat => cat.categoryType === 'savings' && cat.id)
      .map(cat => ({
        id: cat.id!,
        budgetId: this.budgetId!,
        name: cat.name,
        allocatedAmount: cat.allocatedAmount,
        spentAmount: '0',
        categoryType: 'savings' as CategoryType,
        accumulatedTotal: cat.accumulatedTotal,
        color: cat.color,
        createdAt: '',
        updatedAt: '',
      }));
  }

  async showMerchantSuggestions(categoryIndex: number) {
    const category = this.categories()[categoryIndex];
    if (!category || category.categoryType !== 'fixed') return;

    const currentValue = category.expectedMerchantName || '';
    if (currentValue.length < 2) {
      this.merchantSuggestionsVisible.set({ ...this.merchantSuggestionsVisible(), [categoryIndex]: false });
      return;
    }

    // Get unique merchant names from transactions (would need to fetch from API)
    // For now, we'll implement a simple search
    try {
      // This would need an API endpoint to search merchants
      // For now, we'll just show/hide based on input
      this.merchantSuggestionsVisible.set({ ...this.merchantSuggestionsVisible(), [categoryIndex]: true });
    } catch (error) {
      console.error('Error fetching merchant suggestions:', error);
    }
  }

  hideMerchantSuggestions(categoryIndex: number) {
    // Delay hiding to allow click events to fire
    setTimeout(() => {
      this.merchantSuggestionsVisible.set({ ...this.merchantSuggestionsVisible(), [categoryIndex]: false });
    }, 200);
  }

  selectMerchant(categoryIndex: number, merchant: string) {
    const category = this.categories()[categoryIndex];
    if (category) {
      category.expectedMerchantName = merchant;
      this.categories.set([...this.categories()]);
    }
    this.hideMerchantSuggestions(categoryIndex);
  }

  async openMerchantSearch(categoryIndex: number) {
    // Fetch unique merchant names from transactions
    try {
      const transactions = await this.transactionService.getTransactions(100, 0, null).toPromise();
      if (transactions) {
        const uniqueMerchants = Array.from(new Set(
          transactions
            .map(t => t.merchantName || t.name)
            .filter(name => name && name.trim().length > 0)
        )).sort();

        this.merchantSuggestions.set({ ...this.merchantSuggestions(), [categoryIndex]: uniqueMerchants });
        this.merchantSuggestionsVisible.set({ ...this.merchantSuggestionsVisible(), [categoryIndex]: true });
      }
    } catch (error) {
      console.error('Error fetching merchants:', error);
    }
  }

  getSurplusCategory() {
    return this.categories().find(cat => cat.categoryType === 'surplus');
  }

  // Update Surplus category allocated amount to match remaining budget
  updateSurplusCategory() {
    const surplus = this.getSurplusCategory();
    if (surplus) {
      const remaining = this.getRemainingBudget();
      surplus.allocatedAmount = remaining.toFixed(2);
      // Update the categories signal to trigger reactivity
      this.categories.set([...this.categories()]);
    }
  }

  // Total spending includes taxes + savings + categories
  getTotalSpending = computed(() => {
    return this.getTaxAmount() + this.getTotalSavings() + this.getTotalAllocated();
  });

  getAnnualTotalSpending = computed(() => {
    return this.getAnnualTaxAmount() + this.getAnnualTotalAllocated();
  });

  // Remaining budget (income - spending, excluding surplus)
  getRemainingBudget = computed(() => {
    return this.getIncomeAmount() - this.getTotalSpending();
  });

  getAnnualRemainingBudget = computed(() => {
    return this.getRemainingBudget() * 12;
  });

  getIncomeAmount(): number {
    const income = parseFloat(this.budgetForm.income()) || 0;
    // Always return monthly amount for calculations
    return this.budgetForm.incomePeriod() === 'annual' ? income / 12 : income;
  }

  resetTaxDefaults() {
    this.budgetForm.filingStatus.set('single');
    this.budgetForm.deductions.set('0');
  }

  // Category management
  // Default color palette
  defaultColors = [
    '#FF5733', '#33FF57', '#3357FF', '#FF33F5', '#F5FF33',
    '#33FFF5', '#FF8C33', '#8C33FF', '#FF3333', '#33FF8C',
    '#338CFF', '#FF338C', '#8CFF33', '#FF338C', '#33FF8C'
  ];

  getNextAvailableColor(): string {
    const usedColors = this.categories()
      .map(cat => cat.color)
      .filter(color => color !== null && color !== undefined) as string[];
    
    // Find first color not in use
    for (const color of this.defaultColors) {
      if (!usedColors.includes(color)) {
        return color;
      }
    }
    
    // If all colors are used, return first one
    return this.defaultColors[0];
  }

  expandCategoryForm() {
    // Don't allow creating Surplus category manually
    this.expandedCategoryIndex.set(this.categories().length);
    this.categories.set([
      ...this.categories(),
      {
        name: '',
        allocatedAmount: '',
        allocatedAmountPeriod: 'monthly',
        categoryType: 'variable',
        accumulatedTotal: '0',
        color: this.getNextAvailableColor(),
        autoMoveSurplus: false,
        surplusTargetCategoryId: null,
        autoMoveDeficit: false,
        deficitSourceCategoryId: null,
        expectedMerchantName: null,
        hideFromTransactionLists: false,
        isTaxDeductible: false,
        isSubjectToFica: false,
        isUnconnectedAccount: false,
      }
    ]);
  }

  // Initialize Surplus category when income is entered
  initializeSurplusCategory() {
    const hasSurplus = this.categories().some(cat => cat.categoryType === 'surplus');
    if (!hasSurplus && this.getIncomeAmount() > 0) {
      const remaining = this.getRemainingBudget();
      this.categories.set([
        ...this.categories(),
        {
          name: 'Surplus',
          allocatedAmount: remaining.toFixed(2),
          allocatedAmountPeriod: 'monthly',
          categoryType: 'surplus',
          accumulatedTotal: '0',
          color: '#28a745'
        }
      ]);
    }
  }

  collapseCategoryForm(index: number) {
    if (this.expandedCategoryIndex() === index) {
      this.expandedCategoryIndex.set(null);
    }
  }

  saveCategory(index: number) {
    // Clear any previous category errors
    this.categoryError.set(null);
    
    try {
      const categories = this.categories();
      if (index < 0 || index >= categories.length) {
        this.categoryError.set({ index, message: 'Invalid category index' });
        return;
      }
      
      const category = categories[index];
      
      if (!category) {
        this.categoryError.set({ index, message: 'Category not found' });
        return;
      }
      
      if (!category.name || !category.name.trim()) {
        this.categoryError.set({ index, message: 'Category must have a name' });
        return;
      }

      // Validate allocatedAmount (allow 0)
      const amount = parseFloat(category.allocatedAmount || '0');
      if (isNaN(amount) || amount < 0) {
        this.categoryError.set({ index, message: 'Category must have a valid allocated amount (0 or greater)' });
        return;
      }

      // Update the categories signal to trigger reactivity and update all summary fields
      this.categories.set([...this.categories()]);
      
      // Update Surplus category to reflect the new remaining budget
      this.updateSurplusCategory();

      // Clear error and close the form
      this.categoryError.set(null);
      this.expandedCategoryIndex.set(null);
    } catch (error: any) {
      console.error('Error saving category:', error);
      this.categoryError.set({ index, message: error.message || 'An error occurred while saving the category' });
    }
  }
  
  getCategoryError(categoryIndex: number): string | null {
    const error = this.categoryError();
    return error && error.index === categoryIndex ? error.message : null;
  }

  removeCategory(index: number) {
    const category = this.categories()[index];
    // Don't allow removing Surplus category
    if (category.categoryType === 'surplus') {
      return;
    }
    const updated = this.categories().filter((_, i) => i !== index);
    this.categories.set(updated);
    if (this.expandedCategoryIndex() === index) {
      this.expandedCategoryIndex.set(null);
    } else if (this.expandedCategoryIndex() !== null && this.expandedCategoryIndex()! > index) {
      this.expandedCategoryIndex.set(this.expandedCategoryIndex()! - 1);
    }
  }



  // Annual spending summary (includes taxes as first item, excludes surplus)
  getAnnualSpendingSummary = computed(() => {
    const taxItem = {
      name: 'Taxes',
      monthly: this.getTaxAmount(),
      annual: this.getAnnualTaxAmount(),
      color: '#DC3545' // Red for taxes
    };
    
    // Include all categories except surplus (surplus is shown as "Remaining Budget")
    const categoryItems = this.categories()
      .filter(cat => cat.categoryType !== 'surplus' && cat.categoryType !== 'excluded')
      .map(cat => {
        let monthly: number;
        let annual: number;
        
        // For categories, respect the allocatedAmountPeriod
        const amount = parseFloat(cat.allocatedAmount) || 0;
        if (cat.allocatedAmountPeriod === 'annual') {
          monthly = amount / 12;
          annual = amount;
        } else {
          monthly = amount;
          annual = amount * 12;
        }
        
        return {
          name: cat.name,
          monthly,
          annual,
          color: cat.color || '#667eea'
        };
      });
    
    return [taxItem, ...categoryItems];
  });

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
  }

  getCategoryAmount(amount: string): number {
    return parseFloat(amount) || 0;
  }

  onSubmit() {
    this.error.set(null);

    if (!this.budgetForm.name || !this.budgetForm.income()) {
      this.error.set('Please fill in all required budget fields');
      return;
    }

    if (this.categories().length === 0) {
      this.error.set('Please add at least one spending category');
      return;
    }

    for (const cat of this.categories()) {
      if (!cat.name) {
        this.error.set('All categories must have a name');
        return;
      }
      
      // For Expected/Savings categories with subcategories, validate subcategories
      // Validate allocatedAmount (allow 0)
      const amount = parseFloat(cat.allocatedAmount || '0');
      if (isNaN(amount) || amount < 0) {
        this.error.set(`Category "${cat.name}" must have a valid allocated amount (0 or greater)`);
        return;
      }
    }

    const totalAllocated = this.getTotalAllocated();
    const totalSavings = this.getTotalSavings();
    const netIncome = this.getNetIncome();
    const availableForSpending = netIncome - totalSavings;

    if (totalAllocated > availableForSpending) {
      this.error.set(`Total allocated (${this.formatCurrency(totalAllocated)}) exceeds available income after taxes and savings (${this.formatCurrency(availableForSpending)})`);
      return;
    }

    this.loading.set(true);

    if (this.isEditMode() && this.budgetId) {
      // Update existing budget
      const updateData = {
        name: this.budgetForm.name,
        startDate: this.startDate,
        endDate: this.endDate,
        income: this.getIncomeAmount().toFixed(2),
        isActive: true
      };

      this.budgetService.updateBudget(updateData).subscribe({
        next: async (budget) => {
          try {
            // Update categories
            await this.updateCategories();
            this.router.navigate(['/budgets']);
          } catch (err: any) {
            console.error('Error updating categories:', err);
            this.error.set(err.error?.error || 'Budget updated but failed to update some categories');
            this.loading.set(false);
          }
        },
        error: (err) => {
          console.error('Error updating budget:', err);
          this.error.set(err.error?.error || 'Failed to update budget');
          this.loading.set(false);
        }
      });
      return;
    }
      // Create new budget
      const budgetData: CreateBudgetRequest = {
        name: this.budgetForm.name,
        startDate: this.startDate,
        endDate: this.endDate,
        income: this.getIncomeAmount().toFixed(2),
        taxRate: this.getTaxRate().toFixed(2),
        filingStatus: this.budgetForm.filingStatus(),
        deductions: this.budgetForm.deductions(),
      };

    this.budgetService.createBudget(budgetData).subscribe({
      next: async (budget) => {
        try {
          // Create all categories (Surplus is auto-created by backend, but we need to update it)
          for (const cat of this.categories()) {
            if (cat.categoryType === 'surplus') {
              // Update the auto-created Surplus category with the remaining budget amount
              const categories = await this.budgetService.getBudgetCategories().toPromise();
              if (categories) {
                const surplus = categories.find(c => c.categoryType === 'surplus');
                if (surplus) {
                  await this.budgetService.updateBudgetCategory(
                    surplus.id,
                    {
                      allocatedAmount: this.getRemainingBudget().toFixed(2),
                      color: cat.color || null
                    }
                  ).toPromise();
                }
              }
              continue;
            }

            const categoryData: CreateBudgetCategoryRequest = {
              name: cat.name,
              allocatedAmount: cat.allocatedAmount,
              categoryType: cat.categoryType,
              accumulatedTotal: cat.accumulatedTotal,
              color: cat.color || null
            };

            await this.budgetService.createBudgetCategory(categoryData).toPromise();
          }

          this.router.navigate(['/budgets']);
        } catch (err: any) {
          console.error('Error creating categories:', err);
          this.error.set(err.error?.error || 'Budget created but failed to create some categories');
          this.loading.set(false);
        }
      },
      error: (err) => {
        console.error('Error creating budget:', err);
        this.error.set(err.error?.error || 'Failed to create budget');
        this.loading.set(false);
      }
    });
  }

  async updateCategories() {
    // Get existing categories from the database
    const existingCategories = await this.budgetService.getBudgetCategories().toPromise();
    const existingCategoryMap = new Map(existingCategories?.map(cat => [cat.id, cat]) || []);
    
    // Update or create categories
    for (const cat of this.categories()) {
      if (cat.categoryType === 'surplus') {
        // Update the Surplus category
        const existingSurplus = existingCategories?.find(c => c.categoryType === 'surplus');
        if (existingSurplus) {
          await this.budgetService.updateBudgetCategory(
            existingSurplus.id,
            {
              allocatedAmount: this.getRemainingBudget().toFixed(2),
              color: cat.color || null
            }
          ).toPromise();
        }
        continue;
      }

      if (cat.id && existingCategoryMap.has(cat.id)) {
        // Update existing category
        const categoryData: UpdateBudgetCategoryRequest = {
          name: cat.name,
          allocatedAmount: cat.allocatedAmount,
          accumulatedTotal: cat.accumulatedTotal || '0',
          color: cat.color || null,
          autoMoveSurplus: cat.autoMoveSurplus ?? false,
          surplusTargetCategoryId: cat.surplusTargetCategoryId ?? null,
          autoMoveDeficit: cat.autoMoveDeficit ?? false,
          deficitSourceCategoryId: cat.deficitSourceCategoryId ?? null,
          expectedMerchantName: cat.expectedMerchantName ?? null,
          hideFromTransactionLists: cat.hideFromTransactionLists ?? false,
          isTaxDeductible: cat.isTaxDeductible ?? false,
          isSubjectToFica: cat.isSubjectToFica ?? false,
          isUnconnectedAccount: cat.isUnconnectedAccount ?? false,
        };

        await this.budgetService.updateBudgetCategory(cat.id, categoryData).toPromise();
      } else {
        // Create new category
        const categoryData: CreateBudgetCategoryRequest = {
          name: cat.name,
          allocatedAmount: cat.allocatedAmount,
          categoryType: cat.categoryType,
          accumulatedTotal: cat.accumulatedTotal || '0',
          color: cat.color || null,
          autoMoveSurplus: cat.autoMoveSurplus ?? false,
          surplusTargetCategoryId: cat.surplusTargetCategoryId ?? null,
          autoMoveDeficit: cat.autoMoveDeficit ?? false,
          deficitSourceCategoryId: cat.deficitSourceCategoryId ?? null,
          expectedMerchantName: cat.expectedMerchantName ?? null,
          hideFromTransactionLists: cat.hideFromTransactionLists ?? false,
          isTaxDeductible: cat.isTaxDeductible ?? false,
          isSubjectToFica: cat.isSubjectToFica ?? false,
          isUnconnectedAccount: cat.isUnconnectedAccount ?? false,
        };

        await this.budgetService.createBudgetCategory(categoryData).toPromise();
      }
    }

    // Delete categories that were removed
    const currentCategoryIds = new Set(this.categories().filter(c => c.id).map(c => c.id));
    for (const existingCat of existingCategories || []) {
      // Don't try to delete system categories (Surplus, Excluded) - they're filtered out from UI but should remain
      if (existingCat.id && 
          existingCat.categoryType !== 'surplus' && 
          existingCat.categoryType !== 'excluded' && 
          !currentCategoryIds.has(existingCat.id)) {
        await this.budgetService.deleteBudgetCategory(existingCat.id).toPromise();
      }
    }
  }

  cancel() {
    this.router.navigate(['/budgets']);
  }
}
