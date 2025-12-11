import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const TAG_POSITION = SALT_LENGTH + IV_LENGTH;
const ENCRYPTED_POSITION = TAG_POSITION + TAG_LENGTH;

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }
  
  // If key is hex-encoded (64 characters for 32 bytes), decode it
  // Otherwise, use it directly and derive a key from it
  if (key.length === 64 && /^[0-9a-fA-F]+$/.test(key)) {
    // Hex-encoded key
    return Buffer.from(key, 'hex');
  } else {
    // Derive a key from the provided string using PBKDF2
    return crypto.pbkdf2Sync(key, 'salt', 100000, 32, 'sha256');
  }
}

export function encrypt(text: string): string {
  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const salt = crypto.randomBytes(SALT_LENGTH);
    
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    const encrypted = Buffer.concat([
      cipher.update(text, 'utf8'),
      cipher.final()
    ]);
    
    const tag = cipher.getAuthTag();
    
    // Combine: salt + iv + tag + encrypted
    return Buffer.concat([salt, iv, tag, encrypted]).toString('base64');
  } catch (error) {
    console.error('Error encrypting data:', error);
    throw new Error('Failed to encrypt data');
  }
}

export function decrypt(encryptedData: string): string {
  try {
    // Try to decode as base64 first
    let data: Buffer;
    try {
      data = Buffer.from(encryptedData, 'base64');
    } catch {
      // If it's not valid base64, it's likely an unencrypted token (backward compatibility)
      console.warn('Token appears to be unencrypted (backward compatibility mode). Please reconnect your accounts to encrypt tokens.');
      return encryptedData;
    }
    
    // Check if data is long enough to be encrypted
    if (data.length < ENCRYPTED_POSITION) {
      // Too short to be encrypted, likely unencrypted token
      console.warn('Token appears to be unencrypted (backward compatibility mode). Please reconnect your accounts to encrypt tokens.');
      return encryptedData;
    }
    
    const key = getEncryptionKey();
    const salt = data.subarray(0, SALT_LENGTH);
    const iv = data.subarray(SALT_LENGTH, TAG_POSITION);
    const tag = data.subarray(TAG_POSITION, ENCRYPTED_POSITION);
    const encrypted = data.subarray(ENCRYPTED_POSITION);
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    
    return decipher.update(encrypted) + decipher.final('utf8');
  } catch (error) {
    // If decryption fails, it might be an unencrypted token (backward compatibility)
    // Check if it looks like a Plaid access token (reasonable length, no special chars)
    if (encryptedData.length > 10 && encryptedData.length < 200) {
      console.warn('Decryption failed, using token as-is (backward compatibility mode). Please reconnect your accounts to encrypt tokens.');
      return encryptedData;
    }
    console.error('Error decrypting data:', error);
    throw new Error('Failed to decrypt data');
  }
}

