import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TransactionService } from '../../services/transaction.service';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.scss'
})
export class AdminComponent {
  loading = signal(false);
  error = signal<string | null>(null);
  success = signal<string | null>(null);

  constructor(private transactionService: TransactionService) {}

  deleteAllTransactions() {
    if (!confirm('Are you sure you want to delete ALL transactions? This action cannot be undone.')) {
      return;
    }

    // Double confirmation for safety
    if (!confirm('This will permanently delete all transactions. Are you absolutely sure?')) {
      return;
    }

    this.loading.set(true);
    this.error.set(null);
    this.success.set(null);

    this.transactionService.deleteAllTransactions().subscribe({
      next: (response) => {
        this.loading.set(false);
        this.success.set(`Successfully deleted ${response.deletedCount} transactions.`);
      },
      error: (err) => {
        console.error('Error deleting transactions:', err);
        this.loading.set(false);
        const errorMessage = err.error?.error || err.message || 'Failed to delete transactions';
        this.error.set(errorMessage);
      }
    });
  }
}

