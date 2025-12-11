# PostgreSQL Database Setup Guide

## Option 1: Install PostgreSQL with Homebrew (Recommended for macOS)

### 1. Install PostgreSQL
```bash
brew install postgresql@16
```

Or if you prefer the latest version:
```bash
brew install postgresql
```

### 2. Start PostgreSQL service
```bash
brew services start postgresql@16
```

Or for the latest version:
```bash
brew services start postgresql
```

### 3. Verify PostgreSQL is running
```bash
brew services list | grep postgresql
```

You should see it listed as "started".

### 4. Create the database
```bash
createdb autobudget
```

If that doesn't work, try:
```bash
psql postgres
```

Then in the psql prompt:
```sql
CREATE DATABASE autobudget;
\q
```

### 5. Test the connection
```bash
psql autobudget
```

If you can connect, type `\q` to exit.

---

## Option 2: Install PostgreSQL with Postgres.app (Easier GUI option)

### 1. Download and install
- Download from: https://postgresapp.com/
- Install the app
- Open Postgres.app from Applications

### 2. Initialize a new server
- Click "Initialize" if prompted
- The server will start automatically

### 3. Create the database
- Click the "Postgres" menu → "Open psql"
- Or use Terminal:
```bash
/Applications/Postgres.app/Contents/Versions/latest/bin/createdb autobudget
```

---

## Option 3: Use Docker (If you have Docker installed)

### 1. Run PostgreSQL in a container
```bash
docker run --name autobudget-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=autobudget \
  -p 5432:5432 \
  -d postgres:16
```

### 2. The database will be created automatically
- Username: `postgres`
- Password: `postgres`
- Database: `autobudget`
- Port: `5432`

---

## After Installation: Update Your .env File

Once PostgreSQL is running, update `backend/.env`:

```bash
cd backend
```

Edit the `.env` file and update the `DATABASE_URL`:

**For Homebrew/Postgres.app (default user is your macOS username):**
```
DATABASE_URL=postgresql://YOUR_MACOS_USERNAME@localhost:5432/autobudget
```

**For Docker:**
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/autobudget
```

**If you set a password:**
```
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/autobudget
```

---

## Verify Everything Works

1. **Check PostgreSQL is running:**
   ```bash
   psql -l
   ```
   Should list your databases.

2. **Test connection with your DATABASE_URL:**
   ```bash
   cd backend
   npm run db:migrate
   ```
   This should run successfully if everything is set up correctly.

---

## Troubleshooting

- **"command not found: psql"**: Add PostgreSQL to your PATH or use the full path
- **"connection refused"**: Make sure PostgreSQL service is running (`brew services start postgresql`)
- **"database does not exist"**: Run `createdb autobudget`
- **"password authentication failed"**: Check your DATABASE_URL in `.env`

