# Slack Integration Setup Guide

## Required Environment Variables

Add these to your `backend/.env` file:

### 1. SLACK_CLIENT_ID
- **What it is**: Your Slack App's Client ID
- **Where to find it**: 
  1. Go to https://api.slack.com/apps
  2. Select your app (or create a new one)
  3. Go to "Basic Information" → "App Credentials"
  4. Copy the "Client ID"
- **Example**: `1234567890.1234567890123`

### 2. SLACK_CLIENT_SECRET
- **What it is**: Your Slack App's Client Secret (used for OAuth token exchange)
- **Where to find it**: 
  1. Same location as Client ID
  2. In "Basic Information" → "App Credentials"
  3. Click "Show" next to "Client Secret" and copy it
- **Example**: `abcdef1234567890abcdef1234567890`
- **Security**: Keep this secret! Never commit it to version control.

### 3. SLACK_SIGNING_SECRET
- **What it is**: Secret used to verify webhook requests are from Slack
- **Where to find it**: 
  1. In your Slack app settings
  2. Go to "Basic Information" → "App Credentials"
  3. Copy the "Signing Secret"
- **Example**: `1234567890abcdef1234567890abcdef`
- **Security**: Keep this secret! Never commit it to version control.

### 4. SLACK_REDIRECT_URI (Optional)
- **What it is**: The OAuth callback URL
- **Default**: `http://localhost:3000/api/slack/oauth/callback`
- **For production**: Set to your production URL (e.g., `https://api.yourdomain.com/api/slack/oauth/callback`)
- **Important**: Must match exactly what you configure in Slack app settings

## Slack App Configuration Steps

### 1. Create a Slack App
1. Go to https://api.slack.com/apps
2. Click "Create New App"
3. Choose "From scratch"
4. Name your app (e.g., "AutoBudget")
5. Select your workspace

### 2. Configure OAuth & Permissions
1. Go to "OAuth & Permissions" in the sidebar
2. Under "Redirect URLs", add:
   - Development: `http://localhost:3000/api/slack/oauth/callback`
   - Production: `https://yourdomain.com/api/slack/oauth/callback`
3. Under "Scopes" → "Bot Token Scopes", add:
   - `chat:write` - Send messages
   - `channels:manage` - Create and manage channels
   - `channels:join` - Join public channels (required for joining channels)
   - `channels:read` - View channel information
   - `channels:history` - View channel message history
   - `groups:read` - View private channel information
   - `groups:history` - View private channel message history
   - `im:write` - Send direct messages
   - `im:read` - View direct message information
   - `im:history` - View direct message history
   - `mpim:write` - Create and manage group DMs (required for notification group DMs)
   - `mpim:read` - View group DM information
   - `users:read` - View user information
4. Under "Scopes" → "User Token Scopes" (if needed):
   - Add any user-specific scopes if your app needs them

### 3. Configure OAuth & Redirect URI
1. Go to "OAuth & Permissions" in the sidebar
2. Under "Redirect URLs", add:
   - **Development (with ngrok)**: `https://your-ngrok-url.ngrok.io/api/slack/oauth/callback`
   - **Production**: `https://api.yourdomain.com/api/slack/oauth/callback`
   - **Note**: Slack requires HTTPS for redirect URIs (except localhost in some cases). For local development, use ngrok.

### 4. Configure Event Subscriptions (for webhooks)
1. Go to "Event Subscriptions" in the sidebar
2. Enable Events
3. Set "Request URL" to:
   - Development: `https://your-ngrok-url.ngrok.io/api/slack/events`
   - Production: `https://api.yourdomain.com/api/slack/events`
4. Under "Subscribe to bot events", add:
   - `message.channels` - Messages in public channels
   - `message.groups` - Messages in private channels
   - `message.im` - Direct messages
   - `app_mention` - When your bot is mentioned
5. Save changes

### 5. Configure Interactive Components (for buttons/modals)
1. Go to "Interactivity & Shortcuts" in the sidebar
2. Enable Interactivity
3. Set "Request URL" to:
   - Development: `https://your-ngrok-url.ngrok.io/api/slack/interactive`
   - Production: `https://yourdomain.com/api/slack/interactive`
4. Save changes

### 6. Make App Publicly Installable (Optional - for production)

If you want anyone to be able to install your app in their workspace:

1. Go to "Manage Distribution" in the sidebar
2. Under "Share Your App with Other Workspaces":
   - Enable "Public Distribution" if you want it listed in the Slack App Directory
   - Or keep it as "Link to Share" to allow installation via direct link
3. Copy the "Add to Slack" button URL or use the OAuth flow in your app

**Note**: The current OAuth flow in your app already supports workspace installation. Users can click "Install Slack App in Workspace" in your app, which will:
1. Redirect them to Slack's OAuth page
2. Ask them to select their workspace
3. Request permission to install the app
4. Redirect back to your app with the access token

### 7. Test Installation (Development)

For testing, you can manually install:
1. Go to "Install App" in the sidebar
2. Click "Install to Workspace"
3. Review permissions and click "Allow"
4. You'll be redirected back to your app with an OAuth token

## Testing Locally with ngrok

**Important**: Slack requires HTTPS for OAuth redirect URIs. For local development, you must use ngrok.

1. Install ngrok: https://ngrok.com/download
2. Start your backend: `npm run dev` (runs on port 3000)
3. In another terminal, run: `ngrok http 3000`
4. Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`)
5. Update your `.env` file:
   ```env
   SLACK_REDIRECT_URI=https://abc123.ngrok.io/api/slack/oauth/callback
   BASE_URL=https://abc123.ngrok.io
   ```
6. Update your Slack app settings:
   - **OAuth & Permissions** → Redirect URLs: Add `https://abc123.ngrok.io/api/slack/oauth/callback`
   - **Event Subscriptions** → Request URL: `https://abc123.ngrok.io/api/slack/events`
   - **Interactivity & Shortcuts** → Request URL: `https://abc123.ngrok.io/api/slack/interactive`
7. Restart your backend server after updating `.env`

## Environment Variables Summary

```env
# Required
SLACK_CLIENT_ID=your-client-id-here
SLACK_CLIENT_SECRET=your-client-secret-here
SLACK_SIGNING_SECRET=your-signing-secret-here

# Optional (has default)
SLACK_REDIRECT_URI=http://localhost:3000/api/slack/oauth/callback
```

## Verification

After setting up, you can test the integration:
1. Use the frontend UI to connect your Slack account
2. Send a test message to a channel
3. Create a test channel
4. Check that webhooks are receiving events

