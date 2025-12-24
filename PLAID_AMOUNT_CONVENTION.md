# Plaid Transaction Amount Convention

## Overview

This document describes how Plaid represents transaction amounts and how we handle them throughout the application.

## Plaid's Convention

**Plaid's transaction amount convention:**
- **Positive amounts** = Outgoing transactions (debits, expenses, money going out)
- **Negative amounts** = Incoming transactions (credits, income, money coming in)

### Examples

- A $50.00 purchase at a store → Plaid sends: `50.00` (positive)
- A $100.00 paycheck deposit → Plaid sends: `-100.00` (negative)
- A $25.00 bill payment → Plaid sends: `25.00` (positive)
- A $500.00 transfer received → Plaid sends: `-500.00` (negative)

## How We Store It

We store transaction amounts **exactly as Plaid sends them** in the `plaid_transactions.amount` column:
- Outgoing transactions: stored as positive decimal strings (e.g., `"50.00"`)
- Incoming transactions: stored as negative decimal strings (e.g., `"-100.00"`)

## How We Display It

### Frontend Display

In the UI (`budgets.component.ts`):

```typescript
formatTransactionAmount(amount: string | number): string {
  const numAmount = this.parseAmount(amount);
  // Plaid convention: positive = debits (outgoing), negative = credits (incoming)
  // Outgoing money: show as positive (no sign)
  // Incoming money: show with + sign
  if (numAmount > 0) {
    // Outgoing transaction (positive/debit) - show as positive number (no sign)
    return this.formatCurrency(numAmount);
  } else {
    // Incoming transaction (negative/credit) - show with + sign
    return `+${this.formatCurrency(Math.abs(numAmount))}`;
  }
}

isIncomingTransaction(amount: string | number): boolean {
  return this.parseAmount(amount) < 0;
}
```

**Display Rules:**
- Outgoing transactions (positive in DB): Display as `$50.00` (no sign, normal color)
- Incoming transactions (negative in DB): Display as `+$100.00` (with + sign, green color)

### Slack Messages

In Slack notifications (`slack-notifications.ts`):

```typescript
// Format amount following the same paradigm as frontend:
// Plaid convention: positive = debits (outgoing), negative = credits (incoming)
// Outgoing money: show as positive (no sign)
// Incoming money: show with + sign
const rawAmount = parseFloat(transaction.amount);
const isIncoming = rawAmount < 0;
const displayAmount = rawAmount > 0 ? rawAmount : Math.abs(rawAmount);
const amountDisplay = isIncoming ? `+$${displayAmount.toFixed(2)}` : `$${displayAmount.toFixed(2)}`;
```

**Slack Display Rules:**
- Outgoing transactions: `$50.00` (no sign)
- Incoming transactions: `+$100.00` (with + sign)

## Spending Calculations

When calculating spending for budget categories, we use `ABS()` in SQL queries because:

1. **Transaction amounts** in `plaid_transactions` can be positive (outgoing) or negative (incoming)
2. **Split amounts** in `transaction_categories` are stored as **positive values** (the portion assigned to each category)
3. We want to count **all spending** regardless of whether it's from an outgoing or incoming transaction

Example SQL:
```sql
SUM(ABS(CAST(transaction_categories.amount AS NUMERIC)))
```

This ensures we correctly sum spending amounts regardless of the sign of the original transaction.

## Split Transaction Validation

When validating split transactions, we compare the absolute value of the transaction amount with the sum of split amounts:

```typescript
const totalAmount = parseFloat(transaction[0].amount);
const splitTotal = splits.reduce((sum, split) => sum + parseFloat(split.amount), 0);

// Compare absolute values: Plaid convention is positive = outgoing, negative = incoming
// Split amounts are stored as positive (the portion assigned to each category)
// So we compare the absolute value of the transaction amount with the sum of split amounts
if (Math.abs(Math.abs(totalAmount) - splitTotal) > 0.01) {
  throw new Error(`Split amounts (${splitTotal}) must equal transaction total (${Math.abs(totalAmount)})`);
}
```

## Test Transaction Generation

When generating test transactions, we create **positive amounts** to represent outgoing transactions:

```typescript
// Generate positive amount for debits (money going out) - matches Plaid's convention
// Plaid convention: positive = outgoing (debits), negative = incoming (credits)
// Amount between $10-$210, stored as positive string (e.g., "123.45")
const testAmount = (Math.random() * 200 + 10).toFixed(2);
```

## Important Notes

1. **Never assume** that negative = outgoing or positive = incoming. Plaid's convention is the opposite of what might be intuitive.

2. **Always check the sign** when determining if a transaction is incoming or outgoing:
   - `amount > 0` → Outgoing (debit, expense)
   - `amount < 0` → Incoming (credit, income)

3. **For display purposes**, we normalize to show:
   - Outgoing: positive number without sign
   - Incoming: positive number with + sign

4. **For calculations**, use `Math.abs()` when you need the absolute value, but be aware of the context (spending vs. income).

## Files That Handle This Convention

- `ng-budget/src/app/components/budgets/budgets.component.ts` - Frontend display logic
- `backend/src/services/slack-notifications.ts` - Slack message formatting
- `backend/src/services/transactions.ts` - Split validation and spending calculations
- `backend/src/routes/plaid.ts` - Test transaction generation
- `backend/src/services/budgets.ts` - Budget spending calculations

## Migration Notes

This convention was updated on [Date] after discovering that Plaid's actual behavior is:
- Positive = Outgoing (debits)
- Negative = Incoming (credits)

Previously, the code assumed the opposite convention, which caused incorrect display of transaction amounts.



