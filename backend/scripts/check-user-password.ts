#!/usr/bin/env tsx

/**
 * Check User Password Script
 * 
 * Retrieves a user's password hash from the database and verifies it against a password
 * 
 * Usage:
 *   npm run check-user-password <email> <password>
 *   or
 *   npx tsx scripts/check-user-password.ts <email> <password>
 * 
 * Example:
 *   npm run check-user-password test@example.com mypassword123
 */

import * as dotenv from 'dotenv';
import { db } from '../src/db';
import { users } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { comparePassword } from '../src/utils/auth';

// Load environment variables
dotenv.config({ path: '.env' });

// Get email and password from command line arguments
const email = process.argv[2];
const password = process.argv[3];

if (!email || !password) {
  console.error('Usage: npm run check-user-password <email> <password>');
  console.error('   or: npx tsx scripts/check-user-password.ts <email> <password>');
  console.error('');
  console.error('Example:');
  console.error('  npm run check-user-password test@example.com mypassword123');
  process.exit(1);
}

async function checkUserPassword() {
  try {
    console.log(`Looking up user: ${email}`);
    
    // Find user by email
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        passwordHash: users.passwordHash,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) {
      console.error(`❌ User with email ${email} not found in database`);
      process.exit(1);
    }

    console.log(`✅ User found: ${user.firstName || ''} ${user.lastName || ''} (ID: ${user.id})`);
    console.log('');
    console.log('Password hash from database:');
    console.log(user.passwordHash);
    console.log('');
    console.log(`Hash length: ${user.passwordHash.length} characters`);
    console.log(`Hash starts with: ${user.passwordHash.substring(0, 7)}`);
    console.log('');

    // Check if hash looks valid
    if (!user.passwordHash.startsWith('$2b$') && !user.passwordHash.startsWith('$2a$') && !user.passwordHash.startsWith('$2y$')) {
      console.error('⚠️  WARNING: Hash does not start with $2b$, $2a$, or $2y$');
      console.error('   This might indicate the hash is corrupted or invalid.');
      console.error('');
    }

    // Verify password
    console.log('Verifying password...');
    const isValid = await comparePassword(password, user.passwordHash);

    if (isValid) {
      console.log('✅ Password is CORRECT!');
      console.log('');
      console.log('If login is still failing, check:');
      console.log('  - Email address is correct (case-sensitive)');
      console.log('  - Frontend is sending the password correctly');
      console.log('  - Backend authentication endpoint is working');
    } else {
      console.log('❌ Password is INCORRECT');
      console.log('');
      console.log('Possible issues:');
      console.log('  - Wrong password entered');
      console.log('  - Hash in database doesn\'t match this password');
      console.log('  - Hash was corrupted when updating the database');
      console.log('');
      console.log('To fix:');
      console.log('  1. Generate a new hash: npm run hash-password <password>');
      console.log('  2. Update the database with the new hash');
      console.log('  3. Make sure there are no extra spaces or newlines in the hash');
    }

    process.exit(isValid ? 0 : 1);
  } catch (error: any) {
    console.error('Error checking user password:', error);
    console.error('');
    console.error('This might indicate:');
    console.error('  - Database connection issue');
    console.error('  - Invalid hash format');
    process.exit(1);
  }
}

checkUserPassword();

