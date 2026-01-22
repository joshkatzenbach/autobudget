import { Component, Input, OnInit, OnChanges, SimpleChanges, AfterViewInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Chart, ChartConfiguration, ChartData, registerables } from 'chart.js';
import { Budget, BudgetCategory, MonthlySnapshot } from '../../../models/budget.model';
import { BudgetService } from '../../../services/budget.service';

Chart.register(...registerables);

@Component({
  selector: 'app-budget-analytics',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './budget-analytics.html',
  styleUrl: './budget-analytics.scss',
})
export class BudgetAnalytics implements OnInit, OnChanges, AfterViewInit, OnDestroy {
  @Input() budget: Budget | null = null;
  @Input() categories: BudgetCategory[] = [];
  
  @ViewChild('variableSpendingChart', { static: false }) chartCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('rolloverChart', { static: false }) rolloverChartCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('savingsChart', { static: false }) savingsChartCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('savingsLineChart', { static: false }) savingsLineChartCanvas!: ElementRef<HTMLCanvasElement>;
  
  variableChart: Chart | null = null;
  rolloverChart: Chart | null = null;
  savingsChart: Chart | null = null;
  savingsLineChart: Chart | null = null;
  selectedSavingsCategory: BudgetCategory | null = null;
  monthlySnapshots: MonthlySnapshot[] = [];

  constructor(private budgetService: BudgetService) {}

  async ngOnInit() {
    await this.loadMonthlySnapshots();
  }

  async loadMonthlySnapshots() {
    try {
      this.monthlySnapshots = await this.budgetService.getMonthlySnapshots().toPromise() || [];
    } catch (error) {
      console.error('Error loading monthly snapshots:', error);
    }
  }

  ngOnChanges(changes: SimpleChanges) {
    if (this.chartCanvas) {
      this.updateVariableSpendingChart();
    }
    if (this.rolloverChartCanvas) {
      this.updateRolloverChart();
    }
    if (this.savingsChartCanvas && !this.selectedSavingsCategory) {
      this.updateSavingsChart();
    }
    if (this.savingsLineChartCanvas && this.selectedSavingsCategory) {
      this.updateSavingsLineChart();
    }
  }

  async ngAfterViewInit() {
    await this.loadMonthlySnapshots();
    setTimeout(() => {
      this.updateVariableSpendingChart();
      this.updateRolloverChart();
      this.updateSavingsChart();
    }, 0);
  }

  private updateVariableSpendingChart() {
    if (!this.chartCanvas || !this.categories || this.categories.length === 0) {
      return;
    }

    const variableCategories = this.categories.filter(
      cat => cat.categoryType === 'variable'
    );

    if (variableCategories.length === 0) {
      return;
    }

    const sortedCategories = [...variableCategories].sort((a, b) => {
      const allocatedA = parseFloat(a.allocatedAmount) || 0;
      const allocatedB = parseFloat(b.allocatedAmount) || 0;
      return allocatedB - allocatedA;
    });

    const labels = sortedCategories.map(cat => cat.name);
    const allottedAmounts = sortedCategories.map(cat => parseFloat(cat.allocatedAmount) || 0);
    const spentAmounts = sortedCategories.map(cat => parseFloat(cat.spentAmount) || 0);
    const colors = sortedCategories.map(cat => cat.color || '#667eea');

    const fadedColors = colors.map(color => {
      const hex = color.replace('#', '');
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, 0.3)`;
    });

    const fullColors = colors.map(color => {
      const hex = color.replace('#', '');
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, 1)`;
    });

    const chartData: ChartData<'bar'> = {
      labels,
      datasets: [
        {
          label: 'Allotted',
          data: allottedAmounts,
          backgroundColor: fadedColors,
          borderColor: colors,
          borderWidth: 1,
          order: 2,
          barThickness: 40,
        },
        {
          label: 'Spent',
          data: spentAmounts,
          backgroundColor: fullColors,
          borderColor: colors,
          borderWidth: 2,
          order: 1,
          barThickness: 40,
        },
      ],
    };

    const config: ChartConfiguration<'bar'> = {
      type: 'bar',
      data: chartData,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: 'top',
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                const label = context.dataset.label || '';
                const value = context.parsed.y;
                if (value === null || value === undefined || isNaN(value)) {
                  return `${label}: $0.00`;
                }
                return `${label}: $${Number(value).toFixed(2)}`;
              },
            },
          },
        },
        scales: {
          x: {
            stacked: false,
            // @ts-ignore
            grouped: false,
          },
          y: {
            beginAtZero: true,
            ticks: {
              callback: function(value) {
                return '$' + value;
              },
            },
          },
        },
        // @ts-ignore
        categoryPercentage: 1.0,
        barPercentage: 1.0,
      },
    };

    if (this.variableChart) {
      this.variableChart.destroy();
    }

    this.variableChart = new Chart(this.chartCanvas.nativeElement, config);
  }

  private updateRolloverChart() {
    if (!this.rolloverChartCanvas || !this.categories || this.categories.length === 0) {
      return;
    }

    const variableCategories = this.categories.filter(
      cat => cat.categoryType === 'variable'
    );

    if (variableCategories.length === 0) {
      return;
    }

    const labels = variableCategories.map(cat => cat.name);
    const rolloverBalances = variableCategories.map(cat => parseFloat(cat.rolloverBalance || '0'));
    const colors = variableCategories.map(cat => {
      const balance = parseFloat(cat.rolloverBalance || '0');
      // Green for positive, red for negative
      return balance >= 0 ? '#28a745' : '#dc3545';
    });

    const chartData: ChartData<'bar'> = {
      labels,
      datasets: [{
        label: 'Rollover Balance',
        data: rolloverBalances,
        backgroundColor: colors,
        borderColor: colors.map(c => c + 'CC'),
        borderWidth: 2,
      }],
    };

    const config: ChartConfiguration<'bar'> = {
      type: 'bar',
      data: chartData,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                const value = context.parsed.y;
                const sign = value >= 0 ? '' : '-';
                return `${sign}$${Math.abs(value).toFixed(2)}`;
              },
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: function(value) {
                return '$' + value;
              },
            },
          },
        },
      },
    };

    if (this.rolloverChart) {
      this.rolloverChart.destroy();
    }

    this.rolloverChart = new Chart(this.rolloverChartCanvas.nativeElement, config);
  }

  async onSavingsCategoryClick(category: BudgetCategory) {
    this.selectedSavingsCategory = category;
    try {
      const snapshots = await this.budgetService.getMonthlySnapshots(category.id).toPromise() || [];
      this.monthlySnapshots = snapshots;
      setTimeout(() => {
        this.updateSavingsLineChart();
      }, 0);
    } catch (error) {
      console.error('Error loading category snapshots:', error);
    }
  }

  private updateSavingsLineChart() {
    if (!this.savingsLineChartCanvas || !this.selectedSavingsCategory || this.monthlySnapshots.length === 0) {
      return;
    }

    const sorted = [...this.monthlySnapshots].sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return a.month - b.month;
    });

    const labels = sorted.map(s => `${new Date(s.year, s.month - 1).toLocaleString('default', { month: 'short', year: 'numeric' })}`);
    const data = sorted.map(s => parseFloat(s.finalRolloverBalance));

    const chartData: ChartData<'line'> = {
      labels,
      datasets: [{
        label: this.selectedSavingsCategory.name,
        data,
        borderColor: this.selectedSavingsCategory.color || '#667eea',
        backgroundColor: (this.selectedSavingsCategory.color || '#667eea') + '40',
        fill: true,
        tension: 0.4,
      }],
    };

    const config: ChartConfiguration<'line'> = {
      type: 'line',
      data: chartData,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: 'top',
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                return `$${Number(context.parsed.y).toFixed(2)}`;
              },
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: function(value) {
                return '$' + value;
              },
            },
          },
        },
      },
    };

    if (this.savingsLineChart) {
      this.savingsLineChart.destroy();
    }

    this.savingsLineChart = new Chart(this.savingsLineChartCanvas.nativeElement, config);
  }

  private updateSavingsChart() {
    if (!this.savingsChartCanvas || !this.categories || this.categories.length === 0) {
      return;
    }

    const savingsCategories = this.categories.filter(cat => cat.categoryType === 'savings');
    if (savingsCategories.length === 0) {
      return;
    }

    const labels = savingsCategories.map(cat => cat.name);
    const data = savingsCategories.map(cat => parseFloat(cat.rolloverBalance || '0'));
    const colors = savingsCategories.map(cat => cat.color || '#667eea');

    const chartData: ChartData<'bar'> = {
      labels,
      datasets: [{
        label: 'Total Savings',
        data,
        backgroundColor: colors,
        borderColor: colors.map(c => c + 'CC'),
        borderWidth: 2,
      }],
    };

    const config: ChartConfiguration<'bar'> = {
      type: 'bar',
      data: chartData,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                return `$${Number(context.parsed.y).toFixed(2)}`;
              },
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: function(value) {
                return '$' + value;
              },
            },
          },
        },
        onClick: (event, elements) => {
          if (elements.length > 0) {
            const index = elements[0].index;
            this.onSavingsCategoryClick(savingsCategories[index]);
          }
        },
      },
    };

    if (this.savingsChart) {
      this.savingsChart.destroy();
    }

    this.savingsChart = new Chart(this.savingsChartCanvas.nativeElement, config);
  }

  ngOnDestroy() {
    if (this.variableChart) {
      this.variableChart.destroy();
    }
    if (this.rolloverChart) {
      this.rolloverChart.destroy();
    }
    if (this.savingsChart) {
      this.savingsChart.destroy();
    }
    if (this.savingsLineChart) {
      this.savingsLineChart.destroy();
    }
  }

  getVariableCategories() {
    return this.categories.filter(cat => cat.categoryType === 'variable');
  }

  getFixedCategories() {
    return this.categories.filter(cat => cat.categoryType === 'fixed');
  }

  getRolloverBalance(category: BudgetCategory): number {
    return parseFloat(category.rolloverBalance || '0');
  }

  parseFloat(value: string): number {
    return parseFloat(value) || 0;
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
  }
}
