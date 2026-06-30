import { db } from '../db';
import {
  budgetCategories,
  budgets,
  fundMovements,
  monthlySnapshots,
  monthEndState,
  plaidItems,
  plaidTransactions,
  transactionCategories,
} from '../db/schema';
import { eq, inArray } from 'drizzle-orm';
import { getUserBudget, createBudget } from './budgets';

// ── Test Category Definitions ────────────────────────────────────────────────

interface TestCategory {
  name: string;
  categoryType: 'variable' | 'fixed' | 'savings';
  allocatedAmount: string;
  rollover: number; // December 2025 finalRolloverBalance
  autoSurplusDestination?: string; // set after insert (needs vacation fund ID)
  transactions: { merchantName: string; name: string; amount: string; date: string }[];
}

const TEST_CATEGORIES: TestCategory[] = [
  // Variable categories
  {
    name: 'Groceries',
    categoryType: 'variable',
    allocatedAmount: '400.00',
    rollover: 0,
    transactions: [
      { merchantName: 'Whole Foods', name: 'Whole Foods Market', amount: '-225.00', date: '2026-01-05' },
      { merchantName: "Trader Joe's", name: "Trader Joe's #123", amount: '-125.00', date: '2026-01-12' },
      { merchantName: 'Safeway', name: 'Safeway Store #456', amount: '-100.00', date: '2026-01-20' },
    ],
  },
  {
    name: 'Entertainment',
    categoryType: 'variable',
    allocatedAmount: '200.00',
    rollover: -50, // negative rollover from prior month
    transactions: [
      { merchantName: 'AMC Theatres', name: 'AMC Theatres #14', amount: '-85.00', date: '2026-01-03' },
      { merchantName: 'Ticketmaster', name: 'Ticketmaster Event', amount: '-250.00', date: '2026-01-10' },
      { merchantName: 'Spotify', name: 'Spotify Premium', amount: '-15.00', date: '2026-01-15' },
      { merchantName: 'Steam', name: 'Steam Game Purchase', amount: '-150.00', date: '2026-01-22' },
    ],
  },
  {
    name: 'Subscriptions',
    categoryType: 'variable',
    allocatedAmount: '50.00',
    rollover: 0,
    transactions: [
      { merchantName: 'Netflix', name: 'Netflix Monthly', amount: '-22.99', date: '2026-01-01' },
      { merchantName: 'Hulu', name: 'Hulu Subscription', amount: '-17.99', date: '2026-01-01' },
      { merchantName: 'YouTube', name: 'YouTube Premium', amount: '-13.99', date: '2026-01-01' },
      { merchantName: 'Adobe', name: 'Adobe Creative Cloud', amount: '-65.03', date: '2026-01-15' },
    ],
  },
  {
    name: 'Dining Out',
    categoryType: 'variable',
    allocatedAmount: '300.00',
    rollover: 30,
    transactions: [
      { merchantName: 'Chipotle', name: 'Chipotle Mexican Grill', amount: '-45.00', date: '2026-01-07' },
      { merchantName: 'Starbucks', name: 'Starbucks Coffee', amount: '-25.00', date: '2026-01-14' },
      { merchantName: 'Olive Garden', name: 'Olive Garden Restaurant', amount: '-30.00', date: '2026-01-21' },
    ],
  },
  {
    name: 'Clothing',
    categoryType: 'variable',
    allocatedAmount: '250.00',
    rollover: 0,
    autoSurplusDestination: '__VACATION_FUND__', // placeholder, resolved after insert
    transactions: [
      { merchantName: 'H&M', name: 'H&M Store', amount: '-50.00', date: '2026-01-08' },
      { merchantName: 'Target', name: 'Target Clothing', amount: '-30.00', date: '2026-01-18' },
    ],
  },
  {
    name: 'Personal Care',
    categoryType: 'variable',
    allocatedAmount: '100.00',
    rollover: 0,
    transactions: [
      { merchantName: 'CVS Pharmacy', name: 'CVS Pharmacy #789', amount: '-25.00', date: '2026-01-06' },
      { merchantName: 'Great Clips', name: 'Great Clips Haircut', amount: '-15.00', date: '2026-01-16' },
    ],
  },
  {
    name: 'Transportation',
    categoryType: 'variable',
    allocatedAmount: '100.00',
    rollover: 0,
    transactions: [
      { merchantName: 'Shell', name: 'Shell Gas Station', amount: '-55.00', date: '2026-01-09' },
      { merchantName: 'Chevron', name: 'Chevron Gas', amount: '-45.00', date: '2026-01-23' },
    ],
  },
  // Fixed categories
  {
    name: 'Rent',
    categoryType: 'fixed',
    allocatedAmount: '1500.00',
    rollover: 0,
    transactions: [
      { merchantName: 'Property Management Co', name: 'Monthly Rent Payment', amount: '-1600.00', date: '2026-01-01' },
    ],
  },
  {
    name: 'Insurance',
    categoryType: 'fixed',
    allocatedAmount: '200.00',
    rollover: 50,
    transactions: [
      { merchantName: 'State Farm', name: 'State Farm Insurance', amount: '-180.00', date: '2026-01-15' },
    ],
  },
  // Savings categories
  {
    name: 'Emergency Fund',
    categoryType: 'savings',
    allocatedAmount: '500.00',
    rollover: 500,
    transactions: [],
  },
  {
    name: 'Vacation Fund',
    categoryType: 'savings',
    allocatedAmount: '200.00',
    rollover: 200,
    transactions: [],
  },
];

// ── Reset Logic ──────────────────────────────────────────────────────────────

export async function resetToTestState(userId: number) {
  // 1. Delete user-scoped rows that don't cascade from the budget
  await db.delete(monthEndState).where(eq(monthEndState.userId, userId));
  await db.delete(fundMovements).where(eq(fundMovements.userId, userId));

  const userTxns = await db
    .select({ id: plaidTransactions.id })
    .from(plaidTransactions)
    .where(eq(plaidTransactions.userId, userId));
  const txnIds = userTxns.map(t => t.id);

  if (txnIds.length > 0) {
    await db.delete(transactionCategories).where(inArray(transactionCategories.transactionId, txnIds));
  }

  await db.delete(plaidTransactions).where(eq(plaidTransactions.userId, userId));
  await db.delete(plaidItems).where(eq(plaidItems.userId, userId));
  await db.delete(monthlySnapshots).where(eq(monthlySnapshots.userId, userId));

  // 2. Delete existing budget (cascades budgetCategories) and create a fresh one
  const existingBudget = await getUserBudget(userId);
  if (existingBudget) {
    await db.delete(budgets).where(eq(budgets.id, existingBudget.id));
  }

  const newBudget = await createBudget(userId, 'Test Budget', '2026-01-01', '2026-01-31', '5000');
  const budgetId = newBudget.id;

  // 3. Create a test plaid item for transactions to reference
  const timestamp = Date.now();
  const [testItem] = await db.insert(plaidItems).values({
    userId,
    itemId: `test-item-${timestamp}`,
    accessToken: 'test-access-token',
    institutionName: 'Test Bank',
  }).returning({ id: plaidItems.id });
  const testItemId = testItem.id;

  // 4. Insert test categories
  const categoryIdMap: Record<string, number> = {};

  for (const cat of TEST_CATEGORIES) {
    const [inserted] = await db.insert(budgetCategories).values({
      budgetId,
      name: cat.name,
      allocatedAmount: cat.allocatedAmount,
      categoryType: cat.categoryType,
    }).returning({ id: budgetCategories.id });

    categoryIdMap[cat.name] = inserted.id;
  }

  // 3. Set Clothing's autoSurplusDestination to Vacation Fund's ID
  const vacationFundId = categoryIdMap['Vacation Fund'];
  await db
    .update(budgetCategories)
    .set({ autoSurplusDestination: String(vacationFundId) })
    .where(eq(budgetCategories.id, categoryIdMap['Clothing']));

  // 4. Insert fake plaidTransactions and transactionCategories
  for (const cat of TEST_CATEGORIES) {
    const categoryId = categoryIdMap[cat.name];
    for (let i = 0; i < cat.transactions.length; i++) {
      const txn = cat.transactions[i];
      const [insertedTxn] = await db.insert(plaidTransactions).values({
        userId,
        itemId: testItemId,
        accountId: 'test-account-001',
        transactionId: `test-${cat.name.toLowerCase().replace(/\s+/g, '-')}-${i}-${timestamp}`,
        amount: txn.amount,
        merchantName: txn.merchantName,
        name: txn.name,
        date: txn.date,
        isReviewed: true,
        notificationSent: true,
      }).returning({ id: plaidTransactions.id });

      await db.insert(transactionCategories).values({
        transactionId: insertedTxn.id,
        categoryId,
        amount: txn.amount,
        isManual: true,
      });
    }
  }

  // 5. Insert December 2025 snapshots for categories with non-zero rollover
  for (const cat of TEST_CATEGORIES) {
    if (cat.rollover !== 0) {
      const categoryId = categoryIdMap[cat.name];
      await db.insert(monthlySnapshots).values({
        userId,
        budgetId,
        categoryId,
        year: 2025,
        month: 12,
        allotment: cat.allocatedAmount,
        spent: '0.00',
        surplusGiven: '0.00',
        deficitReceived: '0.00',
        finalRolloverBalance: cat.rollover.toFixed(2),
        isLocked: true,
      });
    }
  }

  // 6. Build summary for response
  const summary = TEST_CATEGORIES.map(cat => {
    const spent = cat.transactions.reduce((sum, t) => sum + Math.abs(parseFloat(t.amount)), 0);
    const allotted = parseFloat(cat.allocatedAmount);
    const netPosition = cat.rollover + allotted - spent;
    return {
      id: categoryIdMap[cat.name],
      name: cat.name,
      type: cat.categoryType,
      allotted,
      spent,
      rollover: cat.rollover,
      netPosition: Math.round(netPosition * 100) / 100,
    };
  });

  return { budgetId, categories: summary };
}
