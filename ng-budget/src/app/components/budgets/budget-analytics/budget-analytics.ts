import { Component, Input, OnInit, OnChanges, SimpleChanges, AfterViewInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Chart, ChartConfiguration, ChartData, registerables } from 'chart.js';
import { Budget, BudgetCategory } from '../../../models/budget.model';

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
  
  variableChart: Chart | null = null;

  ngOnInit() {
    // Chart will be created in ngAfterViewInit
  }

  ngOnChanges(changes: SimpleChanges) {
    // Only update if view is already initialized
    if (this.chartCanvas) {
      this.updateVariableSpendingChart();
    }
  }

  ngAfterViewInit() {
    // Wait a tick to ensure view is fully initialized
    setTimeout(() => {
      this.updateVariableSpendingChart();
    }, 0);
  }

  private updateVariableSpendingChart() {
    if (!this.chartCanvas || !this.categories || this.categories.length === 0) {
      return;
    }

    // Filter for variable categories only
    const variableCategories = this.categories.filter(
      cat => cat.categoryType === 'variable'
    );

    if (variableCategories.length === 0) {
      return;
    }

    // Sort by allocated amount (descending)
    const sortedCategories = [...variableCategories].sort((a, b) => {
      const allocatedA = parseFloat(a.allocatedAmount) || 0;
      const allocatedB = parseFloat(b.allocatedAmount) || 0;
      return allocatedB - allocatedA;
    });

    const labels = sortedCategories.map(cat => cat.name);
    const allottedAmounts = sortedCategories.map(cat => parseFloat(cat.allocatedAmount) || 0);
    const spentAmounts = sortedCategories.map(cat => parseFloat(cat.spentAmount) || 0);
    const colors = sortedCategories.map(cat => cat.color || '#667eea');

    // Create faded colors for allotted amounts (30% opacity)
    const fadedColors = colors.map(color => {
      const hex = color.replace('#', '');
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, 0.3)`;
    });

    // Create full opacity colors for spent amounts
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
          order: 2, // Render behind spent
          barThickness: 40, // Fixed thickness for overlap
        },
        {
          label: 'Spent',
          data: spentAmounts,
          backgroundColor: fullColors,
          borderColor: colors,
          borderWidth: 2,
          order: 1, // Render on top
          barThickness: 40, // Same fixed thickness - ensures complete overlap
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
            // @ts-ignore - grouped is a valid Chart.js option but not in types
            grouped: false, // Disable grouping so bars overlap at same x position
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
        // @ts-ignore - categoryPercentage and barPercentage are valid Chart.js options but not in types
        categoryPercentage: 1.0, // Full width for categories
        barPercentage: 1.0, // Full width for bars - ensures overlap
      },
    };

    // Destroy existing chart if it exists
    if (this.variableChart) {
      this.variableChart.destroy();
    }

    // Create new chart
    this.variableChart = new Chart(this.chartCanvas.nativeElement, config);
  }

  ngOnDestroy() {
    if (this.variableChart) {
      this.variableChart.destroy();
    }
  }
}
