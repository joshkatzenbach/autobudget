# AutoBudget -- Claude Code Guidelines

## Project Structure

- `backend/` -- Express.js + TypeScript API (PostgreSQL via Drizzle ORM)
- `ng-budget/` -- Angular frontend
- `docs/` -- Paradigms, patterns, and architectural decisions

## Documentation Rules

After successfully implementing or fixing a feature, always update or create the relevant markdown file in `docs/`. This keeps the team (and future Claude sessions) aware of patterns, conventions, and architectural decisions. If a fix introduces a new pattern or changes an existing one, document it. If an existing doc becomes stale due to a change, update it.

## Key Docs

- `docs/SLACK_MODAL_PATTERNS.md` -- Slack modal private_metadata limits, reconstruction-from-DB pattern, response_action usage
- `SLACK_SETUP.md` -- Slack app configuration, OAuth scopes, webhook URLs
- `PLAID_AMOUNT_CONVENTION.md` -- How Plaid amounts are signed and displayed
- `DEPLOYMENT.md` -- Firebase (frontend) and Railway (backend) deployment
- `WEBHOOK_PROTOCOL.md` -- Webhook signature verification
