import { Request, Response, NextFunction } from 'express';
import { db } from '../db';
import { sessions, users } from '../db/schema';
import { eq } from 'drizzle-orm';

export interface AuthRequest extends Request {
  userId?: number;
  user?: typeof users.$inferSelect;
}

export async function authenticateToken(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }

    // Find session by token
    const session = await db
      .select({
        session: sessions,
        user: users,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(eq(sessions.token, token))
      .limit(1);

    if (session.length === 0) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    const { session: sessionData, user: userData } = session[0];

    // Check if session is expired
    if (new Date() > new Date(sessionData.expiresAt)) {
      res.status(401).json({ error: 'Token expired' });
      return;
    }

    // Update last used timestamp
    await db
      .update(sessions)
      .set({ lastUsedAt: new Date() })
      .where(eq(sessions.id, sessionData.id));

    req.userId = userData.id;
    req.user = userData;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

