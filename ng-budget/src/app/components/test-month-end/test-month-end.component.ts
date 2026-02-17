import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../services/api.service';

interface CategorySummary {
  id: number;
  name: string;
  type: string;
  allotted: number;
  spent: number;
  rollover: number;
  netPosition: number;
}

@Component({
  selector: 'app-test-month-end',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './test-month-end.component.html',
  styleUrl: './test-month-end.component.scss'
})
export class TestMonthEndComponent {
  loading = signal(false);
  error = signal<string | null>(null);
  success = signal<string | null>(null);
  output = signal<string | null>(null);
  categories = signal<CategorySummary[]>([]);

  constructor(private api: ApiService) {}

  reset() {
    this.loading.set(true);
    this.clearMessages();

    this.api.post<any>('/test-month-end/reset', {}).subscribe({
      next: (data) => {
        this.loading.set(false);
        this.success.set('Reset complete.');
        this.output.set(JSON.stringify(data, null, 2));
        this.categories.set(data.categories || []);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err.error?.error || err.message || 'Reset failed');
      }
    });
  }

  startMonthEnd() {
    this.loading.set(true);
    this.clearMessages();

    this.api.post<any>('/test-month-end/start', {}).subscribe({
      next: (data) => {
        this.loading.set(false);
        this.success.set(data.message || 'Month-end initiated.');
        this.output.set(JSON.stringify(data, null, 2));
        this.categories.set([]);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err.error?.error || err.message || 'Start failed');
      }
    });
  }

  checkState() {
    this.loading.set(true);
    this.clearMessages();

    this.api.get<any>('/test-month-end/state').subscribe({
      next: (data) => {
        this.loading.set(false);
        this.output.set(JSON.stringify(data, null, 2));
        this.categories.set([]);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err.error?.error || err.message || 'Check state failed');
      }
    });
  }

  private clearMessages() {
    this.error.set(null);
    this.success.set(null);
    this.output.set(null);
  }

  netPositionClass(value: number): string {
    if (value > 0.01) return 'positive';
    if (value < -0.01) return 'negative';
    return 'zero';
  }
}
