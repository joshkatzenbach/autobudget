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
  createBudgetCategorySubcategory,
  getBudgetCategorySubcategories,
  updateBudgetCategorySubcategory,
  deleteBudgetCategorySubcategory,
  reduceBufferCategories,
} from '../services/budgets';

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
  } catch (error) {
    console.error('Create budget error:', error);
    res.status(500).json({ error: 'Failed to create budget' });
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
      accumulatedTotal,
      estimationMonths,
      isBufferCategory,
      bufferPriority,
      color,
    } = req.body;

    if (!name || !allocatedAmount) {
      return res.status(400).json({ error: 'Name and allocatedAmount are required' });
    }

    const category = await createBudgetCategory(
      req.userId!,
      name,
      allocatedAmount,
      categoryType,
      accumulatedTotal,
      estimationMonths,
      isBufferCategory,
      bufferPriority,
      color
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
      spentAmount,
      categoryType,
      accumulatedTotal,
      estimationMonths,
      isBufferCategory,
      bufferPriority,
      color,
    } = req.body;

    const category = await updateBudgetCategory(categoryId, req.userId!, {
      name,
      allocatedAmount,
      spentAmount,
      categoryType,
      accumulatedTotal,
      estimationMonths,
      isBufferCategory,
      bufferPriority,
      color,
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

// Budget Category Subcategory endpoints (no budgetId in URL)
router.post('/categories/:categoryId/subcategories', async (req: AuthRequest, res: Response) => {
  try {
    const categoryId = parseInt(req.params.categoryId);
    
    if (isNaN(categoryId)) {
      return res.status(400).json({ error: 'Invalid category ID' });
    }

    const { name, expectedAmount, useEstimation, estimationMonths } = req.body;

    if (!name || !expectedAmount) {
      return res.status(400).json({ error: 'Name and expectedAmount are required' });
    }

    const subcategory = await createBudgetCategorySubcategory(
      categoryId,
      req.userId!,
      name,
      expectedAmount,
      useEstimation,
      estimationMonths
    );

    if (!subcategory) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.status(201).json(subcategory);
  } catch (error: any) {
    console.error('Create subcategory error:', error);
    if (error.message?.includes('Only Expected')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to create subcategory' });
  }
});

router.get('/categories/:categoryId/subcategories', async (req: AuthRequest, res: Response) => {
  try {
    const categoryId = parseInt(req.params.categoryId);
    
    if (isNaN(categoryId)) {
      return res.status(400).json({ error: 'Invalid category ID' });
    }

    const subcategories = await getBudgetCategorySubcategories(categoryId, req.userId!);

    if (subcategories === null) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.json(subcategories);
  } catch (error) {
    console.error('Get subcategories error:', error);
    res.status(500).json({ error: 'Failed to fetch subcategories' });
  }
});

router.put('/categories/:categoryId/subcategories/:subcategoryId', async (req: AuthRequest, res: Response) => {
  try {
    const categoryId = parseInt(req.params.categoryId);
    const subcategoryId = parseInt(req.params.subcategoryId);
    
    if (isNaN(categoryId) || isNaN(subcategoryId)) {
      return res.status(400).json({ error: 'Invalid category or subcategory ID' });
    }

    const { name, expectedAmount, actualAmount, billDate, useEstimation, estimationMonths } = req.body;

    const subcategory = await updateBudgetCategorySubcategory(
      subcategoryId,
      categoryId,
      req.userId!,
      {
        name,
        expectedAmount,
        actualAmount,
        billDate,
        useEstimation,
        estimationMonths,
      }
    );

    if (!subcategory) {
      return res.status(404).json({ error: 'Subcategory not found' });
    }

    res.json(subcategory);
  } catch (error) {
    console.error('Update subcategory error:', error);
    res.status(500).json({ error: 'Failed to update subcategory' });
  }
});

router.delete('/categories/:categoryId/subcategories/:subcategoryId', async (req: AuthRequest, res: Response) => {
  try {
    const categoryId = parseInt(req.params.categoryId);
    const subcategoryId = parseInt(req.params.subcategoryId);
    
    if (isNaN(categoryId) || isNaN(subcategoryId)) {
      return res.status(400).json({ error: 'Invalid category or subcategory ID' });
    }

    const deleted = await deleteBudgetCategorySubcategory(subcategoryId, categoryId, req.userId!);

    if (!deleted) {
      return res.status(404).json({ error: 'Subcategory not found' });
    }

    res.status(204).send();
  } catch (error) {
    console.error('Delete subcategory error:', error);
    res.status(500).json({ error: 'Failed to delete subcategory' });
  }
});

// Buffer reduction endpoint
router.post('/categories/:categoryId/reduce-buffer', async (req: AuthRequest, res: Response) => {
  try {
    const categoryId = parseInt(req.params.categoryId);
    
    if (isNaN(categoryId)) {
      return res.status(400).json({ error: 'Invalid category ID' });
    }

    const { overageAmount } = req.body;

    if (!overageAmount || overageAmount <= 0) {
      return res.status(400).json({ error: 'Valid overageAmount is required' });
    }

    const result = await reduceBufferCategories(req.userId!, overageAmount);

    if (!result) {
      return res.status(404).json({ error: 'Budget not found' });
    }

    res.json(result);
  } catch (error) {
    console.error('Reduce buffer error:', error);
    res.status(500).json({ error: 'Failed to reduce buffer categories' });
  }
});

export default router;

