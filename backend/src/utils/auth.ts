import bcrypt from 'bcrypt';
import crypto from 'crypto';

const SESSION_TOKEN_LENGTH = 64;
const SESSION_DURATION_HOURS = 24;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateSessionToken(): string {
  return crypto.randomBytes(SESSION_TOKEN_LENGTH).toString('hex');
}

export function getSessionExpirationDate(): Date {
  const expiration = new Date();
  expiration.setHours(expiration.getHours() + SESSION_DURATION_HOURS);
  return expiration;
}

