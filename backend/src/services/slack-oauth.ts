import { WebClient } from '@slack/web-api';
import * as dotenv from 'dotenv';
import { db } from '../db';
import { slackOAuth } from '../db/schema';
import { eq } from 'drizzle-orm';
import { encrypt, decrypt } from '../utils/encryption';

dotenv.config();

const clientId = process.env.SLACK_CLIENT_ID;
const clientSecret = process.env.SLACK_CLIENT_SECRET;

/**
 * Exchange OAuth code for access token
 * Uses oauth.v2.access API endpoint
 */
export async function exchangeCodeForToken(
  code: string,
  redirectUri: string
): Promise<{
  accessToken: string;
  refreshToken?: string;
  teamId: string;
  botUserId?: string;
  scope?: string;
}> {
  if (!clientId || !clientSecret) {
    throw new Error('SLACK_CLIENT_ID and SLACK_CLIENT_SECRET must be configured');
  }

  try {
    // Use WebClient to exchange code for token
    // Note: Slack's OAuth v2 uses a direct HTTP call, not the WebClient
    const response = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        redirect_uri: redirectUri,
      }),
    });

    const data = await response.json();

    if (!data.ok) {
      throw new Error(data.error || 'Failed to exchange code for token');
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      teamId: data.team?.id || '',
      botUserId: data.bot_user_id,
      scope: data.scope,
    };
  } catch (error: any) {
    console.error('Error exchanging OAuth code for token:', error);
    throw new Error(`Failed to exchange OAuth code: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Store OAuth tokens in database (encrypted)
 */
export async function storeOAuthTokens(
  userId: number,
  tokenData: {
    accessToken: string;
    refreshToken?: string;
    teamId: string;
    botUserId?: string;
    scope?: string;
  }
) {
  try {
    // Encrypt tokens before storing
    const encryptedAccessToken = encrypt(tokenData.accessToken);
    const encryptedRefreshToken = tokenData.refreshToken ? encrypt(tokenData.refreshToken) : null;

    // Check if OAuth record already exists for this user
    const existing = await db
      .select()
      .from(slackOAuth)
      .where(eq(slackOAuth.userId, userId))
      .limit(1);

    if (existing.length > 0) {
      // Update existing record
      await db
        .update(slackOAuth)
        .set({
          teamId: tokenData.teamId,
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          botUserId: tokenData.botUserId || null,
          scope: tokenData.scope || null,
          updatedAt: new Date(),
        })
        .where(eq(slackOAuth.userId, userId));
    } else {
      // Insert new record
      await db.insert(slackOAuth).values({
        userId: userId,
        teamId: tokenData.teamId,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        botUserId: tokenData.botUserId || null,
        scope: tokenData.scope || null,
      });
    }
  } catch (error: any) {
    console.error('Error storing OAuth tokens:', error);
    throw new Error(`Failed to store OAuth tokens: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Get user's access token (decrypted)
 */
export async function getUserAccessToken(userId: number): Promise<string | null> {
  try {
    const [oauth] = await db
      .select()
      .from(slackOAuth)
      .where(eq(slackOAuth.userId, userId))
      .limit(1);

    if (!oauth) {
      return null;
    }

    // Decrypt token
    return decrypt(oauth.accessToken);
  } catch (error: any) {
    console.error('Error getting user access token:', error);
    return null;
  }
}

/**
 * Get full OAuth record for user
 */
export async function getUserOAuth(userId: number) {
  try {
    const [oauth] = await db
      .select()
      .from(slackOAuth)
      .where(eq(slackOAuth.userId, userId))
      .limit(1);

    if (!oauth) {
      return null;
    }

    // Decrypt tokens
    return {
      ...oauth,
      accessToken: decrypt(oauth.accessToken),
      refreshToken: oauth.refreshToken ? decrypt(oauth.refreshToken) : null,
    };
  } catch (error: any) {
    console.error('Error getting user OAuth:', error);
    return null;
  }
}

/**
 * Refresh access token (if refresh token is available)
 * Note: Slack OAuth v2 refresh tokens are only available for certain scopes
 */
export async function refreshAccessToken(userId: number): Promise<string | null> {
  try {
    const oauth = await getUserOAuth(userId);
    if (!oauth || !oauth.refreshToken) {
      return null; // No refresh token available
    }

    // Slack OAuth v2 refresh endpoint
    const response = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId!,
        client_secret: clientSecret!,
        grant_type: 'refresh_token',
        refresh_token: oauth.refreshToken,
      }),
    });

    const data = await response.json();

    if (!data.ok) {
      throw new Error(data.error || 'Failed to refresh token');
    }

    // Update stored token
    await storeOAuthTokens(userId, {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || oauth.refreshToken,
      teamId: oauth.teamId,
      botUserId: oauth.botUserId || undefined,
      scope: oauth.scope || undefined,
    });

    return data.access_token;
  } catch (error: any) {
    console.error('Error refreshing access token:', error);
    return null;
  }
}

/**
 * Update notification group DM channel ID
 */
export async function updateNotificationChannel(userId: number, channelId: string | null) {
  try {
    await db
      .update(slackOAuth)
      .set({
        notificationGroupDMChannelId: channelId,
        updatedAt: new Date(),
      })
      .where(eq(slackOAuth.userId, userId));
  } catch (error: any) {
    console.error('Error updating notification channel:', error);
    throw new Error(`Failed to update notification channel: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Get notification group DM channel ID
 */
export async function getNotificationChannel(userId: number): Promise<string | null> {
  try {
    const [oauth] = await db
      .select({ notificationGroupDMChannelId: slackOAuth.notificationGroupDMChannelId })
      .from(slackOAuth)
      .where(eq(slackOAuth.userId, userId))
      .limit(1);

    return oauth?.notificationGroupDMChannelId || null;
  } catch (error: any) {
    console.error('Error getting notification channel:', error);
    return null;
  }
}

