import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import {
  createBudget,
  getUserBudget,
  getBudgetById,
  updateBudget,
  deleteBudget,
  createBudgetCategory,
  getBudgetCategories,
  getBudgetCategoryById,
  updateBudgetCategory,
  deleteBudgetCategory,
} from '../services/budgets';

// Helper to get budget ID from user ID
async function getUserBudgetId(userId: number): Promise<number | null> {
  const budget = await getUserBudget(userId);
  return budget?.id || null;
}

const router = Router();

// All budget routes require authentication
router.use(authenticateToken);

// Budget CRUD endpoints
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { name, startDate, endDate, income, taxRate, filingStatus, deductions } = req.body;

    if (!name || !startDate || !endDate || !income) {
      return res.status(400).json({ error: 'Name, startDate, endDate, and income are required' });
    }

    const budget = await createBudget(
      req.userId!,
      name,
      startDate,
      endDate,
      income,
      taxRate,
      filingStatus,
      deductions
    );

    res.status(201).json(budget);
  } catch (error: any) {
    console.error('Create budget error:', error);
    const errorMessage = error.message || 'Failed to create budget';
    const statusCode = error.message?.includes('already has a budget') ? 409 : 500;
    res.status(statusCode).json({ error: errorMessage });
  }
});

// Get user's single budget
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const budget = await getUserBudget(req.userId!);
    res.json(budget); // Returns Budget | null
  } catch (error) {
    console.error('Get budget error:', error);
    res.status(500).json({ error: 'Failed to fetch budget' });
  }
});

// Update user's budget
router.put('/', async (req: AuthRequest, res: Response) => {
  try {
    const { name, startDate, endDate, income, taxRate, filingStatus, deductions, isActive } = req.body;

    const budget = await updateBudget(req.userId!, {
      name,
      startDate,
      endDate,
      income,
      taxRate,
      filingStatus,
      deductions,
      isActive,
    });

    if (!budget) {
      return res.status(404).json({ error: 'Budget not found' });
    }

    res.json(budget);
  } catch (error) {
    console.error('Update budget error:', error);
    res.status(500).json({ error: 'Failed to update budget' });
  }
});

// Delete user's budget
router.delete('/', async (req: AuthRequest, res: Response) => {
  try {
    await deleteBudget(req.userId!);
    res.status(204).send();
  } catch (error) {
    console.error('Delete budget error:', error);
    res.status(500).json({ error: 'Failed to delete budget' });
  }
});

// Budget Category endpoints (no budgetId in URL - uses user's budget automatically)
router.post('/categories', async (req: AuthRequest, res: Response) => {
  try {
    const {
      name,
      allocatedAmount,
      categoryType,
      color,
      // Variable category fields
      autoSurplusDestination,
      // Fixed category fields
      expectedMerchantName,
      hideFromTransactionLists,
      // Savings category fields
      isTaxDeductible,
      isSubjectToFica,
      isUnconnectedAccount,
    } = req.body;

    if (!name || !allocatedAmount) {
      return res.status(400).json({ error: 'Name and allocatedAmount are required' });
    }

    const category = await createBudgetCategory(
      req.userId!,
      name,
      allocatedAmount,
      categoryType,
      color,
      autoSurplusDestination,
      expectedMerchantName,
      hideFromTransactionLists,
      isTaxDeductible,
      isSubjectToFica,
      isUnconnectedAccount
    );
    res.status(201).json(category);
  } catch (error: any) {
    console.error('Create category error:', error);
    if (error.message?.includes('Surplus') || error.message?.includes('does not have')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to create category' });
  }
});

router.get('/categories', async (req: AuthRequest, res: Response) => {
  try {
    const categories = await getBudgetCategories(req.userId!);

    if (categories === null) {
      return res.status(404).json({ error: 'Budget not found' });
    }

    res.json(categories);
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

router.get('/categories/:categoryId', async (req: AuthRequest, res: Response) => {
  try {
    const categoryId = parseInt(req.params.categoryId);
    
    if (isNaN(categoryId)) {
      return res.status(400).json({ error: 'Invalid category ID' });
    }

    const category = await getBudgetCategoryById(categoryId, req.userId!);

    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.json(category);
  } catch (error) {
    console.error('Get category error:', error);
    res.status(500).json({ error: 'Failed to fetch category' });
  }
});

router.put('/categories/:categoryId', async (req: AuthRequest, res: Response) => {
  try {
    const categoryId = parseInt(req.params.categoryId);
    
    if (isNaN(categoryId)) {
      return res.status(400).json({ error: 'Invalid category ID' });
    }

    const {
      name,
      allocatedAmount,
      categoryType,
      color,
      // Variable category fields
      autoSurplusDestination,
      // Fixed category fields
      expectedMerchantName,
      hideFromTransactionLists,
      // Savings category fields
      isTaxDeductible,
      isSubjectToFica,
      isUnconnectedAccount,
    } = req.body;

    const category = await updateBudgetCategory(categoryId, req.userId!, {
      name,
      allocatedAmount,
      categoryType,
      color,
      autoSurplusDestination,
      expectedMerchantName,
      hideFromTransactionLists,
      isTaxDeductible,
      isSubjectToFica,
      isUnconnectedAccount,
    });


    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.json(category);
  } catch (error: any) {
    console.error('Update category error:', error);
    if (error.message?.includes('Surplus') || error.message?.includes('Cannot')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to update category' });
  }
});

router.delete('/categories/:categoryId', async (req: AuthRequest, res: Response) => {
  try {
    const categoryId = parseInt(req.params.categoryId);
    
    if (isNaN(categoryId)) {
      return res.status(400).json({ error: 'Invalid category ID' });
    }

    const deleted = await deleteBudgetCategory(categoryId, req.userId!);

    if (!deleted) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.status(204).send();
  } catch (error: any) {
    console.error('Delete category error:', error);
    if (error.message?.includes('Surplus') || error.message?.includes('cannot')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

// Get monthly snapshots (replaces savings-snapshots and provides data for analytics)
router.get('/monthly-snapshots', async (req: AuthRequest, res: Response) => {
  try {
    const { monthlySnapshots } = await import('../db/schema');
    const { eq, and, desc } = await import('drizzle-orm');
    const { db } = await import('../db');

    const budgetId = await getUserBudgetId(req.userId!);
    if (!budgetId) {
      return res.status(404).json({ error: 'Budget not found' });
    }

    const categoryId = req.query.categoryId ? parseInt(req.query.categoryId as string) : undefined;

    let conditions = [
      eq(monthlySnapshots.userId, req.userId!),
      eq(monthlySnapshots.budgetId, budgetId)
    ];

    if (categoryId) {
      conditions.push(eq(monthlySnapshots.categoryId, categoryId));
    }

    const snapshots = await db
      .select()
      .from(monthlySnapshots)
      .where(and(...conditions))
      .orderBy(desc(monthlySnapshots.year), desc(monthlySnapshots.month));

    res.json(snapshots);
  } catch (error: any) {
    console.error('Get monthly snapshots error:', error);
    res.status(500).json({ error: 'Failed to get monthly snapshots' });
  }
});

// Get fund movements
router.get('/fund-movements', async (req: AuthRequest, res: Response) => {
  try {
    const { fundMovements } = await import('../db/schema');
    const { eq, and, desc } = await import('drizzle-orm');
    const { db } = await import('../db');

    const budgetId = await getUserBudgetId(req.userId!);
    if (!budgetId) {
      return res.status(404).json({ error: 'Budget not found' });
    }

    const movements = await db
      .select()
      .from(fundMovements)
      .where(and(
        eq(fundMovements.userId, req.userId!),
        eq(fundMovements.budgetId, budgetId)
      ))
      .orderBy(desc(fundMovements.year), desc(fundMovements.month), desc(fundMovements.createdAt));

    res.json(movements);
  } catch (error: any) {
    console.error('Get fund movements error:', error);
    res.status(500).json({ error: 'Failed to get fund movements' });
  }
});

export default router;

