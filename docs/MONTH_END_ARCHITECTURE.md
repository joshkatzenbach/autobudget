# Month-End Processing Architecture

## Overview

Month-end processing runs on the 1st of each month via `POST /api/cron/month-end` (authenticated with `CRON_SECRET`). It processes the **previous** month by walking through each budget category, resolving deficits/surpluses via interactive Slack messages, then creating permanent monthly snapshots.

## Source of Truth

`monthlySnapshots.finalRolloverBalance` is the single source of truth for rollover balances. The old `budgetCategories.rolloverBalance` column has been removed. The helper `getRolloverBalance()` in `budgets.ts` queries the most recent snapshot for a category.

## Key Tables

- **`monthEndState`** — Tracks the current state of month-end processing per user/month. Fields: `phase`, `pendingCategoryId`, `remainingAmount`, `currentButtonSet`, `slackMessageTs`, `slackChannelId`, `processedCategories` (JSON array of IDs).
- **`monthlySnapshots`** — Permanent record for each category each month. Created at the end of the flow. Fields: `allotment`, `spent`, `surplusGiven`, `deficitReceived`, `finalRolloverBalance`, `isLocked`.
- **`fundMovements`** — Audit trail of every money movement during month-end. `sourceType` values: `variable_surplus`, `variable_rollover`, `savings_balance`, `debt`.

## Removed Tables

- `savingsSnapshots` — replaced by `monthlySnapshots`
- `monthlyCategorySummaries` — no longer needed (spending is computed at read time)

## State Machine Flow

```
variable_deficits → fixed_deficits → variable_surpluses → summary → completed
```

### Phase 1: Variable Deficits
For each variable category where `netPosition < 0` (previousRollover + allotment - spent):
1. Send Slack message with breakdown and buttons for ONE set at a time
2. User picks a source → `handleDeficitButtonPress()` records a `fundMovement`, updates remaining deficit
3. Partial coverage: message updates in-place with refreshed buttons
4. Button sets advance automatically when current set is exhausted:
   - **Set 1**: Variable category surplus (adjusted position > 0)
   - **Set 2**: Variable category rollover (from previous snapshots)
   - **Set 3**: Savings category balances (rollover + current month's allotment)
   - **Set 4**: "Go into debt" (always available)
5. User can skip sets or go into debt at any time

### Phase 2: Fixed Deficits
Same flow as variable deficits.

### Phase 3: Variable Surpluses
For each variable category with remaining surplus (adjusted for fund movements):
- If `autoSurplusDestination` is set → auto-move, record fund movement
- Otherwise → Slack message: "Keep as rollover" or move to a savings category

Fixed surpluses roll over automatically (handled by the snapshot formula).

### Phase 4: Summary
1. Create `monthlySnapshots` for ALL categories using: `finalRolloverBalance = previousRollover + allotment - spent - surplusGiven + deficitReceived`
2. Send summary Slack message
3. Mark `monthEndState` as completed

## Formulas

- **Net position** (initial assessment): `previousRollover + allotment - spent`
- **Adjusted position** (mid-flow): `previousRollover + allotment - spent + deficitReceived - surplusGiven` (from `fundMovements`)
- **Final snapshot**: Same adjusted formula — recorded permanently in `monthlySnapshots.finalRolloverBalance`

## Notification Blocking

During an active month-end (`monthEndState.status != 'completed'`), `sendTransactionNotification()` returns early, leaving `notificationSent = false`. After month-end completes, `flushDeferredNotifications()` (called from the Plaid webhook handler) sends any pending notifications on the next webhook arrival.

## Slack Interactive Handlers

All month-end button actions are handled in `routes/slack.ts` under the `action.action_id?.startsWith('month_end_')` block:
- `month_end_deficit_cover_*` → `handleDeficitButtonPress()`
- `month_end_skip_set` → advances `currentButtonSet`, updates message
- `month_end_go_into_debt` → `handleDebtButtonPress()`
- `month_end_surplus_rollover` / `month_end_surplus_move_*` → `handleSurplusButtonPress()`

User lookup uses `slackOAuth.teamId` matching `payload.user.team_id` (not `botUserId`).

## Key Files

- `backend/src/services/month-end.ts` — State machine, all core functions
- `backend/src/services/slack-notifications.ts` — `sendDeficitNotification()`, `updateDeficitMessage()`, `sendSurplusNotification()`, `sendMonthEndSummary()`, `flushDeferredNotifications()`
- `backend/src/routes/slack.ts` — Interactive button handlers
- `backend/src/routes/cron.ts` — Cron trigger endpoint
- `backend/src/services/budgets.ts` — `getRolloverBalance()` helper

## Edge Cases

- **First month**: No previous snapshot → `previousRollover = 0`
- **Server crash mid-flow**: `monthEndState` persists; next cron run detects `in_progress` and resumes
- **No Slack connected**: Auto-resolves deficits as debt, auto-advances surpluses
- **Category deleted mid-flow**: Skipped if no longer exists
- **Concurrent button presses**: State is re-read before processing; `pendingCategoryId` must match
