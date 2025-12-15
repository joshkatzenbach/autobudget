import { WebClient } from '@slack/web-api';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Initialize Slack WebClient with access token
 */
export function createSlackClient(accessToken: string): WebClient {
  return new WebClient(accessToken);
}

/**
 * Send a message to a Slack channel or DM
 * Uses chat.postMessage API endpoint
 */
export async function sendMessage(
  accessToken: string,
  channelId: string,
  text: string,
  threadTs?: string
): Promise<string> {
  const client = createSlackClient(accessToken);
  
  try {
    const result = await client.chat.postMessage({
      channel: channelId,
      text: text,
      thread_ts: threadTs, // Optional: reply to a thread
    });

    if (!result.ok || !result.ts) {
      throw new Error(result.error || 'Failed to send message');
    }

    return result.ts; // Return message timestamp
  } catch (error: any) {
    console.error('Error sending Slack message:', error);
    throw new Error(`Failed to send Slack message: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Create a new Slack channel
 * Uses conversations.create API endpoint
 */
export async function createChannel(
  accessToken: string,
  name: string,
  isPrivate: boolean = false
): Promise<{ id: string; name: string }> {
  const client = createSlackClient(accessToken);

  try {
    const result = await client.conversations.create({
      name: name,
      is_private: isPrivate,
    });

    if (!result.ok || !result.channel) {
      throw new Error(result.error || 'Failed to create channel');
    }

    return {
      id: result.channel.id || '',
      name: result.channel.name || name,
    };
  } catch (error: any) {
    console.error('Error creating Slack channel:', error);
    throw new Error(`Failed to create Slack channel: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Test authentication token
 * Uses auth.test API endpoint
 */
export async function authTest(accessToken: string): Promise<{
  ok: boolean;
  url?: string;
  team?: string;
  user?: string;
  team_id?: string;
  user_id?: string;
}> {
  const client = createSlackClient(accessToken);

  try {
    const result = await client.auth.test();

    if (!result.ok) {
      throw new Error(result.error || 'Authentication test failed');
    }

    return {
      ok: result.ok,
      url: result.url,
      team: result.team,
      user: result.user,
      team_id: result.team_id,
      user_id: result.user_id,
    };
  } catch (error: any) {
    console.error('Error testing Slack auth:', error);
    throw new Error(`Failed to test Slack authentication: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Get user information
 */
export async function getUserInfo(accessToken: string, userId: string): Promise<any> {
  const client = createSlackClient(accessToken);

  try {
    const result = await client.users.info({ user: userId });

    if (!result.ok || !result.user) {
      throw new Error(result.error || 'Failed to get user info');
    }

    return result.user;
  } catch (error: any) {
    console.error('Error getting Slack user info:', error);
    throw new Error(`Failed to get Slack user info: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Get channel information
 */
export async function getChannelInfo(accessToken: string, channelId: string): Promise<any> {
  const client = createSlackClient(accessToken);

  try {
    const result = await client.conversations.info({ channel: channelId });

    if (!result.ok || !result.channel) {
      throw new Error(result.error || 'Failed to get channel info');
    }

    return result.channel;
  } catch (error: any) {
    console.error('Error getting Slack channel info:', error);
    throw new Error(`Failed to get Slack channel info: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Get members of a conversation (channel or group DM)
 * Uses conversations.members API endpoint
 */
export async function getConversationMembers(accessToken: string, channelId: string): Promise<string[]> {
  const client = createSlackClient(accessToken);

  try {
    const result = await client.conversations.members({ channel: channelId });

    if (!result.ok || !result.members) {
      throw new Error(result.error || 'Failed to get conversation members');
    }

    return result.members;
  } catch (error: any) {
    console.error('Error getting conversation members:', error);
    throw new Error(`Failed to get conversation members: ${error.message || 'Unknown error'}`);
  }
}

/**
 * List all channels the bot has access to
 * Uses conversations.list API endpoint
 */
export async function listChannels(accessToken: string, types: string = 'public_channel,private_channel'): Promise<Array<{ id: string; name: string; is_private: boolean; is_archived: boolean; is_member: boolean }>> {
  const client = createSlackClient(accessToken);

  try {
    const result = await client.conversations.list({
      types: types, // 'public_channel', 'private_channel', 'mpim', 'im'
      exclude_archived: true, // Don't include archived channels
    });

    if (!result.ok || !result.channels) {
      throw new Error(result.error || 'Failed to list channels');
    }

    return result.channels.map((channel: any) => ({
      id: channel.id,
      name: channel.name,
      is_private: channel.is_private || false,
      is_archived: channel.is_archived || false,
      is_member: channel.is_member || false, // Whether the bot is a member of the channel
    }));
  } catch (error: any) {
    console.error('Error listing Slack channels:', error);
    throw new Error(`Failed to list Slack channels: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Join a Slack channel
 * Uses conversations.join API endpoint
 */
export async function joinChannel(accessToken: string, channelId: string): Promise<{ id: string; name: string }> {
  const client = createSlackClient(accessToken);

  try {
    const result = await client.conversations.join({
      channel: channelId,
    });

    if (!result.ok || !result.channel) {
      throw new Error(result.error || 'Failed to join channel');
    }

    return {
      id: result.channel.id || channelId,
      name: result.channel.name || '',
    };
  } catch (error: any) {
    console.error('Error joining Slack channel:', error);
    throw new Error(`Failed to join Slack channel: ${error.message || 'Unknown error'}`);
  }
}

/**
 * List all users in the workspace
 * Uses users.list API endpoint
 */
export async function listUsers(accessToken: string): Promise<Array<{ id: string; name: string; real_name: string; display_name: string; is_bot: boolean; is_deleted: boolean }>> {
  const client = createSlackClient(accessToken);

  try {
    const result = await client.users.list({
      include_locale: false,
    });

    if (!result.ok || !result.members) {
      throw new Error(result.error || 'Failed to list users');
    }

    return result.members.map((user: any) => ({
      id: user.id,
      name: user.name,
      real_name: user.real_name || user.name,
      display_name: user.profile?.display_name || user.real_name || user.name,
      is_bot: user.is_bot || false,
      is_deleted: user.deleted || false,
    }));
  } catch (error: any) {
    console.error('Error listing Slack users:', error);
    throw new Error(`Failed to list Slack users: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Create or open a group DM (multi-person instant message)
 * Uses conversations.open API endpoint
 * @param accessToken - Slack access token
 * @param userIds - Array of user IDs to include in the group DM (2-8 users, plus the bot)
 * @returns The conversation ID (channel ID) for the group DM
 */
export async function createGroupDM(
  accessToken: string,
  userIds: string[]
): Promise<{ id: string; name?: string }> {
  const client = createSlackClient(accessToken);

  try {
    // conversations.open requires at least 2 users (plus the bot makes 3 total)
    // Maximum is 8 users (plus the bot makes 9 total)
    if (userIds.length < 2) {
      throw new Error('Group DM requires at least 2 users');
    }
    if (userIds.length > 8) {
      throw new Error('Group DM can have at most 8 users');
    }

    // Configure retry options for rate limiting
    // The WebClient will automatically retry on rate limit errors
    const result = await client.conversations.open({
      users: userIds.join(','), // Comma-separated list of user IDs
    });

    if (!result.ok || !result.channel) {
      // Check for rate limiting errors
      if (result.error === 'ratelimited' || result.error === 'rate_limited') {
        throw new Error('Slack API rate limit reached. The request will be retried automatically. Please wait a moment and try again.');
      }
      throw new Error(result.error || 'Failed to create group DM');
    }

    return {
      id: result.channel.id || '',
      name: result.channel.name || undefined,
    };
  } catch (error: any) {
    console.error('Error creating group DM:', error);
    
    // Check if it's a rate limit error
    if (error.message?.includes('rate limit') || error.message?.includes('ratelimited')) {
      throw new Error('Slack API rate limit reached. Please wait a moment and try again. The request will be retried automatically.');
    }
    
    throw new Error(`Failed to create group DM: ${error.message || 'Unknown error'}`);
  }
}

