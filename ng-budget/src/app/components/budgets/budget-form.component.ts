import { Component, signal, computed, effect, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { BudgetService } from '../../services/budget.service';
import { CreateBudgetRequest, CreateBudgetCategoryRequest, UpdateBudgetCategoryRequest, FilingStatus, CategoryType, BudgetCategorySubcategory, Budget, BudgetCategory } from '../../models/budget.model';
import { calculateTax, getStandardDeduction, FilingStatus as TaxFilingStatus } from '../../utils/tax-calculator';

interface CategoryForm {
  id?: number;
  name: string;
  allocatedAmount: string;
  allocatedAmountPeriod: 'monthly' | 'annual'; // Whether allocatedAmount is monthly or annual
  categoryType: CategoryType;
  accumulatedTotal: string;
  estimationMonths: number;
  useEstimation: boolean; // Whether to use estimation feature
  isBufferCategory: boolean;
  bufferPriority: number;
  color: string | null;
  useSubcategories: boolean; // For Expected categories - whether to use subcategories
  subcategories: SubcategoryForm[];
}

interface SubcategoryForm {
  id?: number;
  name: string;
  expectedAmount: string;
  expectedAmountPeriod: 'monthly' | 'annual'; // Whether expectedAmount is monthly or annual
  actualAmount: string | null;
  billDate: string | null;
  useEstimation: boolean; // Whether to use estimation feature for this subcategory
  estimationMonths: number; // Number of months to use for estimation
}

@Component({
  selector: 'app-budget-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
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
  

  constructor(
    private budgetService: BudgetService,
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
            estimationMonths: cat.estimationMonths || 12,
            useEstimation: false, // Default, could be enhanced
            isBufferCategory: cat.isBufferCategory || false,
            bufferPriority: cat.bufferPriority || 999,
            color: cat.color || this.getNextAvailableColor(),
            useSubcategories: false,
            subcategories: []
          };

          // Load subcategories if they exist (for expected or savings categories)
          if ((cat.categoryType === 'expected' || cat.categoryType === 'savings') && cat.subcategories && cat.subcategories.length > 0) {
            form.useSubcategories = true;
            form.subcategories = cat.subcategories.map(subcat => ({
              id: subcat.id,
              name: subcat.name,
              expectedAmount: subcat.expectedAmount,
              expectedAmountPeriod: 'monthly' as 'monthly' | 'annual', // Default to monthly
              actualAmount: subcat.actualAmount || null,
              billDate: subcat.billDate || null,
              useEstimation: subcat.useEstimation || false,
              estimationMonths: subcat.estimationMonths || 12
            }));
            // Recalculate allocated amount from subcategories after categories are set
            setTimeout(() => {
              this.updateAllocatedFromSubcategories(index);
            }, 0);
          }

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
    
    const result = calculateTax(annualIncome, filingStatus as TaxFilingStatus, deductions);
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
  getRemainingIncome = computed(() => this.getNetIncome() - this.getTotalAllocated());
  getAnnualIncome = computed(() => {
    const income = parseFloat(this.budgetForm.income()) || 0;
    return this.budgetForm.incomePeriod() === 'annual' ? income : income * 12;
  });
  getAnnualTaxAmount = computed(() => this.taxCalculation().totalTax.amount);
  getAnnualNetIncome = computed(() => this.getNetIncome() * 12);
  getAnnualTotalAllocated = computed(() => this.getTotalAllocated() * 12);
  getAnnualRemaining = computed(() => this.getRemainingIncome() * 12);

  getTotalAllocated(): number {
    // Exclude Surplus and Excluded categories from total allocated
    // (Surplus is calculated automatically, Excluded doesn't count toward budget)
    return this.categories()
      .filter(cat => cat.categoryType !== 'surplus' && cat.categoryType !== 'excluded')
      .reduce((sum, cat) => {
        if ((cat.categoryType === 'expected' || cat.categoryType === 'savings') && cat.useSubcategories) {
          // Sum up subcategory amounts (convert to monthly if needed)
          const subcatTotal = cat.subcategories.reduce((subSum, subcat) => {
            const amount = parseFloat(subcat.expectedAmount) || 0;
            const monthlyAmount = subcat.expectedAmountPeriod === 'annual' ? amount / 12 : amount;
            return subSum + monthlyAmount;
          }, 0);
          return sum + subcatTotal;
        } else {
          const amount = parseFloat(cat.allocatedAmount) || 0;
          const monthlyAmount = cat.allocatedAmountPeriod === 'annual' ? amount / 12 : amount;
          return sum + monthlyAmount;
        }
      }, 0);
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

  // Total spending includes taxes + categories
  getTotalSpending = computed(() => {
    return this.getTaxAmount() + this.getTotalAllocated();
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
        estimationMonths: 12,
        useEstimation: false,
        isBufferCategory: false,
        bufferPriority: 999,
        color: this.getNextAvailableColor(),
        useSubcategories: false,
        subcategories: []
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
          estimationMonths: 12,
          useEstimation: false,
          isBufferCategory: true,
          bufferPriority: 0,
          color: '#28a745',
          useSubcategories: false,
          subcategories: []
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

      // For Expected/Savings categories with subcategories, validate subcategories
      if ((category.categoryType === 'expected' || category.categoryType === 'savings') && category.useSubcategories) {
        if (!category.subcategories || category.subcategories.length === 0) {
          this.categoryError.set({ index, message: 'Please add at least one subcategory or disable subcategories' });
          return;
        }
        
        // Validate each subcategory
        let validSubcatCount = 0;
        
        for (let i = 0; i < category.subcategories.length; i++) {
          const subcat = category.subcategories[i];
          
          // Get name and amount - expectedAmount is a string
          const name = subcat.name ? String(subcat.name).trim() : '';
          const amountStr = subcat.expectedAmount ? String(subcat.expectedAmount).trim() : '';
          
          // Skip completely empty subcategories (no name and no amount)
          if (!name && !amountStr) {
            continue;
          }
          
          // If we have any data, both name and amount are required
          if (!name || name.length === 0) {
            this.categoryError.set({ index, message: `Subcategory #${i + 1} must have a name` });
            return;
          }
          
          // Check if amount is provided (allow 0 and empty string that represents 0)
          if (!amountStr || amountStr.length === 0) {
            this.categoryError.set({ index, message: `Subcategory "${name}" must have an expected amount` });
            return;
          }
          
          const amount = parseFloat(amountStr);
          if (isNaN(amount)) {
            this.categoryError.set({ index, message: `Subcategory "${name}" must have a valid numeric amount` });
            return;
          }
          
          // Allow 0 as a valid amount
          if (amount < 0) {
            this.categoryError.set({ index, message: `Subcategory "${name}" must have an expected amount that is 0 or greater` });
            return;
          }
          
          // This subcategory is valid
          validSubcatCount++;
        }
        
        if (validSubcatCount === 0) {
          this.categoryError.set({ index, message: 'Please add at least one subcategory with a name and expected amount' });
          return;
        }
        
        // Ensure allocatedAmount matches sum of subcategories
        // This will update the allocatedAmount based on subcategory totals
        const updatedCategory = this.updateAllocatedFromSubcategories(index);
        
        // Verify the allocated amount is valid after calculation (allow 0)
        if (updatedCategory) {
          const totalAmount = parseFloat(updatedCategory.allocatedAmount || '0');
          if (isNaN(totalAmount) || totalAmount < 0) {
            this.categoryError.set({ index, message: 'The total amount from all subcategories must be 0 or greater. Please check your subcategory amounts.' });
            return;
          }
        } else {
          this.categoryError.set({ index, message: 'Failed to calculate total from subcategories' });
          return;
        }
      } else {
        // For categories without subcategories, validate allocatedAmount (allow 0)
        const amount = parseFloat(category.allocatedAmount || '0');
        if (isNaN(amount) || amount < 0) {
          this.categoryError.set({ index, message: 'Category must have a valid allocated amount (0 or greater)' });
          return;
        }
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

  toggleSubcategories(categoryIndex: number) {
    const categories = this.categories();
    const category = categories[categoryIndex];
    category.useSubcategories = !category.useSubcategories;
    
    if (category.useSubcategories) {
      // When enabling subcategories, clear allocatedAmount (it will be calculated from subcategories)
      category.allocatedAmount = '';
      // Initialize with one empty subcategory if none exist
      if (category.subcategories.length === 0) {
        category.subcategories.push({
          name: '',
          expectedAmount: '',
          expectedAmountPeriod: 'monthly',
          actualAmount: null,
          billDate: null,
          useEstimation: false,
          estimationMonths: 12
        });
      }
    } else {
      // When disabling subcategories, calculate total from existing subcategories
      const total = category.subcategories.reduce((sum, subcat) => {
        return sum + (parseFloat(subcat.expectedAmount) || 0);
      }, 0);
      category.allocatedAmount = total.toFixed(2);
      category.subcategories = [];
    }
    
    this.categories.set([...categories]);
  }

  addSubcategory(categoryIndex: number) {
    const categories = this.categories();
    const category = categories[categoryIndex];
    category.subcategories.push({
      name: '',
      expectedAmount: '',
      expectedAmountPeriod: 'monthly',
      actualAmount: null,
      billDate: null,
      useEstimation: false,
      estimationMonths: 12
    });
    this.categories.set([...categories]);
    this.updateAllocatedFromSubcategories(categoryIndex);
  }

  removeSubcategory(categoryIndex: number, subcategoryIndex: number) {
    const categories = this.categories();
    const category = categories[categoryIndex];
    
    // Create a new subcategories array without the removed item
    const updatedSubcategories = category.subcategories.filter((_, i) => i !== subcategoryIndex);
    category.subcategories = updatedSubcategories;
    
    // Create a new categories array to trigger reactivity
    this.categories.set([...categories]);
    this.updateAllocatedFromSubcategories(categoryIndex);
  }

  updateAllocatedFromSubcategories(categoryIndex: number) {
    const categories = this.categories();
    const category = categories[categoryIndex];
    if (category && category.useSubcategories && (category.categoryType === 'expected' || category.categoryType === 'savings')) {
      // Calculate total from current subcategory values (convert to monthly if needed)
      // Read directly from the subcategories to get the latest values
      const total = category.subcategories.reduce((sum, subcat) => {
        const amount = parseFloat(subcat.expectedAmount || '0') || 0;
        const monthlyAmount = subcat.expectedAmountPeriod === 'annual' ? amount / 12 : amount;
        return sum + monthlyAmount;
      }, 0);
      
      // Create a new category object with updated allocatedAmount
      // Also create a new subcategories array reference to ensure reactivity
      const updatedCategory = { 
        ...category, 
        allocatedAmount: total > 0 ? total.toFixed(2) : '0.00',
        subcategories: category.subcategories.map(subcat => ({ ...subcat })) // Deep copy for reactivity
      };
      
      // Create a new categories array with the updated category
      const updatedCategories = categories.map((cat, idx) => 
        idx === categoryIndex ? updatedCategory : cat
      );
      
      this.categories.set(updatedCategories);
      
      // Update Surplus category to reflect the new remaining budget
      this.updateSurplusCategory();
      
      // Return the updated category for validation
      return updatedCategory;
    }
    return category;
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
        
        if ((cat.categoryType === 'expected' || cat.categoryType === 'savings') && cat.useSubcategories) {
          // For categories with subcategories, sum them up and convert to monthly
          const subcatTotal = cat.subcategories.reduce((sum, subcat) => {
            const amount = parseFloat(subcat.expectedAmount) || 0;
            const monthlyAmount = subcat.expectedAmountPeriod === 'annual' ? amount / 12 : amount;
            return sum + monthlyAmount;
          }, 0);
          monthly = subcatTotal;
          annual = subcatTotal * 12;
        } else {
          // For regular categories, respect the allocatedAmountPeriod
          const amount = parseFloat(cat.allocatedAmount) || 0;
          if (cat.allocatedAmountPeriod === 'annual') {
            monthly = amount / 12;
            annual = amount;
          } else {
            monthly = amount;
            annual = amount * 12;
          }
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

  // Calculate total from subcategories for a given category index (returns monthly amount)
  getSubcategoryTotal(categoryIndex: number): number {
    const categories = this.categories();
    const category = categories[categoryIndex];
    if (category && category.useSubcategories && (category.categoryType === 'expected' || category.categoryType === 'savings') && category.subcategories) {
      return category.subcategories.reduce((sum, subcat) => {
        const amount = parseFloat(subcat.expectedAmount || '0') || 0;
        // Convert to monthly if needed
        return sum + (subcat.expectedAmountPeriod === 'annual' ? amount / 12 : amount);
      }, 0);
    }
    // For non-subcategory categories, return monthly amount
    const amount = parseFloat(category?.allocatedAmount || '0') || 0;
    return category?.allocatedAmountPeriod === 'annual' ? amount / 12 : amount;
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
      if ((cat.categoryType === 'expected' || cat.categoryType === 'savings') && cat.useSubcategories) {
        if (cat.subcategories.length === 0) {
          this.error.set(`Category "${cat.name}" must have at least one subcategory or disable subcategories`);
          return;
        }
        for (const subcat of cat.subcategories) {
          if (!subcat.name || !subcat.expectedAmount) {
            this.error.set(`All subcategories for "${cat.name}" must have a name and expected amount`);
            return;
          }
        }
        // Ensure allocatedAmount matches sum of subcategories
        const total = cat.subcategories.reduce((sum, subcat) => {
          return sum + (parseFloat(subcat.expectedAmount || '0') || 0);
        }, 0);
        cat.allocatedAmount = total.toFixed(2);
        
        // Validate that the total is 0 or greater (allow 0)
        if (total < 0) {
          this.error.set(`Category "${cat.name}" has an invalid total amount. Please check your subcategory amounts.`);
          return;
        }
      } else {
        // For categories without subcategories, validate allocatedAmount (allow 0)
        const amount = parseFloat(cat.allocatedAmount || '0');
        if (isNaN(amount) || amount < 0) {
          this.error.set(`Category "${cat.name}" must have a valid allocated amount (0 or greater)`);
          return;
        }
      }
    }

    const totalAllocated = this.getTotalAllocated();
    const netIncome = this.getNetIncome();

    if (totalAllocated > netIncome) {
      this.error.set(`Total allocated (${this.formatCurrency(totalAllocated)}) exceeds net income after taxes (${this.formatCurrency(netIncome)})`);
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
              // Only include estimationMonths if useEstimation is true (and not using subcategories)
              estimationMonths: (cat.categoryType === 'expected' && !cat.useSubcategories && cat.useEstimation) ? cat.estimationMonths : undefined,
              isBufferCategory: cat.isBufferCategory,
              bufferPriority: cat.bufferPriority,
              color: cat.color || null
            };

            const createdCategory = await this.budgetService.createBudgetCategory(categoryData).toPromise();
            if (!createdCategory) continue;

            // Create subcategories for Expected/Savings categories (if using subcategories)
            if ((cat.categoryType === 'expected' || cat.categoryType === 'savings') && cat.useSubcategories && createdCategory.id && cat.subcategories.length > 0) {
              for (const subcat of cat.subcategories) {
                if (subcat.name && subcat.expectedAmount) {
                  await this.budgetService.createBudgetCategorySubcategory(
                    createdCategory.id,
                    { 
                      name: subcat.name, 
                      expectedAmount: subcat.expectedAmount,
                      useEstimation: subcat.useEstimation || false,
                      estimationMonths: subcat.useEstimation ? subcat.estimationMonths : undefined
                    }
                  ).toPromise();
                }
              }
            }
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
          accumulatedTotal: cat.accumulatedTotal,
          estimationMonths: (cat.categoryType === 'expected' && !cat.useSubcategories && cat.useEstimation) ? cat.estimationMonths : undefined,
          isBufferCategory: cat.isBufferCategory,
          bufferPriority: cat.bufferPriority,
          color: cat.color || null
        };

        await this.budgetService.updateBudgetCategory(cat.id, categoryData).toPromise();

        // Update subcategories
        if ((cat.categoryType === 'expected' || cat.categoryType === 'savings') && cat.useSubcategories && cat.subcategories.length > 0) {
          // Get existing subcategories
          const existingSubcats = await this.budgetService.getBudgetCategorySubcategories(cat.id).toPromise();
          const existingSubcatMap = new Map(existingSubcats?.map(sub => [sub.id, sub]) || []);

          for (const subcat of cat.subcategories) {
            if (subcat.id && existingSubcatMap.has(subcat.id)) {
              // Update existing subcategory
              await this.budgetService.updateBudgetCategorySubcategory(
                cat.id,
                subcat.id,
                {
                  name: subcat.name,
                  expectedAmount: subcat.expectedAmount,
                  useEstimation: subcat.useEstimation || false,
                  estimationMonths: subcat.useEstimation ? subcat.estimationMonths : undefined
                }
              ).toPromise();
            } else if (subcat.name && subcat.expectedAmount) {
              // Create new subcategory
              await this.budgetService.createBudgetCategorySubcategory(
                cat.id,
                {
                  name: subcat.name,
                  expectedAmount: subcat.expectedAmount,
                  useEstimation: subcat.useEstimation || false,
                  estimationMonths: subcat.useEstimation ? subcat.estimationMonths : undefined
                }
              ).toPromise();
            }
          }

          // Delete subcategories that were removed
          const currentSubcatIds = new Set(cat.subcategories.filter(s => s.id).map(s => s.id));
          for (const existingSubcat of existingSubcats || []) {
            if (existingSubcat.id && !currentSubcatIds.has(existingSubcat.id)) {
              await this.budgetService.deleteBudgetCategorySubcategory(
                cat.id,
                existingSubcat.id
              ).toPromise();
            }
          }
        }
      } else {
        // Create new category
        const categoryData: CreateBudgetCategoryRequest = {
          name: cat.name,
          allocatedAmount: cat.allocatedAmount,
          categoryType: cat.categoryType,
          accumulatedTotal: cat.accumulatedTotal,
          estimationMonths: (cat.categoryType === 'expected' && !cat.useSubcategories && cat.useEstimation) ? cat.estimationMonths : undefined,
          isBufferCategory: cat.isBufferCategory,
          bufferPriority: cat.bufferPriority,
          color: cat.color || null
        };

        const createdCategory = await this.budgetService.createBudgetCategory(categoryData).toPromise();
        if (!createdCategory || !createdCategory.id) continue;

        // Create subcategories
        if ((cat.categoryType === 'expected' || cat.categoryType === 'savings') && cat.useSubcategories && createdCategory.id && cat.subcategories.length > 0) {
          for (const subcat of cat.subcategories) {
            if (subcat.name && subcat.expectedAmount) {
              await this.budgetService.createBudgetCategorySubcategory(
                createdCategory.id,
                {
                  name: subcat.name,
                  expectedAmount: subcat.expectedAmount,
                  useEstimation: subcat.useEstimation || false,
                  estimationMonths: subcat.useEstimation ? subcat.estimationMonths : undefined
                }
              ).toPromise();
            }
          }
        }
      }
    }

    // Delete categories that were removed
    const currentCategoryIds = new Set(this.categories().filter(c => c.id).map(c => c.id));
    for (const existingCat of existingCategories || []) {
      if (existingCat.id && existingCat.categoryType !== 'surplus' && !currentCategoryIds.has(existingCat.id)) {
        await this.budgetService.deleteBudgetCategory(existingCat.id).toPromise();
      }
    }
  }

  cancel() {
    this.router.navigate(['/budgets']);
  }
}
