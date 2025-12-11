# Backend Setup Instructions

## 1. Create .env file

Create a `.env` file in the `backend` directory with the following content:

```
DATABASE_URL=postgresql://user:password@localhost:5432/autobudget
PORT=3000
NODE_ENV=development
SESSION_SECRET=your-secret-key-change-this-in-production
FRONTEND_URL=http://localhost:4200

# Encryption Key (for encrypting Plaid access tokens)
# Generate a secure 32-byte hex key using: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=your-64-character-hex-encoded-encryption-key-here

# Plaid Configuration
PLAID_CLIENT_ID=your-plaid-client-id
PLAID_SECRET=your-plaid-secret
PLAID_ENV=sandbox
PLAID_WEBHOOK_VERIFICATION_KEY=your-plaid-webhook-verification-key
```

**Important:** 
- Replace `user`, `password`, and `autobudget` with your actual PostgreSQL credentials and database name.
- Generate a secure encryption key for `ENCRYPTION_KEY`. You can generate one using:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
  This will output a 64-character hex string that you should use as your `ENCRYPTION_KEY`. **Keep this key secure and never commit it to version control.**
- **Plaid Webhook Verification Key**: Get this from your Plaid Dashboard under Webhooks settings. This key is used to verify that webhook requests are actually from Plaid. **Required in production.**

## 2. Install dependencies

```bash
cd backend
npm install
```

## 3. Create the database

Make sure PostgreSQL is running and create the database:

```bash
createdb autobudget
```

Or using psql:
```bash
psql -U postgres
CREATE DATABASE autobudget;
```

## 4. Run migrations

```bash
npm run db:generate
npm run db:migrate
```

## 5. Start the backend

```bash
npm run dev
```

The backend should now be running on http://localhost:3000

## Troubleshooting

- **"Cannot connect to server"**: Make sure PostgreSQL is running
- **"Database does not exist"**: Create the database first (step 3)
- **"Connection refused"**: Check your DATABASE_URL in .env file

