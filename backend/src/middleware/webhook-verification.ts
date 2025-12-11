import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

/**
 * Verify Plaid webhook signature
 * Plaid sends webhooks with a verification key in the PLAID-WEBHOOK-VERIFICATION-KEY header
 * We need to verify this matches our expected key
 */
export function verifyPlaidWebhook(req: Request, res: Response, next: NextFunction) {
  const webhookVerificationKey = process.env.PLAID_WEBHOOK_VERIFICATION_KEY;
  
  if (!webhookVerificationKey) {
    console.warn('PLAID_WEBHOOK_VERIFICATION_KEY not set - webhook verification disabled');
    // In development, allow webhooks without verification
    // In production, this should be required
    if (process.env.NODE_ENV === 'production') {
      return res.status(500).json({ error: 'Webhook verification not configured' });
    }
    return next();
  }

  const providedKey = req.headers['plaid-webhook-verification-key'] as string;
  
  if (!providedKey) {
    console.warn('Plaid webhook missing verification key');
    return res.status(401).json({ error: 'Missing webhook verification key' });
  }

  // Compare the provided key with our expected key
  // Use constant-time comparison to prevent timing attacks
  const isValid = crypto.timingSafeEqual(
    Buffer.from(providedKey),
    Buffer.from(webhookVerificationKey)
  );

  if (!isValid) {
    console.warn('Invalid Plaid webhook verification key');
    return res.status(401).json({ error: 'Invalid webhook verification key' });
  }

  next();
}

