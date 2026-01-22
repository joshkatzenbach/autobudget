# Month-End Processing Architecture

This document explains the month-end reconciliation system for AutoBudget, including how different account types work, the Slack notification flow, and the data model.

## Table of Contents
- [Account Types](#account-types)
- [Rollover Balances](#rollover-balances)
- [Month-End Flow](#month-end-flow)
- [Database Schema](#database-schema)
- [Slack Interaction](#slack-interaction)
- [Key Services](#key-services)

---

## Account Types

### Savings Accounts
- **Purpose**: Long-term savings goals (emergency fund, vacation, etc.)
- **Balance**: Tracked in `rolloverBalance` field
- **Monthly Behavior**:
  1. Monthly allotment is added to the balance at month-end
  2. Transactions during the month subtract from the balance in real-time
  3. Balance is visible on analytics page as a bar chart
- **Month-End**: No user interaction needed - balance is automatically updated

### Variable Accounts
- **Purpose**: Flexible spending categories (groceries, entertainment, etc.)
- **Rollover**: Each variable category has a rollover account for carrying forward surpluses
- **Monthly Behavior**:
  - Surplus: Can go to rollover, savings, or cover another category's deficit
  - Deficit: First covered by rollover, then user selects source via Slack

#### Surplus Handling (Variable)
1. If `autoSurplusDestination = 'rollover'`: Automatically add to this category's rollover
2. If `autoSurplusDestination = 'savings'`: Automatically move to `surplusTargetCategoryId`
3. If `autoSurplusDestination = null`: User is prompted via Slack to choose

#### Deficit Handling (Variable)
1. First, automatically deduct from the category's rollover balance
2. If rollover is insufficient, user is prompted via Slack with options:
   - Surplus from other variable categories
   - Rollover accounts from other categories
   - Savings accounts
3. If no money available, rollover goes negative

### Fixed Accounts
- **Purpose**: Recurring bills with consistent amounts (rent, utilities, etc.)
- **Rollover**: Similar to variable, but automatic and less visible
- **Monthly Behavior**:
  - Surplus: Automatically added to rollover (no user interaction)
  - Deficit: Automatically deducted from rollover
  - If rollover insufficient: User prompted via Slack to select savings account

---

## Rollover Balances

The `rolloverBalance` field on `budgetCategories` serves different purposes:

| Category Type | Purpose of rolloverBalance |
|--------------|---------------------------|
| savings | Total balance in the savings account |
| variable | Rollover balance (surplus carried forward) |
| fixed | Rollover balance (surplus from underspending) |
| surplus | Not used |
| excluded | Not used |

---

## Month-End Flow

The month-end process is orchestrated through a series of Slack messages:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Month-End Flow                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Process Fixed Categories (Automatic)                         │
│     └── Surplus → Rollover                                       │
│     └── Deficit → Deduct from Rollover                          │
│         └── If insufficient → Add to deficit queue               │
│                                                                  │
│  2. Process Variable Categories (Auto where configured)          │
│     └── Surplus (if auto) → Rollover or Savings                 │
│     └── Deficit → Deduct from Rollover                          │
│         └── If insufficient → Add to deficit queue               │
│                                                                  │
│  3. Process Savings Categories                                   │
│     └── Add monthly allotment to balance                        │
│                                                                  │
│  4. Send Deficit Messages (One at a time)                       │
│     └── Wait for user response before next                      │
│     └── User selects source to cover deficit                    │
│     └── If partial coverage, send updated message               │
│                                                                  │
│  5. Send Surplus Messages (One at a time)                       │
│     └── Skip if auto-destination configured                      │
│     └── User selects destination                                │
│                                                                  │
│  6. Send Summary Message                                        │
│     └── Total income, spent, surplus                            │
│     └── All variable categories with status                     │
│     └── All fixed bills (paid/deficit status)                   │
│     └── All savings (new totals)                                │
│     └── "Lock These Values In" button                           │
│                                                                  │
│  7. Lock Month (on button click)                                │
│     └── Create monthly snapshots for all categories             │
│     └── Mark month as completed                                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Database Schema

### Core Tables

#### `budgetCategories`
```sql
- id: Primary key
- budgetId: Foreign key to budgets
- name: Category name
- allocatedAmount: Monthly budget/contribution
- spentAmount: Current month spending (calculated)
- categoryType: 'fixed' | 'savings' | 'variable' | 'surplus' | 'excluded'
- rolloverBalance: Current rollover/savings balance
- autoSurplusDestination: 'rollover' | 'savings' | null
- surplusTargetCategoryId: Target for auto-surplus (savings category)
- color: Display color
- ... (other fields for tax, display options)
```

#### `monthlySnapshots`
Stores the final state of each category at month-end:
```sql
- id: Primary key
- userId, budgetId, categoryId: Foreign keys
- year, month: Time period
- allotment: Budget amount for the month
- spent: Total spent during the month
- surplusGiven: Amount given to other categories
- deficitReceived: Amount received from other categories
- finalRolloverBalance: Balance at month-end
- isLocked: Whether snapshot is finalized
```

#### `fundMovements`
Tracks all money transfers between categories:
```sql
- id: Primary key
- userId, budgetId: Foreign keys
- fromCategoryId, toCategoryId: Categories involved
- amount: Transfer amount
- transferType: 'surplus_to_savings' | 'surplus_to_rollover' | 'cover_deficit' | 'month_end_contribution'
- sourceType: 'surplus' | 'rollover' | 'savings'
- relatedCategoryId: The category this movement relates to
- isAutomatic: Whether auto-processed or user-selected
- month, year: Time period
- description: Human-readable description
```

#### `monthEndState`
Tracks progress through the month-end flow:
```sql
- id: Primary key
- userId, budgetId: Foreign keys
- year, month: Time period
- status: 'pending' | 'in_progress' | 'awaiting_input' | 'completed'
- currentStep: 'deficits' | 'fixed_deficits' | 'surpluses' | 'summary'
- pendingCategoryId: Category awaiting user input
- slackMessageTs, slackChannelId: Current message tracking
- processedCategories: JSON array of processed category IDs
- pendingTransfers: JSON array of pending transfers
```

---

## Slack Interaction

### Button Action IDs

| Action ID Pattern | Purpose |
|------------------|---------|
| `cover_deficit_{categoryId}` | Cover a deficit from this category |
| `surplus_to_rollover` | Move surplus to rollover |
| `surplus_to_{categoryId}` | Move surplus to savings category |
| `lock_month` | Finalize and lock the month |
| `transaction_correct` | Mark transaction categorization as correct |
| `transaction_category_{categoryId}` | Change transaction category |

### Button Value Formats

| Action Type | Value Format |
|-------------|--------------|
| Cover Deficit | `deficit_{deficitCategoryId}_{sourceCategoryId}_{sourceType}_{amount}_{year}_{month}` |
| Surplus Move | `surplus_{surplusCategoryId}_{destination}_{amount}_{year}_{month}` |
| Lock Month | `lock_{year}_{month}` |

---

## Key Services

### `month-end.ts`
Core month-end processing logic:
- `getMonthEndSummary()` - Calculate all category balances
- `processFixedCategoryAuto()` - Automatic fixed category processing
- `processVariableDeficitFromRollover()` - Auto-deduct from rollover
- `processVariableSurplusAuto()` - Auto-move surplus if configured
- `recordTransfer()` - Record fund movement
- `lockMonth()` - Create snapshots and finalize

### `slack-notifications.ts`
Slack message handling:
- `startMonthEndFlow()` - Initiate the month-end process
- `continueMonthEndFlow()` - Process next step after user input
- `sendDeficitNotification()` - Send deficit message with options
- `sendSurplusNotification()` - Send surplus message with options
- `sendSummaryMessage()` - Send final summary with lock button

### `routes/slack.ts`
Handles Slack interactive webhooks:
- Processes button clicks for deficit coverage
- Processes button clicks for surplus allocation
- Handles the "Lock Month" button

---

## Real-Time Balance Updates

### Savings Accounts
Savings balances update in real-time based on:
1. Previous month's locked snapshot (or initial balance)
2. Plus: This month's allotment
3. Minus: This month's transactions

This calculation is performed by `calculateSavingsBalance()` in `month-end.ts`.

### Variable/Fixed Rollover
Rollover balances are stored directly in `budgetCategories.rolloverBalance` and updated:
- At month-end when surplus is added
- At month-end when deficit is deducted
- When user makes a selection via Slack

---

## Future Considerations

1. **Cron Job**: The month-end flow should be triggered by a cron job on the 1st of each month
2. **Partial Deficit Coverage**: Messages update in place showing remaining balance
3. **Negative Rollover**: Categories can have negative rollover if no funds available
4. **Historical Data**: Monthly snapshots provide full audit trail of budget history

