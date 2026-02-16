# Slack Notification Update on Category Reassignment

## Overview

When a transaction notification is sent to Slack, it displays the auto-categorized category name (bolded), merchant, amount, and spending stats (spent/allotted/percentage). If the user clicks a different category button to reassign the transaction, the message is updated in-place with the **new** category's stats.

## Message Format

Initial notification structure (mrkdwn):

```
*Category Name*
Merchant Name
$XX.XX
$XX.XX / $YY.YY (Z.Z%)
```

- Line 1: Bolded category name
- Line 2: Merchant name
- Line 3: Transaction amount
- Line 4 (optional): Spending stats — only shown when the category has an allotted amount > 0

No progress bar is shown. The stats line is sufficient context for budget tracking.

## Reassignment Flow

1. User clicks a category button on the Slack message
2. `assignTransactionCategory()` updates the DB
3. The handler parses the existing message's first section block to extract merchant and amount (lines 1-2 after the category name)
4. It queries the user's active budget, then calls `getCategorySpendingStats()` for the **new** category
5. A new first section block is built with: new bolded category name, same merchant, same amount, new stats
6. Context blocks (e.g., transaction ID) are preserved
7. Action blocks (buttons) are stripped
8. A confirmation section is appended: `✓ *Category updated to:* New Category`
9. `chat.update()` replaces the original message

## Key Implementation Details

- **Parsing existing message**: The handler splits the first section block's text by `\n` to extract merchant (index 1) and amount (index 2). This is reliable because the message format is controlled by `sendTransactionNotification()`.
- **Stats are always fresh**: `getCategorySpendingStats()` recalculates from the DB at query time, so the updated message reflects the reassignment.
- **Fallback text**: Updated to a concise format for push notification previews.

## Files

- `backend/src/services/slack-notifications.ts` — `getCategorySpendingStats()`, `sendTransactionNotification()` (builds initial message)
- `backend/src/routes/slack.ts` — category button handler (rebuilds message on reassignment)
