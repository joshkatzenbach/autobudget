import { db } from '../db';
import { slackMessages, users, slackOAuth } from '../db/schema';
import { eq } from 'drizzle-orm';

export interface StoreMessageParams {
  userId?: number | null;
  direction: 'inbound' | 'outbound';
  fromUserId?: string | null;
  toChannelId?: string | null;
  toUserId?: string | null;
  channelId: string;
  messageBody: string;
  messageTs: string;
  threadTs?: string | null;
  status?: string | null;
}

/**
 * Store a Slack message in the database
 */
export async function storeMessage(params: StoreMessageParams) {
  const [message] = await db
    .insert(slackMessages)
    .values({
      userId: params.userId || null,
      direction: params.direction,
      fromUserId: params.fromUserId || null,
      toChannelId: params.toChannelId || null,
      toUserId: params.toUserId || null,
      channelId: params.channelId,
      messageBody: params.messageBody,
      messageTs: params.messageTs,
      threadTs: params.threadTs || null,
      status: params.status || null,
      updatedAt: new Date(),
    })
    .returning();

  return message;
}

/**
 * Find user by Slack user ID
 */
export async function findUserBySlackId(slackUserId: string) {
  // Note: We'll need to add a slackUserId field to users table or create a mapping
  // For now, we'll search in slackOAuth table
  const [oauth] = await db
    .select({ userId: slackOAuth.userId })
    .from(slackOAuth)
    .where(eq(slackOAuth.botUserId, slackUserId))
    .limit(1);

  if (!oauth) {
    return null;
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, oauth.userId))
    .limit(1);

  return user || null;
}

/**
 * Update message status by message timestamp
 */
export async function updateMessageStatus(messageTs: string, status: string) {
  const [updated] = await db
    .update(slackMessages)
    .set({
      status: status,
      updatedAt: new Date(),
    })
    .where(eq(slackMessages.messageTs, messageTs))
    .returning();

  return updated;
}

/**
 * Process incoming message from Slack Events API
 * Returns response message if needed, or null
 */
export async function processIncomingMessage(
  event: {
    type: string;
    user?: string;
    channel?: string;
    text?: string;
    ts?: string;
    thread_ts?: string;
  }
): Promise<string | null> {
  // Store the incoming message
  await storeMessage({
    userId: null, // Will be set if we can find the user
    direction: 'inbound',
    fromUserId: event.user || null,
    channelId: event.channel || '',
    messageBody: event.text || '',
    messageTs: event.ts || '',
    threadTs: event.thread_ts || null,
    status: 'received',
  });

  // TODO: Add command processing logic here
  // For now, just acknowledge receipt
  return `Message received! We'll process your request shortly.`;
}

