import { db } from '../db';
import { users, sessions } from '../db/schema';
import { eq } from 'drizzle-orm';
import { hashPassword, comparePassword, generateSessionToken, getSessionExpirationDate } from '../utils/auth';

export async function createUser(email: string, password: string, firstName?: string, lastName?: string) {
  const passwordHash = await hashPassword(password);
  
  const [user] = await db
    .insert(users)
    .values({
      email,
      passwordHash,
      firstName,
      lastName,
    })
    .returning();

  return user;
}

export async function findUserByEmail(email: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  return user;
}

export async function validateUserCredentials(email: string, password: string) {
  const user = await findUserByEmail(email);
  
  if (!user) {
    return null;
  }

  const isValid = await comparePassword(password, user.passwordHash);
  
  if (!isValid) {
    return null;
  }

  return user;
}

export async function createOrUpdateSession(userId: number) {
  const token = generateSessionToken();
  const expiresAt = getSessionExpirationDate();

  // Check if user already has a session
  const [existingSession] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .limit(1);

  if (existingSession) {
    // Update existing session
    const [updatedSession] = await db
      .update(sessions)
      .set({
        token,
        expiresAt,
        lastUsedAt: new Date(),
      })
      .where(eq(sessions.id, existingSession.id))
      .returning();

    return updatedSession;
  } else {
    // Create new session
    const [newSession] = await db
      .insert(sessions)
      .values({
        userId,
        token,
        expiresAt,
      })
      .returning();

    return newSession;
  }
}

