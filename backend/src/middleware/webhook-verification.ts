import { Request, Response, NextFunction } from 'express';
import { jwtDecode } from 'jwt-decode';
import * as jose from 'jose';
import { sha256 } from 'js-sha256';
import compare from 'secure-compare';
import { plaidClient } from '../services/plaid';

// Cache for webhook verification keys (JWKs)
// Key: key_id (kid), Value: JWK (with Plaid-specific fields)
type PlaidJWK = jose.JWK & {
  expired_at?: number | null;
  created_at?: number;
};
const keyCache = new Map<string, PlaidJWK>();

/**
 * Verify Plaid webhook using JWT-based verification
 * 
 * According to Plaid's documentation:
 * 1. Extract JWT from Plaid-Verification header
 * 2. Decode JWT header to get key_id (kid)
 * 3. Fetch JWK from Plaid using /webhook_verification_key/get
 * 4. Verify JWT signature using JWK
 * 5. Check iat (issued at time) is not more than 5 minutes old
 * 6. Compare SHA-256 hash of body with request_body_sha256 in JWT payload
 * 
 * Reference: https://plaid.com/docs/api/webhooks/webhook-verification/
 */
export async function verifyPlaidWebhook(req: Request, res: Response, next: NextFunction) {
  try {
    // Get JWT from Plaid-Verification header (case-insensitive)
    const verificationHeader = req.headers['plaid-verification'] as string || 
                               req.headers['Plaid-Verification'] as string;

    if (!verificationHeader) {
      console.warn('Plaid webhook missing Plaid-Verification header');
      // In development, allow webhooks without verification
      if (process.env.NODE_ENV === 'production') {
        return res.status(401).json({ error: 'Missing Plaid-Verification header' });
      }
      return next();
    }

    // Decode JWT header to get key_id (kid) and algorithm
    let decodedHeader: { alg: string; kid: string; typ: string };
    try {
      decodedHeader = jwtDecode(verificationHeader, { header: true }) as any;
    } catch (error) {
      console.warn('Failed to decode JWT header:', error);
      return res.status(401).json({ error: 'Invalid JWT format' });
    }

    // Verify algorithm is ES256
    if (decodedHeader.alg !== 'ES256') {
      console.warn(`Invalid JWT algorithm: ${decodedHeader.alg}, expected ES256`);
      return res.status(401).json({ error: 'Invalid JWT algorithm' });
    }

    const keyId = decodedHeader.kid;
    if (!keyId) {
      console.warn('JWT header missing key_id (kid)');
      return res.status(401).json({ error: 'Missing key_id in JWT header' });
    }

    // Get or fetch the verification key (JWK)
    let jwk: PlaidJWK;
    if (keyCache.has(keyId)) {
      jwk = keyCache.get(keyId)!;
    } else {
      try {
        // Fetch JWK from Plaid
        const response = await plaidClient.webhookVerificationKeyGet({
          key_id: keyId,
        });
        jwk = response.data.key as PlaidJWK;
        
        // Cache the key (check expiration if provided)
        if (jwk.expired_at && jwk.expired_at * 1000 < Date.now()) {
          console.warn(`Cached key ${keyId} has expired`);
          return res.status(401).json({ error: 'Verification key expired' });
        }
        
        keyCache.set(keyId, jwk);
      } catch (error: any) {
        console.error('Failed to fetch webhook verification key:', error);
        return res.status(401).json({ error: 'Failed to fetch verification key' });
      }
    }

    // Verify JWT signature and check iat (issued at time)
    try {
      const keyLike = await jose.importJWK(jwk);
      
      // Verify JWT signature and check expiration (max 5 minutes old)
      const { payload } = await jose.jwtVerify(verificationHeader, keyLike, {
        maxTokenAge: '5 min',
      });

      // Get raw body for SHA-256 calculation
      // The raw body should be stored in req.rawBody by the route middleware
      const rawBody = (req as any).rawBody 
        ? (req as any).rawBody.toString('utf8')
        : JSON.stringify(req.body);

      // Compute SHA-256 hash of the webhook body
      const bodyHash = sha256(rawBody);

      // Get claimed hash from JWT payload
      const claimedBodyHash = (payload as any).request_body_sha256;

      if (!claimedBodyHash) {
        console.warn('JWT payload missing request_body_sha256');
        return res.status(401).json({ error: 'Invalid JWT payload' });
      }

      // Compare hashes using constant-time comparison to prevent timing attacks
      if (!compare(bodyHash, claimedBodyHash)) {
        console.warn('Webhook body hash mismatch');
        console.warn(`Expected: ${claimedBodyHash}`);
        console.warn(`Got: ${bodyHash}`);
        return res.status(401).json({ error: 'Body hash verification failed' });
      }

      // All checks passed
      const webhookBody = req.body || {};
      console.log(`[WEBHOOK] Verified successfully for item ${webhookBody.item_id || 'unknown'}`);
      next();
    } catch (error: any) {
      if (error.code === 'ERR_JWT_EXPIRED' || error.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
        console.warn('JWT verification failed:', error.message);
        return res.status(401).json({ error: 'JWT verification failed: token expired or invalid' });
      }
      console.error('JWT verification error:', error);
      return res.status(401).json({ error: 'JWT verification failed' });
    }
  } catch (error: any) {
    console.error('Webhook verification error:', error);
    // In development, allow webhooks through if verification fails
    if (process.env.NODE_ENV === 'production') {
      return res.status(401).json({ error: 'Webhook verification failed' });
    }
    console.warn('Allowing webhook through in development mode despite verification error');
    return next();
  }
}
