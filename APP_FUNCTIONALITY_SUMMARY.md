# AutoBudget Application - Complete Functionality Summary

## Overview

AutoBudget is a personal financial management application that helps users track spending, create budgets, and automatically categorize transactions from connected bank accounts. The app uses Plaid for bank account integration, OpenAI for intelligent transaction categorization, and Slack for transaction notifications and interactions.

## Architecture

### Tech Stack
- **Frontend**: Angular 20+ (standalone components, signals-based state management)
- **Backend**: Node.js with Express.js
- **Database**: PostgreSQL with Drizzle ORM
- **External Integrations**: 
  - Plaid API (bank account connections, transactions, balances)
  - OpenAI API (GPT-3.5-turbo for transaction categorization)
  - Slack API (notifications and interactive messaging)

### Project Structure
```
autobudget/
├── backend/          # Express.js API server
│   ├── src/
│   │   ├── db/      # Database schema and migrations
│   │   ├── routes/  # API route handlers
│   │   ├── services/ # Business logic
│   │   ├── middleware/ # Auth, validation, webhook verification
│   │   └── utils/   # Utilities (encryption, password validation)
│   └── drizzle/     # Database migrations
├── ng-budget/       # Angular frontend
│   └── src/app/
│       ├── components/ # UI components
│       ├── services/  # Frontend services
│       ├── models/    # TypeScript interfaces
│       └── guards/    # Route guards
└── Documentation files (this file, PLAID_AMOUNT_CONVENTION.md, etc.)
```

## Core Features

### 1. User Authentication
- **Registration**: Users can create accounts with email and password
- **Login**: Session-based authentication with JWT tokens
- **Password Security**: Strong password requirements using `zxcvbn`
- **Session Management**: Tokens stored in database with expiration
- **Route Protection**: Frontend guards and backend middleware protect authenticated routes

### 2. Budget Management
- **Single Budget Per User**: Each user has exactly one active budget (enforced at database level)
- **Monthly Budgets**: All budgets are monthly (no date range selection)
- **Income & Tax Calculation**: 
  - Users input monthly income
  - Tax calculation based on filing status (single, married-jointly, etc.)
  - Standard deductions and additional deductions supported
  - Effective tax rate calculated and stored
- **Budget Categories**: Four category types:
  - **Variable**: Flexible spending categories (e.g., groceries, entertainment)
  - **Expected**: Fixed bills with subcategories (e.g., utilities with electricity, internet subcategories)
  - **Savings**: Categories for saving money
  - **Surplus**: Automatically created, accumulates unallocated income
  - **Excluded**: System category for transfers and credit card payments (not counted in budget)
- **Category Features**:
  - Custom colors for visual organization
  - Allocated amounts (monthly spending goals)
  - Subcategories for Expected categories (e.g., "Utilities" → "Electricity", "Internet")
  - Buffer categories (can be reduced when other categories go over budget)
  - Buffer priority (order for automatic reduction)

### 3. Plaid Bank Account Integration
- **Account Connection**: Users connect bank accounts via Plaid Link
- **Products Used**: 
  - `Balance` - Current account balances
  - `Transactions` - Transaction history and webhooks
- **Account Management**:
  - View all connected accounts
  - Custom account naming (original name preserved in database)
  - Delete connected accounts (automatically revokes Plaid access tokens)
- **Balance Snapshot**: 
  - Shows net balance (assets - debts)
  - Breaks down by account type (depository, credit, loan, investment)
  - Displays assets and liabilities separately
- **Transaction Sync**:
  - Manual sync button on home page
  - Automatic sync via Plaid webhooks
  - Fetches transactions for current month based on budget date range
  - Handles pagination for large transaction sets

### 4. Transaction Management
- **Transaction Storage**: All transactions stored indefinitely in `plaid_transactions` table
- **Transaction Display**:
  - Shows 15 most recent transactions on home page
  - "Load More" button for pagination
  - Filter by review status (all, reviewed, unreviewed)
  - Displays: Date, Account, Merchant, Amount, Categories, Review Status
- **Transaction Amount Convention** (See `PLAID_AMOUNT_CONVENTION.md`):
  - **Plaid sends**: Positive = Outgoing, Negative = Incoming
  - **Display**: Outgoing shows as `$50.00` (no sign), Incoming shows as `+$100.00` (with + sign, green color)
- **Category Assignment**:
  - Automatic categorization using OpenAI GPT-3.5-turbo
  - Manual override via UI or Slack
  - Support for subcategories
  - Transaction review status tracking
- **Split Transactions**:
  - Split single transaction into multiple categories
  - Each split can have different category and subcategory
  - Amounts must sum to transaction total
  - Can split via UI modal or Slack modal
- **Transaction Review**:
  - `isReviewed` flag tracks if user has reviewed/categorized transaction
  - Automatically set to `true` when manually categorized
  - Can filter transactions by review status

### 5. Intelligent Transaction Categorization
- **OpenAI Integration**: Uses GPT-3.5-turbo (cheapest model) for categorization
- **Categorization Input**:
  - Transaction amount
  - Merchant name
  - Plaid category
  - Last 3 transactions from same vendor (with assigned categories)
  - User's manual overrides (stored in `transaction_category_overrides`)
  - Available budget categories and subcategories
- **Categorization Output**:
  - Category ID
  - Optional subcategory ID (if category has subcategories)
- **Override Storage**: User manual overrides stored for future LLM context
- **Automatic Categorization**:
  - Happens when new transactions arrive via webhook
  - Happens during manual sync
  - Happens for test transactions

### 6. Slack Integration
- **OAuth Flow**: Users connect Slack workspace via OAuth 2.0
- **Notification Channel**: Users select Slack users to create group DM for notifications
- **Transaction Notifications**:
  - Sent automatically when new transactions are categorized
  - Includes: Category, Merchant, Amount, Budget status (spent/allotted/percentage)
  - ASCII progress bar showing budget percentage (if ≤100%)
  - Red X emoji if over 100%
  - Push notification: `Merchant • $Amount • Category (Percentage%)`
- **Interactive Buttons**:
  - "Correct" button - marks transaction as reviewed
  - Category buttons - changes transaction category (alphabetically sorted)
  - Shows subcategories if category has them
  - "Split" button - opens modal to split transaction
- **Split Transaction Modal**:
  - Two-step flow: First asks for number of splits, then opens split modal
  - Last split automatically uses remaining amount
  - Validates amounts sum to transaction total
  - Updates original Slack message after successful split
- **Message History**: All Slack messages stored in `slack_messages` table
- **Webhook Endpoints**:
  - `/api/slack/events` - Receives Slack events (messages, mentions)
  - `/api/slack/interactive` - Handles button clicks and modal submissions
  - Both verify Slack signatures for security

### 7. Budget Analytics
- **Bar Chart Visualization**: 
  - Shows variable spending categories
  - Displays allotted amount (faded opacity) and spent amount (full opacity)
  - Bars overlap completely
  - Uses Chart.js library
- **Spending Calculations**: 
  - Calculated on-the-fly from transaction data
  - Uses absolute values for spending (handles both incoming and outgoing transactions)
  - Includes subcategory spending in category totals

### 8. Monthly Summaries
- **Automatic Summarization**: At end of month, spending per category summarized
- **Storage**: Stored in `monthly_category_summaries` table
- **Queryable**: Easy to query historical spending without accessing all transactions
- **Transaction Preservation**: Original transactions still accessible

### 9. Test Transaction Generation
- **Test Endpoint**: `/api/plaid/test/generate-transaction`
- **Purpose**: Simulates Plaid webhook for testing
- **Features**:
  - Generates random merchant from predefined list
  - Creates positive amount (outgoing transaction) between $10-$210
  - Automatically categorizes using LLM
  - Sends Slack notification
  - Returns transaction details

## Database Schema

### Core Tables
- **users**: User accounts (email, password hash, name, phone)
- **sessions**: Active user sessions (one per user, unique constraint)
- **budgets**: User budgets (one per user, unique constraint)
- **budget_categories**: Spending categories (variable, expected, savings, surplus, excluded)
- **budget_category_subcategories**: Subcategories for Expected categories
- **plaid_items**: Connected Plaid accounts (encrypted access tokens)
- **plaid_accounts**: Individual accounts within Plaid items (with custom names)
- **plaid_transactions**: All transactions from Plaid (stored indefinitely)
- **transaction_categories**: Category assignments for transactions (supports splits)
- **transaction_category_overrides**: User manual overrides for LLM context
- **monthly_category_summaries**: Aggregated monthly spending per category
- **slack_oauth**: Slack OAuth tokens and notification channel IDs (encrypted)
- **slack_messages**: Slack message history

### Key Relationships
- One user → One budget (enforced by unique constraint)
- One budget → Many categories
- One category → Many subcategories (for Expected type)
- One transaction → Many category assignments (for splits)
- One user → Many Plaid items (can connect multiple banks)
- One Plaid item → Many accounts
- One Plaid item → Many transactions

## API Endpoints

### Authentication (`/api/auth`)
- `POST /register` - Create new user account
- `POST /login` - Login and get session token

### Budgets (`/api/budgets`)
- `POST /` - Create budget (replaces existing if one exists)
- `GET /` - Get user's budget
- `PUT /` - Update budget
- `DELETE /` - Delete budget
- `POST /categories` - Create category
- `GET /categories` - Get all categories
- `GET /categories/:categoryId` - Get specific category
- `PUT /categories/:categoryId` - Update category
- `DELETE /categories/:categoryId` - Delete category
- `POST /categories/:categoryId/subcategories` - Create subcategory
- `GET /categories/:categoryId/subcategories` - Get subcategories
- `PUT /categories/:categoryId/subcategories/:subcategoryId` - Update subcategory
- `DELETE /categories/:categoryId/subcategories/:subcategoryId` - Delete subcategory
- `POST /categories/:categoryId/reduce-buffer` - Manually reduce buffer category

### Transactions (`/api/transactions`)
- `GET /` - Get transactions (supports `limit`, `offset`, `reviewed` query params)
- `POST /:transactionId/category` - Assign category to transaction
- `POST /:transactionId/split` - Split transaction into multiple categories
- `DELETE /:transactionId/categories/:categoryId` - Remove category assignment
- `GET /overrides` - Get user's category overrides
- `POST /sync` - Manually sync transactions from Plaid
- `POST /summaries/generate` - Generate monthly summaries
- `GET /summaries` - Get monthly summaries

### Plaid (`/api/plaid`)
- `POST /webhook` - Receive Plaid webhooks (public, signature verified)
- `POST /link/token` - Create Plaid Link token
- `POST /item/public_token/exchange` - Exchange public token for access token
- `GET /accounts` - Get connected accounts
- `PUT /accounts/:accountId/name` - Update custom account name
- `DELETE /item/:itemId` - Disconnect account (revokes Plaid token)
- `GET /balance-snapshot` - Get balance summary
- `POST /test/generate-transaction` - Generate test transaction

### Slack (`/api/slack`)
- `GET /oauth/authorize` - Initiate OAuth flow
- `GET /oauth/callback` - OAuth callback
- `POST /events` - Slack Events API webhook (public, signature verified)
- `POST /interactive` - Slack Interactive Components webhook (public, signature verified)
- `GET /messages` - Get message history
- `POST /send` - Send message to Slack
- `POST /channels/create` - Create Slack channel
- `GET /auth/test` - Test Slack authentication
- `GET /channels` - List Slack channels
- `GET /users` - List Slack users
- `POST /channels/:channelId/join` - Join Slack channel
- `POST /group-dm/create` - Create group DM
- `GET /integration/status` - Get Slack integration status
- `POST /integration/notifications` - Update notification settings

## Frontend Components

### Main Components
- **BudgetsComponent** (`/budgets`): Main dashboard with tabs:
  - **Summary Tab**: Budget overview, balance snapshot, recent transactions
  - **Transactions Tab**: Full transaction list with filtering and pagination
  - **Analytics Tab**: Bar chart visualization of spending
  - **Test Tab**: Generate test transactions
- **BudgetFormComponent** (`/budgets/edit`): Create/edit budget and categories
- **LoginComponent** (`/login`): User authentication
- **SlackIntegrationComponent** (`/settings/slack`): Slack setup and configuration
- **MessagingComponent** (`/messaging`): Slack messaging interface (testing)

### Key Features
- **Tab-based Navigation**: Sticky header with tabs
- **Reactive State**: Uses Angular Signals for state management
- **Transaction Editing**:
  - Inline category dropdowns
  - Modal for split transactions
  - Subcategory selection
  - Review status indicators
- **Account Management**: Custom account naming with edit functionality
- **Plaid Link**: Embedded Plaid Link component for account connection

## Security Features

### Authentication & Authorization
- JWT-based session tokens
- Password hashing with bcrypt
- Strong password requirements (zxcvbn)
- Route guards on frontend
- Authentication middleware on backend
- Session expiration and refresh

### Data Protection
- **Encryption**: AES-256-GCM encryption for:
  - Plaid access tokens
  - Slack OAuth tokens
- **Webhook Verification**:
  - Plaid webhook signature verification
  - Slack webhook signature verification
- **Security Headers**: Helmet middleware for security headers
- **Input Validation**: Request validation middleware
- **Request Size Limits**: 10MB limit on request bodies

### Database Security
- Parameterized queries (via Drizzle ORM)
- Foreign key constraints with cascade deletes
- Unique constraints to prevent duplicates
- Encrypted sensitive data (tokens)

## Important Conventions

### Plaid Amount Convention
**CRITICAL**: See `PLAID_AMOUNT_CONVENTION.md` for full details.

- **Plaid sends**: Positive = Outgoing (debits), Negative = Incoming (credits)
- **We store**: Exactly as Plaid sends (positive for outgoing, negative for incoming)
- **We display**: 
  - Outgoing: `$50.00` (no sign)
  - Incoming: `+$100.00` (with + sign, green color)
- **For calculations**: Use `ABS()` when summing spending amounts

### System Categories
- **Surplus**: Automatically created, cannot be deleted, accumulates unallocated income
- **Excluded**: Automatically created, cannot be deleted, for transfers/payments (not counted in budget)
- Both are filtered out of budget builder UI but appear in transaction dropdowns

### Transaction Review Status
- `isReviewed = false`: Transaction not yet reviewed by user
- `isReviewed = true`: User has categorized or confirmed transaction (via UI or Slack)

### Category Types
- **Variable**: Flexible spending (groceries, entertainment, etc.)
- **Expected**: Fixed bills with subcategories (utilities, subscriptions)
- **Savings**: Money being saved
- **Surplus**: System category (auto-created)
- **Excluded**: System category (auto-created, for transfers)

## Environment Variables

### Backend (.env)
- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - Secret for JWT tokens
- `ENCRYPTION_KEY` - 32-byte key for AES-256-GCM encryption
- `PLAID_CLIENT_ID` - Plaid client ID
- `PLAID_SECRET` - Plaid secret key
- `PLAID_ENV` - Plaid environment (production)
- `PLAID_WEBHOOK_SECRET` - Plaid webhook verification secret
- `OPENAI_API_KEY` - OpenAI API key
- `SLACK_CLIENT_ID` - Slack OAuth client ID
- `SLACK_CLIENT_SECRET` - Slack OAuth client secret
- `SLACK_SIGNING_SECRET` - Slack webhook signing secret
- `SLACK_REDIRECT_URI` - Slack OAuth redirect URI (must be HTTPS)
- `BASE_URL` - Base URL for the application (for OAuth redirects)
- `PORT` - Server port (default: 3000)

### Frontend (environment.ts)
- `API_URL` - Backend API URL

## Development Workflow

### Running the Application
```bash
# Run both frontend and backend
npm run both

# Or separately:
npm run backend  # Backend on port 3000
npm run frontend # Frontend on port 4200
```

### Database Migrations
```bash
cd backend
npm run db:generate  # Generate migration from schema changes
npm run db:migrate   # Apply migrations
npm run db:studio    # Open Drizzle Studio
```

### Testing
- Test transaction generation: Use "Generate Transaction" button in Test tab
- Slack integration: Requires ngrok for local HTTPS (Slack requires HTTPS for OAuth)
- Plaid webhooks: Requires ngrok for local development

## Key Files Reference

### Documentation
- `APP_FUNCTIONALITY_SUMMARY.md` (this file) - Complete app overview
- `PLAID_AMOUNT_CONVENTION.md` - Transaction amount handling convention
- `PLAID_TRANSACTIONS.md` - Plaid Transactions API details
- `SLACK_SETUP.md` - Slack integration setup guide
- `DATABASE_SETUP.md` - Database setup instructions
- `ENV_SETUP.md` - Environment variable setup

### Backend Core Files
- `backend/src/db/schema.ts` - Database schema definition
- `backend/src/server.ts` - Express server setup
- `backend/src/services/transactions.ts` - Transaction business logic
- `backend/src/services/categorization.ts` - OpenAI categorization logic
- `backend/src/services/slack-notifications.ts` - Slack notification logic
- `backend/src/services/plaid.ts` - Plaid API integration
- `backend/src/utils/encryption.ts` - Token encryption utilities

### Frontend Core Files
- `ng-budget/src/app/components/budgets/budgets.component.ts` - Main dashboard
- `ng-budget/src/app/components/budgets/budget-form.component.ts` - Budget editor
- `ng-budget/src/app/services/transaction.service.ts` - Transaction API service
- `ng-budget/src/app/services/budget.service.ts` - Budget API service

## Future Considerations

### Potential Enhancements
- Monthly summary generation automation (currently manual)
- Budget period changes (currently all monthly)
- Multi-budget support (currently single budget per user)
- Transaction search and filtering
- Export functionality (CSV, PDF)
- Mobile app
- Recurring transaction detection
- Budget alerts and notifications

### Known Limitations
- All budgets are monthly (no annual or custom periods)
- One budget per user (enforced at database level)
- Slack OAuth requires HTTPS (use ngrok for local development)
- Transaction categorization always calls LLM (no caching of common patterns)
- Monthly summaries must be manually generated

## Notes for AI Agents

1. **Always check `PLAID_AMOUNT_CONVENTION.md`** before working with transaction amounts
2. **System categories** (Surplus, Excluded) are auto-created and protected from deletion
3. **Single budget per user** is enforced - check existing budget before creating new one
4. **Encryption** is used for Plaid and Slack tokens - use `encrypt()` and `decrypt()` utilities
5. **Webhook verification** is critical - always verify signatures for Plaid and Slack webhooks
6. **Transaction review status** is automatically set when user manually categorizes
7. **Split transactions** store amounts as positive values in `transaction_categories` table
8. **Spending calculations** use `ABS()` to handle both incoming and outgoing transactions
9. **Slack modals** require immediate acknowledgment (within 3 seconds) before processing
10. **Test transactions** should always be positive (outgoing) amounts



