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
