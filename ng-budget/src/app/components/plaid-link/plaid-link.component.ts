import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlaidService } from '../../services/plaid.service';

declare global {
  interface Window {
    Plaid: any;
  }
}

@Component({
  selector: 'app-plaid-link',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="plaid-link-container">
      @if (loading()) {
        <div class="loading">Loading Plaid Link...</div>
      } @else if (error()) {
        <div class="error">{{ error() }}</div>
        <button class="btn-primary" (click)="initializePlaid()">Retry</button>
      } @else {
        <button class="btn-primary" (click)="openPlaidLink()" [disabled]="!linkToken()">
          Connect Account
        </button>
      }
    </div>
  `,
  styles: [`
    .plaid-link-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
    }
    .loading, .error {
      padding: 10px;
      text-align: center;
    }
    .error {
      color: #dc3545;
    }
  `]
})
export class PlaidLinkComponent implements OnInit, OnDestroy {
  loading = signal(false);
  error = signal<string | null>(null);
  linkToken = signal<string | null>(null);
  private plaidHandler: any = null;

  constructor(private plaidService: PlaidService) {}

  ngOnInit() {
    // Load Plaid Link script and initialize
    this.loadPlaidScript();
    // Wait a bit for script to load before initializing
    setTimeout(() => {
      this.initializePlaid();
    }, 500);
  }

  ngOnDestroy() {
    if (this.plaidHandler) {
      this.plaidHandler.destroy();
    }
  }

  private loadPlaidScript() {
    if (window.Plaid) {
      return; // Already loaded
    }

    const script = document.createElement('script');
    script.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
    script.onload = () => {
      console.log('Plaid Link script loaded');
    };
    script.onerror = () => {
      this.error.set('Failed to load Plaid Link script');
    };
    document.head.appendChild(script);
  }

  async initializePlaid() {
    this.loading.set(true);
    this.error.set(null);

    try {
      // Wait for Plaid script to load
      await this.waitForPlaid();

      const response = await this.plaidService.createLinkToken().toPromise();
      if (response?.link_token) {
        this.linkToken.set(response.link_token);
      } else {
        throw new Error('No link token received');
      }
    } catch (err: any) {
      console.error('Error initializing Plaid:', err);
      this.error.set(err.error?.error || 'Failed to initialize Plaid Link');
    } finally {
      this.loading.set(false);
    }
  }

  private waitForPlaid(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (window.Plaid) {
        resolve();
        return;
      }

      let attempts = 0;
      const maxAttempts = 50;
      const interval = setInterval(() => {
        attempts++;
        if (window.Plaid) {
          clearInterval(interval);
          resolve();
        } else if (attempts >= maxAttempts) {
          clearInterval(interval);
          reject(new Error('Plaid script failed to load'));
        }
      }, 100);
    });
  }

  openPlaidLink() {
    if (!this.linkToken() || !window.Plaid) {
      this.error.set('Plaid Link not ready');
      return;
    }

    const handler = window.Plaid.create({
      token: this.linkToken()!,
      onSuccess: async (publicToken: string, metadata: any) => {
        try {
          await this.plaidService.exchangePublicToken(publicToken).toPromise();
          // Emit success event or navigate
          window.location.reload(); // Simple reload for now
        } catch (err: any) {
          console.error('Error exchanging public token:', err);
          this.error.set(err.error?.error || 'Failed to connect account');
        }
      },
      onExit: (err: any, metadata: any) => {
        if (err) {
          console.error('Plaid Link error:', err);
          this.error.set(err.display_message || 'Connection cancelled');
        }
      },
      onEvent: (eventName: string, metadata: any) => {
        console.log('Plaid event:', eventName, metadata);
      }
    });

    this.plaidHandler = handler;
    handler.open();
  }
}

