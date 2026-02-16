# Slack Notification Channel Setup

## DM vs Group DM

`createGroupDM` in `backend/src/services/slack.ts` wraps `conversations.open`. Despite the name, it supports both:

- **1 user ID** -- Opens a 1:1 DM between the bot and that user
- **2-8 user IDs** -- Opens a group DM including the bot and all listed users

There is no minimum of 2 users; Slack's API natively handles both cases.

## User Filtering in `/api/slack/users`

The GET `/api/slack/users` endpoint (`backend/src/routes/slack.ts`) filters out users that would cause `conversations.open` to return `contains_invalid_user`:

| Filtered User | Reason |
|---------------|--------|
| `USLACKBOT` | Slack's built-in Slackbot does **not** have `is_bot: true`, so frontend `is_bot` filtering misses it. Cannot be added to DMs. |
| Bot's own user ID | The bot is implicitly included by `conversations.open`; passing it explicitly causes errors. Looked up via `getUserOAuth().botUserId`. |

The frontend already filters `is_bot` and `is_deleted` users, so the backend filtering is a second layer for edge cases the frontend can't catch.
