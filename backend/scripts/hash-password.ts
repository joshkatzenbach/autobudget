#!/usr/bin/env tsx

/**
 * Password Hashing Script
 * 
 * Hashes a password using the same method as the app (bcrypt with 10 salt rounds)
 * 
 * Usage:
 *   npm run hash-password <password>
 *   or
 *   npx tsx scripts/hash-password.ts <password>
 * 
 * Example:
 *   npm run hash-password mypassword123
 */

import bcrypt from 'bcrypt';

// Use the exact same method as the app (10 salt rounds)
async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

// Get password from command line arguments
const password = process.argv[2];

if (!password) {
  console.error('Usage: npm run hash-password <password>');
  console.error('   or: npx tsx scripts/hash-password.ts <password>');
  console.error('');
  console.error('Example:');
  console.error('  npm run hash-password mypassword123');
  process.exit(1);
}

// Hash the password
hashPassword(password)
  .then((hash) => {
    console.log('Password hash:');
    console.log(hash);
    console.log('');
    console.log('You can use this hash to update a user in the database:');
    console.log(`UPDATE users SET password_hash = '${hash}' WHERE email = 'user@example.com';`);
  })
  .catch((error) => {
    console.error('Error hashing password:', error);
    process.exit(1);
  });

