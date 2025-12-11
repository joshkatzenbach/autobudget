# AutoBudget Backend

Backend API for the AutoBudget personal financial application.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```

3. Update `.env` with your PostgreSQL connection string:
```
DATABASE_URL=postgresql://user:password@localhost:5432/autobudget
```

4. Generate and run database migrations:
```bash
npm run db:generate
npm run db:migrate
```

5. Start the development server:
```bash
npm run dev
```

The server will run on `http://localhost:3000` (or the port specified in `.env`).

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register a new user
- `POST /api/auth/login` - Login user

### Budgets
- `GET /api/budgets` - Get all budgets for authenticated user
- `GET /api/budgets/:id` - Get a specific budget
- `POST /api/budgets` - Create a new budget
- `PUT /api/budgets/:id` - Update a budget
- `DELETE /api/budgets/:id` - Delete a budget

### Budget Categories
- `GET /api/budgets/:budgetId/categories` - Get all categories for a budget
- `GET /api/budgets/:budgetId/categories/:categoryId` - Get a specific category
- `POST /api/budgets/:budgetId/categories` - Create a new category
- `PUT /api/budgets/:budgetId/categories/:categoryId` - Update a category
- `DELETE /api/budgets/:budgetId/categories/:categoryId` - Delete a category

All budget endpoints require authentication via Bearer token in the Authorization header.

## Database Migrations

- Generate migration: `npm run db:generate`
- Run migrations: `npm run db:migrate`
- Open Drizzle Studio: `npm run db:studio`

