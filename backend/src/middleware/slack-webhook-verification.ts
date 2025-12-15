import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import * as dotenv from 'dotenv';

dotenv.config();

const signingSecret = process.env.SLACK_SIGNING_SECRET;

/**
 * Verify Slack webhook signature
 * Slack signs webhook requests with X-Slack-Signature header
 * We use HMAC SHA256 to verify authenticity
 */
export function verifySlackWebhook(req: Request, res: Response, next: NextFunction) {
  if (!signingSecret) {
    console.warn('SLACK_SIGNING_SECRET not set - webhook verification disabled');
    // In development, allow webhooks without verification
    // In production, this should be required
    if (process.env.NODE_ENV === 'production') {
      return res.status(500).json({ error: 'Webhook verification not configured' });
    }
    return next();
  }

  // Get the signature from headers
  const signature = req.headers['x-slack-signature'] as string;
  const timestamp = req.headers['x-slack-request-timestamp'] as string;

  if (!signature || !timestamp) {
    console.warn('Slack webhook missing signature or timestamp');
    return res.status(401).json({ error: 'Missing webhook signature or timestamp' });
  }

  // Prevent replay attacks (reject requests older than 5 minutes)
  const currentTime = Math.floor(Date.now() / 1000);
  const requestTime = parseInt(timestamp, 10);
  if (Math.abs(currentTime - requestTime) > 300) {
    console.warn('Slack webhook timestamp too old');
    return res.status(401).json({ error: 'Request timestamp too old' });
  }

  // Get raw body for signature verification
  // The raw body should be stored in req.rawBody by the route middleware
  const body = (req as any).rawBody 
    ? (req as any).rawBody.toString('utf8')
    : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));

  // Create the signature base string
  const sigBaseString = `v0:${timestamp}:${body}`;

  // Create HMAC signature
  const hmac = crypto.createHmac('sha256', signingSecret);
  hmac.update(sigBaseString);
  const mySignature = `v0=${hmac.digest('hex')}`;

  // Compare signatures using timing-safe comparison
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(mySignature))) {
    console.warn('Invalid Slack webhook signature');
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  next();
}

