# Deployment Guide

This guide walks you through deploying AutoBudget to Firebase (frontend) and Railway (backend + database) from a single GitHub repository.

## Architecture

- **Frontend (Angular)**: Deployed on Firebase Hosting
- **Backend (Express/Node.js)**: Deployed on Railway
- **Database (PostgreSQL)**: Provisioned on Railway

## Prerequisites

1. GitHub account and repository
2. Firebase account (free tier available)
3. Railway account (free tier available)
4. Firebase CLI installed: `npm install -g firebase-tools`

## Step 1: Push to GitHub

### 1.1 Initialize Git (if not already done)

```bash
cd /Users/joshkatzenbach/apps/autobudget
git add .
git commit -m "Prepare for deployment"
```

### 1.2 Create GitHub Repository

1. Go to [GitHub](https://github.com) and create a new repository
2. Name it `autobudget` (or your preferred name)
3. **Do NOT** initialize with README, .gitignore, or license (we already have these)

### 1.3 Push to GitHub

```bash
git remote add origin https://github.com/YOUR_USERNAME/autobudget.git
git branch -M main
git push -u origin main
```

Replace `YOUR_USERNAME` with your GitHub username.

## Step 2: Deploy Backend to Railway

### 2.1 Create Railway Project

1. Go to [Railway](https://railway.app) and sign in with GitHub
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Choose your `autobudget` repository
5. Railway will detect the repository and create a service

### 2.1.1 Configure Service Root Directory ⚠️ CRITICAL STEP

**This step is REQUIRED - Railway will fail without it!**

Since this is a monorepo, you **MUST** set the root directory before Railway can build:

1. In your Railway project, click on the service that was just created
2. Go to the **Settings** tab (gear icon)
3. Scroll down to **Root Directory**
4. Click the input field and set it to: `/backend`
5. Click **Save** or press Enter
6. **Important**: After saving, you may need to trigger a new deployment for the change to take effect
7. Railway will now use `backend/railway.toml` and look for `backend/package.json`

**Why this is needed:**
- Railpack needs to see `package.json` directly in the root directory it's building from
- Without setting root directory, Railway looks at the repo root and finds the wrong `package.json` (which has no start script)
- The error "Missing script: start" means it's looking at the root `package.json` instead of `backend/package.json`
- There is NO root `railway.toml` file - only `backend/railway.toml` exists, so Railway must use the backend directory

**After setting root directory, Railpack will automatically:**
- Detect Node.js 20 from `backend/package.json` engines field (`"node": ">=20.19.0"`)
- Or from `.nvmrc` file in backend directory
- Run `npm install` in the backend directory
- Run `npm run build` (from backend/package.json scripts)
- Use `npm start` to start the service (from backend/package.json which has `"start": "node dist/server.js"`)

**If you still get "Missing script: start" error:**
- Double-check that Root Directory is set to exactly `/backend` (with the leading slash)
- Make sure you saved the settings
- Trigger a new deployment (Railway → Deployments → Redeploy, or push a new commit)

### 2.2 Configure Environment Variables

In your Railway project, go to **Variables** and add:

```
NODE_ENV=production
PORT=3000
# Note: Node.js version is auto-detected by Railpack from package.json engines
DATABASE_URL=<Railway will auto-provision this>
SESSION_SECRET=<generate a secure random string>
ENCRYPTION_KEY=<64-character hex string - see backend/ENV_SETUP.md>
PLAID_CLIENT_ID=<your-plaid-client-id>
PLAID_SECRET=<your-plaid-secret>
PLAID_ENV=production
PLAID_WEBHOOK_VERIFICATION_KEY=<your-plaid-webhook-key>
SLACK_CLIENT_ID=<your-slack-client-id>
SLACK_CLIENT_SECRET=<your-slack-client-secret>
SLACK_SIGNING_SECRET=<your-slack-signing-secret>
SLACK_REDIRECT_URI=https://<your-railway-url>/api/slack/oauth/callback
BASE_URL=https://<your-railway-url>
FRONTEND_URL=https://<your-firebase-url>.web.app,https://<your-firebase-url>.firebaseapp.com
```

**Important Notes:**
- Railway will automatically provision a PostgreSQL database and set `DATABASE_URL`
- Generate `SESSION_SECRET` and `ENCRYPTION_KEY` using secure methods
- Update `FRONTEND_URL` after you deploy to Firebase (Step 3)
- Update `SLACK_REDIRECT_URI` and `BASE_URL` with your Railway URL after deployment

### 2.3 Add PostgreSQL Database

1. In your Railway project, click "New" → "Database" → "Add PostgreSQL"
2. Railway will automatically set the `DATABASE_URL` environment variable
3. The database will be provisioned automatically

### 2.4 Run Database Migrations

After the backend deploys, you need to run migrations:

1. In Railway, go to your backend service
2. Click on the service → "Settings" → "Deploy Logs"
3. You can run migrations using Railway's CLI or by adding a one-time command:

```bash
# Using Railway CLI (install: npm i -g @railway/cli)
railway run --service backend "cd backend && npm run db:migrate"
```

Or add a migration script to your Railway project that runs on first deploy.

### 2.5 Get Your Railway URL

After deployment, Railway will provide a URL like:
`https://your-app-name.up.railway.app`

**Save this URL** - you'll need it for:
- Frontend environment configuration
- Slack OAuth redirect URI
- CORS configuration

## Step 3: Deploy Frontend to Firebase

### 3.1 Initialize Firebase

```bash
cd ng-budget
firebase login
firebase init
```

When prompted:
- Select **Hosting** (press Space to select, then Enter)
- Choose **Create a new project** or **Use an existing project**
  - If creating new: Enter a project name (e.g., `autobudget-frontend`)
  - If using existing: Select your project from the list
- **Public directory**: `dist/ng-budget/browser`
- **Single-page app**: Yes (type `y` and press Enter)
- **Overwrite index.html**: No (type `n` and press Enter - we already have firebase.json configured)

Firebase will automatically create/update `.firebaserc` with your project ID.

### 3.3 Update Frontend Environment

Edit `ng-budget/src/environments/environment.prod.ts` and update the `apiUrl`:

```typescript
export const environment = {
  production: true,
  apiUrl: 'https://your-railway-backend-url.up.railway.app/api'
};
```

Replace `your-railway-backend-url.up.railway.app` with your actual Railway URL.

### 3.4 Build and Deploy

```bash
# Build the Angular app
npm run build

# Deploy to Firebase
firebase deploy
```

### 3.5 Get Your Firebase URL

After deployment, Firebase will provide a URL like:
`https://your-project-id.web.app` or `https://your-project-id.firebaseapp.com`

**Save this URL** - you'll need it to update Railway's `FRONTEND_URL` environment variable.

## Step 4: Update Backend CORS Configuration

Go back to Railway and update the `FRONTEND_URL` environment variable:

```
FRONTEND_URL=https://your-project-id.web.app,https://your-project-id.firebaseapp.com
```

Railway will automatically redeploy with the new CORS settings.

## Step 5: Update Slack OAuth Settings

1. Go to [Slack API Apps](https://api.slack.com/apps)
2. Select your app
3. Go to **OAuth & Permissions**
4. Update **Redirect URLs** to include:
   - `https://your-railway-url.up.railway.app/api/slack/oauth/callback`
5. Save changes

## Step 6: Set Up Continuous Deployment

### Railway (Backend)
- Railway automatically deploys when you push to the `main` branch
- No additional configuration needed

### Firebase (Frontend)
Firebase can also auto-deploy from GitHub:

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project → **Hosting**
3. Click **Get started** with GitHub (if not already connected)
4. Connect your repository
5. Configure:
   - **Root directory**: `ng-budget`
   - **Build command**: `npm install && npm run build`
   - **Output directory**: `dist/ng-budget/browser`

## Troubleshooting

### Backend Issues

- **Database connection errors**: Check that `DATABASE_URL` is set correctly in Railway
- **CORS errors**: Verify `FRONTEND_URL` includes your Firebase URLs
- **Migrations not running**: Run migrations manually using Railway CLI

### Frontend Issues

- **API connection errors**: Verify `apiUrl` in `environment.prod.ts` matches your Railway URL
- **Build errors**: Check that all dependencies are in `package.json`

### General

- **Environment variables**: Make sure all required variables are set in Railway
- **Logs**: Check Railway logs for backend errors, Firebase hosting logs for frontend issues

## Updating the Application

### Backend Changes
1. Make changes locally
2. Commit and push to GitHub
3. Railway automatically deploys

### Frontend Changes
1. Make changes locally
2. Update `environment.prod.ts` if API URL changed
3. Commit and push to GitHub
4. Firebase auto-deploys (if configured) or run `firebase deploy` manually

## Cost Considerations

- **Firebase Hosting**: Free tier includes 10GB storage, 360MB/day transfer
- **Railway**: Free tier includes $5/month credit (usually enough for small apps)
- **PostgreSQL on Railway**: Included in Railway pricing

## Security Notes

- Never commit `.env` files or sensitive keys
- Use Railway's environment variables for all secrets
- Keep `ENCRYPTION_KEY` and `SESSION_SECRET` secure
- Regularly rotate API keys and secrets
