import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SlackService } from '../../services/slack.service';
import { SlackMessage, SendMessageRequest, CreateChannelRequest } from '../../models/message.model';

export interface SlackChannel {
  id: string;
  name: string;
  is_private: boolean;
  is_archived: boolean;
  is_member: boolean;
}

export interface SlackUser {
  id: string;
  name: string;
  real_name: string;
  display_name: string;
  is_bot: boolean;
  is_deleted: boolean;
}

@Component({
  selector: 'app-messaging',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './messaging.component.html',
  styleUrl: './messaging.component.scss'
})
export class MessagingComponent implements OnInit {
  messages = signal<SlackMessage[]>([]);
  channels = signal<SlackChannel[]>([]);
  users = signal<SlackUser[]>([]);
  loading = signal(false);
  loadingChannels = signal(false);
  loadingUsers = signal(false);
  joiningChannel = signal<string | null>(null); // Channel ID being joined
  sending = signal(false);
  creatingChannel = signal(false);
  creatingGroupDM = signal(false);
  testingAuth = signal(false);
  error = signal<string | null>(null);
  success = signal<string | null>(null);
  authStatus = signal<{ connected: boolean; info?: any }>({ connected: false });

  // Form state
  messageForm = {
    channelId: '',
    message: ''
  };

  channelForm = {
    name: '',
    isPrivate: false
  };

  groupDMForm = {
    selectedUserIds: [] as string[]
  };

  constructor(private slackService: SlackService) {}

  ngOnInit() {
    this.loadMessages();
    this.checkAuthStatus();
    this.loadChannels();
    this.loadUsers();
  }

  checkAuthStatus() {
    this.testingAuth.set(true);
    this.slackService.testAuth().subscribe({
      next: (response) => {
        this.authStatus.set({ connected: true, info: response.auth });
        this.testingAuth.set(false);
        // Reload channels and users when connected
        this.loadChannels();
        this.loadUsers();
      },
      error: (err) => {
        // Not connected or error
        this.authStatus.set({ connected: false });
        this.testingAuth.set(false);
        this.channels.set([]); // Clear channels if not connected
        this.users.set([]); // Clear users if not connected
      }
    });
  }

  loadChannels() {
    if (!this.authStatus().connected) {
      return; // Don't load if not connected
    }

    this.loadingChannels.set(true);
    this.slackService.getChannels().subscribe({
      next: (response) => {
        this.channels.set(response.channels || []);
        this.loadingChannels.set(false);
      },
      error: (err) => {
        console.error('Error loading channels:', err);
        this.loadingChannels.set(false);
        // Don't show error for channels - it's not critical
      }
    });
  }

  loadUsers() {
    if (!this.authStatus().connected) {
      return; // Don't load if not connected
    }

    this.loadingUsers.set(true);
    this.slackService.getUsers().subscribe({
      next: (response) => {
        // Filter out deleted users and bots (optional - you can show bots if needed)
        const activeUsers = (response.users || []).filter((user: SlackUser) => !user.is_deleted);
        this.users.set(activeUsers);
        this.loadingUsers.set(false);
      },
      error: (err) => {
        console.error('Error loading users:', err);
        this.loadingUsers.set(false);
        // Don't show error for users - it's not critical
      }
    });
  }

  loadMessages() {
    this.loading.set(true);
    this.error.set(null);

    this.slackService.getMessages().subscribe({
      next: (messages) => {
        this.messages.set(messages);
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Error loading messages:', err);
        this.error.set('Failed to load messages');
        this.loading.set(false);
      }
    });
  }

  connectSlack() {
    // Get OAuth URL from backend (requires authentication)
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

  sendMessage() {
    if (!this.messageForm.message.trim()) {
      this.error.set('Message cannot be empty');
      return;
    }

    if (!this.messageForm.channelId.trim()) {
      this.error.set('Channel ID is required');
      return;
    }

    this.sending.set(true);
    this.error.set(null);
    this.success.set(null);

    const request: SendMessageRequest = {
      channelId: this.messageForm.channelId,
      message: this.messageForm.message
    };

    this.slackService.sendMessage(request).subscribe({
      next: (response) => {
        this.success.set('Message sent successfully!');
        // Reload messages to show the new sent message
        this.loadMessages();
        // Clear form
        this.messageForm.message = '';
        this.sending.set(false);
      },
      error: (err) => {
        console.error('Error sending message:', err);
        this.error.set(err.error?.error || 'Failed to send message');
        this.sending.set(false);
      }
    });
  }

  createChannel() {
    const channelName = this.channelForm.name.trim();
    
    if (!channelName) {
      this.error.set('Channel name is required');
      return;
    }

    // Validate Slack channel name format
    // Slack channel names must be:
    // - Lowercase only
    // - 21 characters or less
    // - Only letters, numbers, hyphens, and underscores
    // - No spaces or special characters
    const normalizedName = channelName.toLowerCase().replace(/\s+/g, '-');
    const slackNameRegex = /^[a-z0-9-_]+$/;
    
    if (!slackNameRegex.test(normalizedName)) {
      this.error.set('Channel name can only contain lowercase letters, numbers, hyphens, and underscores');
      return;
    }

    if (normalizedName.length > 21) {
      this.error.set('Channel name must be 21 characters or less');
      return;
    }

    this.creatingChannel.set(true);
    this.error.set(null);
    this.success.set(null);

    const request: CreateChannelRequest = {
      name: normalizedName,
      isPrivate: this.channelForm.isPrivate
    };

    this.slackService.createChannel(request).subscribe({
      next: (response) => {
        this.success.set(`Channel "${response.channel.name}" created successfully! Channel ID: ${response.channel.id}`);
        // Pre-fill the channel ID in the message form
        this.messageForm.channelId = response.channel.id;
        // Clear form
        this.channelForm.name = '';
        this.channelForm.isPrivate = false;
        this.creatingChannel.set(false);
        // Reload channels list
        this.loadChannels();
      },
      error: (err) => {
        console.error('Error creating channel:', err);
        this.error.set(err.error?.error || 'Failed to create channel');
        this.creatingChannel.set(false);
      }
    });
  }

  toggleUserSelection(userId: string) {
    const index = this.groupDMForm.selectedUserIds.indexOf(userId);
    if (index > -1) {
      this.groupDMForm.selectedUserIds.splice(index, 1);
    } else {
      // Limit to 8 users (Slack's maximum for group DMs)
      if (this.groupDMForm.selectedUserIds.length >= 8) {
        this.error.set('Group DM can have at most 8 users');
        return;
      }
      this.groupDMForm.selectedUserIds.push(userId);
    }
    // Create a new array to trigger change detection
    this.groupDMForm.selectedUserIds = [...this.groupDMForm.selectedUserIds];
  }

  isUserSelected(userId: string): boolean {
    return this.groupDMForm.selectedUserIds.includes(userId);
  }

  createGroupDM() {
    if (this.groupDMForm.selectedUserIds.length < 2) {
      this.error.set('Please select at least 2 users for a group DM');
      return;
    }

    this.creatingGroupDM.set(true);
    this.error.set(null);
    this.success.set(null);

    const request = {
      userIds: this.groupDMForm.selectedUserIds
    };

    this.slackService.createGroupDM(request).subscribe({
      next: (response) => {
        this.success.set(`Group DM created successfully! Channel ID: ${response.channelId}`);
        // Pre-fill the channel ID in the message form
        this.messageForm.channelId = response.channelId;
        // Clear form
        this.groupDMForm.selectedUserIds = [];
        this.creatingGroupDM.set(false);
      },
      error: (err) => {
        console.error('Error creating group DM:', err);
        this.error.set(err.error?.error || 'Failed to create group DM');
        this.creatingGroupDM.set(false);
      }
    });
  }

  testAuth() {
    this.testingAuth.set(true);
    this.error.set(null);
    this.success.set(null);

    this.slackService.testAuth().subscribe({
      next: (response) => {
        this.authStatus.set({ connected: true, info: response.auth });
        this.success.set(`Authentication successful! Connected as ${response.auth.user} in team ${response.auth.team}`);
        this.testingAuth.set(false);
      },
      error: (err) => {
        console.error('Error testing auth:', err);
        this.error.set(err.error?.error || 'Authentication test failed. Please connect your Slack account first.');
        this.authStatus.set({ connected: false });
        this.testingAuth.set(false);
      }
    });
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleString();
  }

  formatChannelId(channelId: string | null): string {
    if (!channelId) return 'N/A';
    // Slack channel IDs start with 'C' for public channels, 'G' for private channels, 'D' for DMs
    return channelId;
  }

  joinChannel(channelId: string) {
    this.joiningChannel.set(channelId);
    this.error.set(null);
    this.success.set(null);

    this.slackService.joinChannel(channelId).subscribe({
      next: (response) => {
        this.success.set(`Successfully joined channel "${response.channel.name}"!`);
        this.joiningChannel.set(null);
        // Reload channels to update membership status
        this.loadChannels();
      },
      error: (err) => {
        console.error('Error joining channel:', err);
        this.error.set(err.error?.error || 'Failed to join channel');
        this.joiningChannel.set(null);
      }
    });
  }
}

