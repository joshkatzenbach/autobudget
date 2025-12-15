import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { SlackMessage, SendMessageRequest, CreateChannelRequest, CreateGroupDMRequest } from '../models/message.model';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class SlackService {
  constructor(private api: ApiService) {}

  sendMessage(request: SendMessageRequest): Observable<any> {
    return this.api.post('/slack/send', request);
  }

  getMessages(): Observable<SlackMessage[]> {
    return this.api.get<SlackMessage[]>('/slack/messages');
  }

  createChannel(request: CreateChannelRequest): Observable<any> {
    return this.api.post('/slack/channels/create', request);
  }

  testAuth(): Observable<any> {
    return this.api.get('/slack/auth/test');
  }

  getChannels(): Observable<any> {
    return this.api.get('/slack/channels');
  }

  getUsers(): Observable<any> {
    return this.api.get('/slack/users');
  }

  joinChannel(channelId: string): Observable<any> {
    return this.api.post(`/slack/channels/${channelId}/join`, {});
  }

  getOAuthUrl(): Observable<{ authUrl: string }> {
    // Call the backend API to get the OAuth URL (requires authentication)
    // The backend will include the user ID in the state parameter
    return this.api.get<{ authUrl: string }>('/slack/oauth/authorize');
  }

  createGroupDM(request: CreateGroupDMRequest): Observable<any> {
    return this.api.post('/slack/group-dm/create', request);
  }

  getIntegrationStatus(): Observable<any> {
    return this.api.get('/slack/integration/status');
  }

  updateNotificationSettings(userIds: string[]): Observable<any> {
    return this.api.post('/slack/integration/notifications', { userIds });
  }
}

