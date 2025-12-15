export interface SlackMessage {
  id: number;
  userId: number | null;
  direction: 'inbound' | 'outbound';
  fromUserId: string | null;
  toChannelId: string | null;
  toUserId: string | null;
  channelId: string;
  messageBody: string;
  messageTs: string | null;
  threadTs: string | null;
  status: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SendMessageRequest {
  channelId?: string;
  userId?: number;
  message: string;
  threadTs?: string;
}

export interface CreateChannelRequest {
  name: string;
  isPrivate?: boolean;
}

export interface CreateGroupDMRequest {
  userIds: string[];
}
