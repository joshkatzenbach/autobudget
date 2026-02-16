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

## Planning Rules

- Plans should be high-level descriptions of the approach and files to modify. Do not include code snippets in plans.
