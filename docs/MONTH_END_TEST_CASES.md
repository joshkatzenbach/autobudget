# Month-End Test Cases

Manual test procedure for month-end processing using the test harness.

## Setup

1. Log in to the Angular app and navigate to `http://localhost:4200/test-month-end` (hidden route, not linked from navigation)
2. Click **Reset to Test State** — verify the categories table shows all 11 categories with correct net positions

**Note:** The reset is fully self-contained. It deletes the user's existing budget (cascading all categories), then creates a fresh "Test Budget" via `createBudget` (which auto-creates Surplus/Excluded system categories). No pre-existing budget is required — a user with no budget at all can use the test harness.

### Expected Categories After Reset

| # | Name | Type | Allotted | Spent | Rollover | Net Position |
|---|------|------|----------|-------|----------|-------------|
| 1 | Groceries | variable | $400 | $450 | $0 | -$50 |
| 2 | Entertainment | variable | $200 | $500 | -$50 | -$350 |
| 3 | Subscriptions | variable | $50 | $120 | $0 | -$70 |
| 4 | Dining Out | variable | $300 | $100 | $30 | +$230 |
| 5 | Clothing | variable | $250 | $80 | $0 | +$170 |
| 6 | Personal Care | variable | $100 | $40 | $0 | +$60 |
| 7 | Transportation | variable | $100 | $100 | $0 | $0 |
| 8 | Rent | fixed | $1,500 | $1,600 | $0 | -$100 |
| 9 | Insurance | fixed | $200 | $180 | $50 | +$70 |
| 10 | Emergency Fund | savings | $500 | $0 | $500 | +$1,000 |
| 11 | Vacation Fund | savings | $200 | $0 | $200 | +$400 |

---

## Phase 1: Variable Deficits

Click **Start Month-End (Jan 2026)**. Check Slack for the first deficit message.

### TC1: Groceries (-$50)

**Expected Slack message:** Groceries is $50 over budget. Shows Set 1 buttons (variable surplus sources).

**Available sources (Set 1):** Dining Out (+$230), Clothing (+$170), Personal Care (+$60)

**Steps:**
1. Press **Dining Out** — transfers $50 from Dining Out surplus
2. Deficit fully covered — Groceries is resolved
3. Next deficit message appears automatically (Entertainment)

**Verify:** Dining Out's available surplus is now $180 ($230 - $50)

### TC2: Entertainment (-$350)

**Expected Slack message:** Entertainment is $350 over budget. Shows Set 1 buttons.

**Available sources (Set 1):** Dining Out (+$180 remaining), Clothing (+$170), Personal Care (+$60)

**Steps:**
1. Press **Dining Out** — transfers $180 (all remaining surplus). Remaining deficit: $170
2. Message updates with remaining deficit. Press **Clothing** — transfers $170. Remaining deficit: $0... wait, but Clothing has $170 of surplus and we need $170, so this exactly covers it.

**Alternative path (test partial + set skip):**
1. Press **Dining Out** — transfers $180. Remaining: $170
2. Press **Skip to next set** — advances to Set 2 (variable rollover). No rollover sources available (Dining Out rollover was $30 but is now reduced by surplus given).
3. Advances to Set 3 (savings). Press **Emergency Fund** — transfers $170.
4. Deficit fully covered.

**Choose the alternative path to exercise more code paths.**

### TC3: Subscriptions (-$70)

**Expected Slack message:** Subscriptions is $70 over budget.

**Available sources (Set 1):** Depends on TC2 choices. If Clothing surplus was not used in TC2, it shows here.

**Steps (testing "go into debt"):**
1. Press **Skip to next set** repeatedly until reaching Set 4
2. Press **Go into debt** — records a debt fund movement for $70
3. Subscriptions is resolved with negative rollover

---

## Phase 2: Fixed Deficits

After all variable deficits are resolved, the system advances to fixed deficits.

### TC4: Rent (-$100)

**Expected Slack message:** Rent is $100 over budget. Shows Set 3 buttons (savings — fixed categories skip Sets 1-2 since they can't pull from variable categories).

**Note:** Fixed deficits go straight to Set 3 (savings) or Set 4 (debt). The button set behavior depends on implementation — it starts at Set 1 but the available sources function returns empty for Sets 1-2 for fixed categories since fixed categories don't pull from variable surplus/rollover.

**Steps (option A — cover from savings):**
1. Press **Emergency Fund** — transfers $100
2. Rent deficit covered

**Steps (option B — go into debt):**
1. Skip to debt, press **Go into debt**

**Insurance (+$70):** Has positive net position — no deficit message. Auto-skipped.

---

## Phase 3: Variable Surpluses

After fixed deficits, the system processes variable surpluses.

### TC5: Dining Out (remaining surplus)

If Dining Out's surplus was partially or fully consumed in deficit phase, the remaining amount (if any) triggers a surplus message.

**Expected Slack message:** Dining Out has $X surplus. Choose where to send it.

**Options shown:** Savings categories (Emergency Fund, Vacation Fund) + "Keep as rollover"

**Steps:**
1. Press **Keep as rollover** (or pick a savings category)
2. Surplus resolved

### TC6: Clothing (auto-surplus)

Clothing has `autoSurplusDestination` set to Vacation Fund.

**Expected behavior:** No Slack message. Surplus auto-moves to Vacation Fund. Check logs for confirmation.

**Verify:** Click **Check Current State** — look for an automatic fund movement from Clothing to Vacation Fund.

### TC7: Personal Care (+$60)

**Expected Slack message:** Personal Care has $60 surplus (or remaining amount after deficit claims).

**Steps:**
1. Pick a savings category (e.g., Emergency Fund)
2. Surplus resolved

**Transportation ($0):** Even — no surplus message. Auto-skipped.

---

## Phase 4: Summary

### TC8: Verify Summary

After all surpluses are processed, the system creates snapshots and sends a summary.

**Expected:**
1. Summary message appears in Slack with all categories listed
2. Click **Check Current State** — verify:
   - `monthEndState` shows `status: 'completed'`, `phase: 'completed'`
   - `snapshots` array has entries for all non-system categories (9 categories)
   - Each snapshot has `isLocked: true`
   - `fundMovements` array contains all the movements made during the process

**Snapshot verification for each category:**
- `finalRolloverBalance` = previousRollover + allotment - spent - surplusGiven + deficitReceived
- Debt categories should have negative `finalRolloverBalance`
- Categories that kept surplus as rollover should have positive balance

---

## Alternate Test Runs

After completing the first run, click **Reset to Test State** and run again with different choices:

### Run 2: All Debt
- For every deficit, skip all sets and go into debt
- Verify all surpluses are still available (not consumed)
- Verify debt fund movements have `fromCategoryId: null` and `sourceType: 'debt'`

### Run 3: All Rollover
- Cover deficits from variable surplus where possible
- Keep all surpluses as rollover
- Verify `finalRolloverBalance` values are positive for surplus categories

### Run 4: Edge Cases
- Partially cover a deficit, then go into debt for the remainder
- Verify partial fund movement + debt movement both exist
- Check that remaining amount decrements correctly between button presses

---

## Cleanup

When testing is complete, the test files can be safely deleted:
- `ng-budget/src/app/components/test-month-end/` (entire directory)
- `backend/src/services/test-month-end-data.ts`
- `backend/src/routes/test-month-end.ts`
- `docs/MONTH_END_TEST_CASES.md`
- Remove the route registration line from `backend/src/server.ts`
- Remove the `test-month-end` route from `ng-budget/src/app/app.routes.ts`
