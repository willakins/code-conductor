# Code Conductor — Agent Guide (Current Architecture)

Code Conductor is in steady-state mode. Use this file as the default operating guide for future changes.

## Product Context

Code Conductor is a provider-abstracted engineering operations bot for a single-repository workflow.

- Communication providers: Slack, Microsoft Teams
- Code host providers: GitHub, Bitbucket
- Deploy providers: DigitalOcean, AWS CodePipeline
- Persistence: Postgres

Primary behavior:

- Merged PRs are tracked as `untested`.
- Open PR review state is tracked in `open_pr_review_state`.
- Engineers mark PRs as tested via `/conductor tested <PR_NUMBER>`.
- `/conductor deploy prod` is blocked when blocking PRs exist since last prod deploy.
- If configured and the gate is clear (or force is used), Code Conductor triggers the deploy and records deployment state.
- Scheduled review recap messages post to a configured communication channel.
- Daily open-PR sync can reconcile review and merge state from the active code host.

## Non-Negotiable Invariants

- Never allow normal deploy when blocking PRs exist.
- If deploy trigger call fails, do not write deployment rows and do not mark PRs deployed.
- Deployment insert + PR deployed-marking must remain in one DB transaction (rollback on failure).
- If no prior prod deployment exists, baseline remains epoch (`1970-01-01...`).
- Webhook handling must verify signature before processing payloads.
- Webhook ingestion only applies to configured repo + configured main branch.
- Unknown provider selections must fail fast at startup.

## Architecture Boundaries

- `src/app.js`: composition root only (runtime wiring, route wiring, startup).
- `src/config.js`: environment parsing/validation and provider defaults.
- `src/commands/parsing/*`: command text parsing only.
- `src/commands/registry/*`: command lookup and dispatch only.
- `src/commands/types/*`: per-command parse/execute/access behavior (`help`, `config`, `sync`, `status`, `reviews`, `tested`, `deploy`, `whitelist`, `unknown`).
- `src/commands/services/*`: runtime dependency/context wiring for command execution.
- `src/background_jobs/*`: scheduler orchestration.
- `src/background_jobs/tasks/*`: sync task logic for review + merged-untested reconciliation.
- `src/platform/communication/*`: communication provider abstractions/adapters.
- `src/platform/code_host/*`: code host webhook + API abstractions/adapters.
- `src/platform/deploy/*`: deploy platform abstractions/adapters.
- `src/db/*`: SQL access and state transitions.
- `src/shared/*`: shared pure domain helpers (e.g., timeframe logic).
- `src/util/*`: formatting and helper utilities.

## Preferred Implementation Patterns

- Keep modules single-purpose and intention-revealing.
- Prefer pure functions for parsing, mapping, validation, and formatting.
- Keep side effects at boundaries (HTTP handlers, DB, external APIs, schedulers).
- Add new commands by:
1. Adding a command class under `src/commands/types/`.
2. Registering it in `src/commands/registry/command_registry.js`.
- Add new providers by:
1. Implementing provider class in the relevant `src/platform/*/providers/` area.
2. Registering provider in the corresponding factory (`communication`, `code_host`, or `deploy`).
3. Updating config/runtime constraints as needed.
- Use explicit, user-facing error messages for command failures.
- Use DB transactions for multi-step state transitions.

## Runtime Routes & Surfaces

- Health check: `GET /healthz`
- Code host webhooks:
  - GitHub: `POST /github/webhook` (and alias `/codehost/webhook`)
  - Bitbucket: `POST /bitbucket/webhook` (and alias `/codehost/webhook`)
- Communication commands:
  - Slack slash command: `/conductor` (Socket Mode; `/calypso` remains a compatibility alias)
  - Microsoft Teams HTTP command path: `POST /communication/commands` (configurable)

## Testing Rules

- Every behavior change should include or update tests.
- Keep tests behavior-oriented and high-value, not implementation-coupled.
- Minimum checks before handoff:
1. `npm test` passes.
2. New/changed behavior is covered under `test/`.

## Deployment & Runtime Rules

- Local scripts:
  - `npm run start` (managed local stack)
  - `npm run stop`
  - `npm run dev` (app only)
  - `npm run start:app` (app only)
- Hosted runtime uses Docker (`Dockerfile`) and managed Postgres.
- Managed Postgres should use `DATABASE_URL` with `sslmode=require`.
- Keep one primary always-on runtime for reliable webhook ingestion and scheduled tasks.

## Security & Operations

- Never commit secrets or `.env`.
- Treat exposed secrets as compromised and rotate immediately.
- Keep token scopes minimal for communication, code host, and deploy providers.
- Preserve auditability in logs and deployment state transitions.

## Change Discipline

- Prefer small, reviewable diffs.
- Avoid broad rewrites unless explicitly requested.
- Preserve current behavior unless request scope requires behavior changes.
- Update `README.md` when operational setup or public behavior changes.
