# Backend Setup Instructions

## 1. Create .env file

Create a `.env` file in the `backend` directory with the following content:

```
DATABASE_URL=postgresql://user:password@localhost:5432/autobudget
PORT=3000
NODE_ENV=development
SESSION_SECRET=your-secret-key-change-this-in-production
FRONTEND_URL=http://localhost:4200

# Plaid Configuration
PLAID_CLIENT_ID=your-plaid-client-id
PLAID_SECRET=your-plaid-secret
PLAID_ENV=sandbox
```

**Important:** Replace `user`, `password`, and `autobudget` with your actual PostgreSQL credentials and database name.

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

