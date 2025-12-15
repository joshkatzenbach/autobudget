import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { SlackService } from '../../services/slack.service';
import { ApiService } from '../../services/api.service';

interface IntegrationStatus {
  connected: boolean;
  workspace?: {
    team: string;
    teamId: string;
    user: string;
    userId: string;
  };
  notificationChannelId: string | null;
  notificationUserIds?: string[];
}

interface SlackUser {
  id: string;
  name: string;
  real_name?: string;
  display_name?: string;
  is_bot: boolean;
  is_deleted: boolean;
}

@Component({
  selector: 'app-slack-integration',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './slack-integration.component.html',
  styleUrl: './slack-integration.component.scss'
})
export class SlackIntegrationComponent implements OnInit {
  status = signal<IntegrationStatus | null>(null);
  users = signal<SlackUser[]>([]);
  selectedUserIds = signal<string[]>([]);
  loading = signal(false);
  loadingUsers = signal(false);
  saving = signal(false);
  sendingTest = signal(false);
  testMessage = signal('');
  error = signal<string | null>(null);
  success = signal<string | null>(null);

  constructor(
    private slackService: SlackService,
    private api: ApiService
  ) {}

  ngOnInit() {
    this.loadStatus();
  }

  loadStatus() {
    this.loading.set(true);
    this.error.set(null);

    this.slackService.getIntegrationStatus().subscribe({
      next: (status) => {
        this.status.set(status);
        this.loading.set(false);

        if (status.connected) {
          this.loadUsers();
          // Load current notification settings if channel exists
          if (status.notificationChannelId && status.notificationUserIds) {
            // Pre-select the users who are in the existing group DM
            this.selectedUserIds.set(status.notificationUserIds);
          }
        }
      },
      error: (err) => {
        console.error('Error loading integration status:', err);
        this.error.set('Failed to load integration status');
        this.loading.set(false);
      }
    });
  }

  loadUsers() {
    if (!this.status()?.connected) {
      return;
    }

    this.loadingUsers.set(true);
    this.slackService.getUsers().subscribe({
      next: (response) => {
        // Filter out bots and deleted users
        const activeUsers = (response.users || []).filter(
          (user: SlackUser) => !user.is_bot && !user.is_deleted
        );
        this.users.set(activeUsers);
        this.loadingUsers.set(false);
      },
      error: (err) => {
        console.error('Error loading users:', err);
        this.error.set('Failed to load users');
        this.loadingUsers.set(false);
      }
    });
  }

  connectSlack() {
    this.error.set(null);
    this.slackService.getOAuthUrl().subscribe({
      next: (response) => {
        // Redirect to Slack OAuth page
        window.location.href = response.authUrl;
      },
      error: (err) => {
        console.error('Error getting OAuth URL:', err);
        this.error.set(err.error?.error || 'Failed to initiate Slack connection. Please ensure you are logged in.');
      }
    });
  }

  toggleUserSelection(userId: string) {
    const current = this.selectedUserIds();
    const index = current.indexOf(userId);
    
    if (index > -1) {
      // Remove user
      this.selectedUserIds.set(current.filter(id => id !== userId));
    } else {
      // Add user (max 8)
      if (current.length >= 8) {
        this.error.set('You can select at most 8 users for notifications');
        return;
      }
      this.selectedUserIds.set([...current, userId]);
    }
    this.error.set(null);
  }

  isUserSelected(userId: string): boolean {
    return this.selectedUserIds().includes(userId);
  }

  saveNotificationSettings() {
    this.saving.set(true);
    this.error.set(null);
    this.success.set(null);

    const userIds = this.selectedUserIds();

    this.slackService.updateNotificationSettings(userIds).subscribe({
      next: (response) => {
        this.success.set('Notification settings saved successfully!');
        this.saving.set(false);
        // Reload status to get updated channel ID
        this.loadStatus();
      },
      error: (err) => {
        console.error('Error saving notification settings:', err);
        this.error.set(err.error?.error || 'Failed to save notification settings');
        this.saving.set(false);
      }
    });
  }

  clearNotifications() {
    this.selectedUserIds.set([]);
    this.saveNotificationSettings();
  }

  sendTestMessage() {
    const message = this.testMessage().trim();
    if (!message) {
      this.error.set('Please enter a test message');
      return;
    }

    const channelId = this.status()?.notificationChannelId;
    if (!channelId) {
      this.error.set('No notification channel configured');
      return;
    }

    this.sendingTest.set(true);
    this.error.set(null);
    this.success.set(null);

    this.slackService.sendMessage({
      channelId: channelId,
      message: message
    }).subscribe({
      next: (response) => {
        this.success.set('Test message sent successfully!');
        this.testMessage.set('');
        this.sendingTest.set(false);
      },
      error: (err) => {
        console.error('Error sending test message:', err);
        this.error.set(err.error?.error || 'Failed to send test message');
        this.sendingTest.set(false);
      }
    });
  }
}

