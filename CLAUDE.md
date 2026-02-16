# AutoBudget -- Claude Code Guidelines

## Project Structure

- `backend/` -- Express.js + TypeScript API (PostgreSQL via Drizzle ORM)
- `ng-budget/` -- Angular frontend
- `docs/` -- Paradigms, patterns, and architectural decisions

## Documentation Rules

After every successful implementation or fix, **always** update or create the relevant markdown file(s) in `docs/`. The goal is twofold:

1. **Help future Claude sessions** quickly understand how the app works, why decisions were made, and what patterns exist — so context doesn't have to be re-derived each time.
2. **Help the developer** understand and recall the app's architecture, strategies, and reasoning over time.

Documentation should cover:

- **Paradigms & patterns** -- Recurring approaches used across the codebase (e.g., how pending-to-posted transactions are handled, how Slack modals reconstruct state from DB)
- **Strategies & reasoning** -- Why a particular approach was chosen over alternatives, trade-offs considered, and edge cases accounted for
- **Organization** -- How code is structured, where responsibilities live, and how data flows between layers (Plaid -> backend -> Slack, etc.)
- **Conventions** -- Naming, data formats, amount signing, error handling patterns, etc.

If a fix introduces a new pattern or changes an existing one, document it. If an existing doc becomes stale due to a change, update it. Each doc should be self-contained enough that reading it gives full context without needing to read the source code first.

## Key Docs

- `docs/SLACK_MODAL_PATTERNS.md` -- Slack modal private_metadata limits, reconstruction-from-DB pattern, response_action usage
- `docs/PENDING_TO_POSTED_PATTERN.md` -- How pending-to-posted transaction transitions are handled without duplicate notifications
- `SLACK_SETUP.md` -- Slack app configuration, OAuth scopes, webhook URLs
- `PLAID_AMOUNT_CONVENTION.md` -- How Plaid amounts are signed and displayed
- `DEPLOYMENT.md` -- Firebase (frontend) and Railway (backend) deployment
- `WEBHOOK_PROTOCOL.md` -- Webhook signature verification
- `docs/CATEGORY_SPENDING_PATTERN.md` -- Why `spentAmount` is computed at read time, not stored

## Database Migrations

Database migrations run **automatically on every Railway deployment**. The backend entrypoint (`src/start.ts`) runs all pending Drizzle migrations before starting the server. No manual migration step is needed.

When making changes that affect the database schema:

1. **Edit the schema** in `backend/src/db/schema.ts`
2. **Create a migration SQL file** in `backend/drizzle/migrations/` (e.g., `0006_description.sql`) — use `ALTER TABLE` with `IF EXISTS`/`IF NOT EXISTS` guards for safety
3. **Add an entry** to `backend/drizzle/migrations/meta/_journal.json` with the next `idx`, a `when` timestamp, and the `tag` matching the filename (without `.sql`)
4. The migration will apply automatically the next time the backend starts on Railway

Key files:
- `backend/src/start.ts` -- runs `drizzle-orm/postgres-js/migrator` then starts the server (`npm start` → `node dist/start.js`)
- `backend/src/db/migrate.ts` -- standalone migration runner for local use (`npm run db:migrate`)
- `backend/drizzle/migrations/` -- SQL migration files
- `backend/drizzle/migrations/meta/_journal.json` -- migration journal (tracks which migrations exist and their order)

## Planning Rules

- Plans should be high-level descriptions of the approach and files to modify. Do not include code snippets in plans.
