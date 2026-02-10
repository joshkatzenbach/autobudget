#!/usr/bin/env tsx

/**
 * Password Verification Script
 * 
 * Verifies a password against a bcrypt hash
 * 
 * Usage:
 *   npm run verify-password <password> <hash>
 *   or
 *   npx tsx scripts/verify-password.ts <password> <hash>
 * 
 * Example:
 *   npm run verify-password mypassword123 '$2b$10$abcdefghijklmnopqrstuvwxyz...'
 */

import bcrypt from 'bcrypt';

// Get password and hash from command line arguments
const password = process.argv[2];
const hash = process.argv[3];

// Check if hash looks valid (bcrypt hashes start with $2b$ and are 60 characters)
if (hash && !hash.startsWith('$2b$') && !hash.startsWith('$2a$') && !hash.startsWith('$2y$')) {
  console.error('⚠️  Warning: Hash does not start with $2b$, $2a$, or $2y$');
  console.error('   This might indicate the hash was truncated by the shell.');
  console.error('   Make sure to quote the hash with single quotes!');
  console.error('');
  console.error(`   Received hash: ${hash}`);
  console.error('');
}

if (!password || !hash) {
  console.error('Usage: npm run verify-password <password> <hash>');
  console.error('   or: npx tsx scripts/verify-password.ts <password> <hash>');
  console.error('');
  console.error('Example:');
  console.error('  npm run verify-password mypassword123 \'$2b$10$abcdefghijklmnopqrstuvwxyz...\'');
  console.error('');
  console.error('⚠️  IMPORTANT: Always quote the hash with single quotes!');
  console.error('   The hash contains $ characters that the shell will try to expand.');
  console.error('   Without quotes, the hash will be truncated.');
  process.exit(1);
}

// Verify the password
bcrypt.compare(password, hash)
  .then((isValid) => {
    if (isValid) {
      console.log('✅ Password matches the hash!');
      process.exit(0);
    } else {
      console.log('❌ Password does NOT match the hash');
      process.exit(1);
    }
  })
  .catch((error) => {
    console.error('Error verifying password:', error);
    console.error('');
    console.error('This might indicate:');
    console.error('  - Invalid hash format');
    console.error('  - Hash was truncated or corrupted');
    process.exit(1);
  });

