import { Router, Request, Response } from 'express';
import { db } from '../db';
import { budgets } from '../db/schema';
import { eq } from 'drizzle-orm';

const router = Router();

/**
 * POST /api/cron/month-end
 * Trigger month-end processing for all users with active budgets.
 * Authenticated via CRON_SECRET env var (Railway cron or external cron service).
 * Should be called on the 1st of each month — processes the PREVIOUS month.
 */
router.post('/month-end', async (req: Request, res: Response) => {
  try {
    // Authenticate via CRON_SECRET
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers.authorization;

    if (!cronSecret) {
      console.error('[CRON] CRON_SECRET not configured');
      return res.status(500).json({ error: 'CRON_SECRET not configured' });
    }

    if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Determine previous month (current date - 1 day to handle the 1st)
    const now = new Date();
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const year = prevMonth.getFullYear();
    const month = prevMonth.getMonth() + 1; // 1-indexed

    console.log(`[CRON] Starting month-end processing for ${year}-${month}`);

    // Get all users with active budgets
    const activeBudgets = await db
      .select({ userId: budgets.userId })
      .from(budgets)
      .where(eq(budgets.isActive, true));

    const results: { userId: number; success: boolean; error?: string }[] = [];

    const { initiateMonthEnd } = await import('../services/month-end');

    for (const { userId } of activeBudgets) {
      try {
        await initiateMonthEnd(userId, year, month);
        results.push({ userId, success: true });
        console.log(`[CRON] Month-end initiated for user ${userId}`);
      } catch (error: any) {
        console.error(`[CRON] Error processing month-end for user ${userId}:`, error);
        results.push({ userId, success: false, error: error.message });
      }
    }

    res.json({
      success: true,
      year,
      month,
      usersProcessed: results.length,
      results,
    });
  } catch (error: any) {
    console.error('[CRON] Month-end cron error:', error);
    res.status(500).json({ error: error.message || 'Failed to process month-end' });
  }
});

export default router;
