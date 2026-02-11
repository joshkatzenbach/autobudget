# Slack Modal Patterns

## Slim `private_metadata` -- Reconstruct from DB

Slack enforces a **3,000 character limit** on the `private_metadata` field in modal views. This makes it unsafe to store large payloads like message block arrays, which grow with the number of budget categories.

### The pattern

When opening or updating Slack modals, only store **identifiers** in `private_metadata` -- never full block arrays or large objects. When you later need data from the original message, reconstruct it from the database.

**Store only what you can't derive:**
- `channel` -- needed to call `chat.update`
- `ts` -- message timestamp (acts as the message ID)
- `transactionId` -- to look up all other data from DB

**Do NOT store:**
- `blocks` -- the original message's block kit array (grows with category count)
- `text` -- can be reconstructed from transaction data

### Example

```typescript
// Good: slim metadata, well under 3000 chars
private_metadata: JSON.stringify({
  transactionId,
  messageInfo: { channel, ts }
})

// Bad: stores entire blocks array, will exceed limit with 10+ categories
private_metadata: JSON.stringify({
  transactionId,
  messageInfo: { channel, ts, blocks: payload.message.blocks, text: payload.message.text }
})
```

### When updating the original message after a modal flow completes

Fetch the data you need from the database and build blocks from scratch:

```typescript
const [txn] = await db.select({ merchantName, name, amount })
  .from(plaidTransactions)
  .where(eq(plaidTransactions.id, transactionId));

const updatedBlocks = [
  { type: 'section', text: { type: 'mrkdwn', text: `${merchant}\n${amount}` } },
  { type: 'context', elements: [{ type: 'mrkdwn', text: `Transaction ID: ${id}` }] },
  { type: 'section', text: { type: 'mrkdwn', text: '..confirmation..' } }
];

await slackClient.chat.update({ channel, ts, text: fallback, blocks: updatedBlocks });
```

### Where this is applied

- **Split transaction flow** (`backend/src/routes/slack.ts`): The split button opens a modal chain (num_splits -> split_transaction). Both modals carry `private_metadata` with only `{ transactionId, channel, ts }`. The final handler reconstructs the updated message from DB data.

## Modal Submission Response Patterns

For `view_submission` callbacks, use the HTTP response body to control the modal -- do NOT also call `views.update()` via the API. Doing both is redundant and can cause visual flickering.

```typescript
// Correct: use response_action in the HTTP response
return res.status(200).json({ response_action: 'update', view: newModal });

// Wrong: calling views.update() AND returning response_action
await slackClient.views.update({ view_id, view: newModal }); // redundant
return res.status(200).json({ response_action: 'update', view: newModal });
```

### Available `response_action` values

| Action | Effect |
|--------|--------|
| `clear` | Close the modal |
| `update` | Replace the current modal with a new view |
| `errors` | Show validation errors on specific fields |
| `push` | Push a new modal onto the stack |
