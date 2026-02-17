import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { resetToTestState } from '../services/test-month-end-data';
import { initiateMonthEnd } from '../services/month-end';
import { db } from '../db';
import { monthEndState, fundMovements, monthlySnapshots } from '../db/schema';
import { eq, and } from 'drizzle-orm';

const router = Router();

// ── API Endpoints ────────────────────────────────────────────────────────────

router.post('/reset', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const result = await resetToTestState(req.userId!);
    res.json({ success: true, ...result });
  } catch (error: any) {
    console.error('[TEST] Reset error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/start', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    await initiateMonthEnd(req.userId!, 2026, 1);
    res.json({ success: true, message: 'Month-end initiated for January 2026. Check Slack.' });
  } catch (error: any) {
    console.error('[TEST] Start error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/state', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;

    const states = await db
      .select()
      .from(monthEndState)
      .where(eq(monthEndState.userId, userId));

    const movements = await db
      .select()
      .from(fundMovements)
      .where(eq(fundMovements.userId, userId));

    const snapshots = await db
      .select()
      .from(monthlySnapshots)
      .where(and(
        eq(monthlySnapshots.userId, userId),
        eq(monthlySnapshots.year, 2026),
        eq(monthlySnapshots.month, 1),
      ));

    res.json({ monthEndState: states, fundMovements: movements, snapshots });
  } catch (error: any) {
    console.error('[TEST] State error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
