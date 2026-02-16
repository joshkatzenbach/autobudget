# Slack Disconnect/Reconnect Pattern

## Overview

Users can disconnect their Slack workspace via the Settings > Slack Integration page. This allows switching to a different workspace or re-authorizing the same one.

## Disconnect Flow

1. User clicks "Disconnect" button in the connected state UI
2. Browser shows a `confirm()` dialog explaining that unreviewed notifications will be re-sent
3. Frontend calls `DELETE /api/slack/oauth`
4. Backend:
   - **Revokes the Slack token** via `auth.revoke` API (best-effort, errors are swallowed)
   - **Resets `notificationSent`** to `false` for all unreviewed transactions (`isReviewed = false AND notificationSent = true`) so they will be re-notified when a new workspace is connected
   - **Deletes the `slackOAuth` row** for the user
5. Frontend reloads integration status, showing the disconnected state with the "Add to Slack" button

## Why Reset `notificationSent`?

When a user disconnects, their notification channel is destroyed. Any transactions that were notified but not yet reviewed would be lost — the user would never see them in Slack again. By resetting `notificationSent`, the next webhook sync after reconnecting will re-send notifications for those unreviewed transactions.

Only unreviewed transactions are reset. Reviewed transactions are already handled and don't need re-notification.

## Reconnect

After disconnecting, the user can click "Add to Slack" to go through the standard OAuth flow again. This can be the same workspace or a different one. The `storeOAuthTokens` function handles both insert (new) and update (existing) cases via upsert logic.

## Removed: `slack_messages` Table

The `slack_messages` table was removed as dead code. It stored inbound/outbound Slack messages but was never queried or displayed anywhere in the app. The table, its service (`slack-messages.ts`), and all references were removed in the same change. Migration `0006_drop_slack_messages.sql` drops the table.
