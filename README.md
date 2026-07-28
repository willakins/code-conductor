# Calypso

Calypso is a platform-abstracted deployment gatekeeper for a single repository workflow.
It currently runs with Slack + GitHub + DigitalOcean by default, while exposing provider
abstractions for communication, code-host, deploy, email, AI, and error-tracking integrations.
It tracks merged pull requests in Postgres, requires explicit testing confirmation,
blocks production deploys when untested changes exist, posts scheduled review recap messages,
can poll one environment health endpoint for outage alerts, and can track customer support
emails from Gmail or Outlook as an actionable queue, can draft support-email replies through
OpenAI or Anthropic, and can poll Sentry or Rollbar for newly tracked unresolved error groups.

## What It Does

- Ingests merged code-host pull requests into `pull_requests` as `untested`.
- Tracks open PR review lifecycle in `open_pr_review_state`.
- Reconciles open PR review state from code host once per day (when code-host API token is configured).
- Exposes a communication-platform command surface (`/calypso` for Slack).
- Supports status and release workflow commands:
  - `/calypso help`
  - `/calypso config time-format:human|long`
  - `/calypso config timezone:America/New_York`
  - `/calypso config communication-provider:slack|microsoft_teams`
  - `/calypso config code-host-provider:github|bitbucket`
  - `/calypso config deploy-provider:digitalocean|aws`
  - `/calypso config deploy-environment:prod|staging`
  - `/calypso config email-provider:gmail|outlook`
  - `/calypso config ai-provider:openai|anthropic`
  - `/calypso config error-tracking-provider:sentry|rollbar`
  - `/calypso config review-recap-channel:<#CHANNEL|CHANNEL_ID>`
  - `/calypso config review-recap-window:<all|last-day|last-week|last-month>`
  - `/calypso config review-recap-recency:<Nd|Nw>` (legacy)
  - `/calypso config review-recap-schedule:<daily|weekday>@HH:MM[,HH:MM...]`
  - `/calypso config review-recap-send-weekends:<on|off>`
  - `/calypso config review-recap-send-holidays:<on|off>`
  - `/calypso config environment-status:on|off`
  - `/calypso config environment-status-url:https://example.com/healthz`
  - `/calypso config environment-status-channel:<#CHANNEL|CHANNEL_ID|channel-name>`
  - `/calypso config error-tracking:on|off`
  - `/calypso config error-tracking-channel:<#CHANNEL|CHANNEL_ID|channel-name>`
  - `/calypso config error-tracking-project:<PROJECT_SLUG>`
  - `/calypso config error-tracking-environment:<ENVIRONMENT|any>`
  - `/calypso config email-monitor:on|off`
  - `/calypso config email-channel:<#CHANNEL|CHANNEL_ID|channel-name>`
  - `/calypso config email-on-call <@USER|USER_ID> <Nh|Nd|Nw>`
  - `/calypso config email-on-call off`
  - `/calypso config github-slack-user-map:<GITHUB_USER>=<@USER|USER_ID|@HANDLE>`
  - `/calypso sync`
  - `/calypso status`
  - `/calypso errors`
  - `/calypso reviews [<GITHUB_USER>] [<day|week|month>]`
  - `/calypso emails`
  - `/calypso emails draft <EMAIL_ID> [ADDITIONAL_INSTRUCTIONS...]`
  - `/calypso emails responded <EMAIL_ID>`
  - `/calypso tested <PR_NUMBER>`
  - `/calypso must-test <PR_NUMBER>`
  - `/calypso must-test off <PR_NUMBER>`
  - `/calypso deploy`
  - `/calypso deploy list`
  - `/calypso deploy staging`
  - `/calypso deploy prod`
- Enforces deploy blocking rules:
  - A blocker is any PR with `merged_at > last_prod_deploy_at` and `status` not in `tested`, `deployed`.
- Optionally triggers deploy-platform production deploy when gate is clear, then records deployed PRs only after provider completion succeeds.
- Optionally triggers staging deploy directly when staging app/pipeline is configured.
- Optionally polls one configured environment URL and posts transition-based outage/recovery alerts.
- Optionally polls one configured Sentry or Rollbar project/environment scope and posts one alert per new or regressed unresolved issue group.
- Optionally ingests Gmail or Outlook support mailbox activity into `support_email_threads`, posts new-email
  notifications, and lets responders mark queued items handled.
- Optionally drafts support-email replies for queued items through the active AI provider.
- Runtime display config is per communication user (defaults: time format `human`, timezone `America/New_York`).
- Review recap schedule config is workspace-wide (defaults: Monday 9:00 AM `America/New_York`, recap window `all`).

## Architecture

Calypso is a single Node.js service composed of:

- Communication platform provider (Slack implemented; Microsoft Teams implemented).
- Code-host platform provider (GitHub implemented; Bitbucket implemented).
- Deploy platform provider (DigitalOcean implemented; AWS CodePipeline implemented).
- Email platform provider (Gmail implemented; Outlook implemented).
- AI platform provider (OpenAI implemented; Anthropic implemented).
- Error-tracking platform provider (Sentry implemented; Rollbar implemented).
- Express HTTP server for webhooks.
- Postgres persistence through `pg`.

Unknown providers fail fast at startup.

### Command System Design

Commands are structured for extensibility:

- `registry`:
  - Command lookup and dispatch by command name.
- `types`:
  - One file per command type (`help`, `config`, `status`, `tested`, `must-test`, `deploy`, `unknown`).
  - Each command encapsulates its own parse + execute behavior.
- `base class`:
  - Shared command contract and helpers.

To add a new command:

1. Create a new command class in `src/commands/types/`.
2. Register it in `src/commands/registry/command_registry.js`.

## Project Layout

```text
src/
  app.js
  config.js
  commands/
    command_router.js
    parsing/
      command_parser.js
    registry/
      command_registry.js
    services/
      command_service.js
    types/
      base_command.js
      emails_command.js
      errors_command.js
      help_command.js
      config_command.js
      status_command.js
      tested_command.js
      deploy_command.js
      unknown_command.js
  db/
    index.js
    migrations/001_init.sql
  background_jobs/
    error_tracking_scheduler.js
    environment_status_scheduler.js
    scheduler.js
    review_recap_scheduler.js
    support_email_scheduler.js
    syncer.js
    tasks/
      review_sync_task.js
      untested_merged_sync_task.js
  platform/
    shared/
      errors.js
    communication/
      base_communication_platform.js
      factory.js
      resolution.js
      providers/
        slack_communication_platform.js
        microsoft_teams_communication_platform.js
    code_host/
      base_code_host_platform.js
      factory.js
      providers/
        github/
          code_host_platform.js
          client.js
          webhook.js
          verify_signature.js
        bitbucket/
          code_host_platform.js
          client.js
          webhook.js
          verify_signature.js
    deploy/
      base_deploy_platform.js
      factory.js
      providers/
        digitalocean_deploy_platform.js
        aws_deploy_platform.js
        aws/
          client.js
        digitalocean/
          client.js
    ai/
      base_ai_platform.js
      factory.js
      providers/
        anthropic/
          ai_platform.js
          client.js
        openai/
          ai_platform.js
          client.js
    error_tracking/
      base_error_tracking_platform.js
      factory.js
      providers/
        rollbar/
          client.js
          error_tracking_platform.js
        sentry/
          client.js
          error_tracking_platform.js
    email/
      base_email_platform.js
      factory.js
      providers/
        gmail/
          client.js
          email_platform.js
          webhook.js
        outlook/
          client.js
          email_platform.js
  shared/
    durations.js
  util/
    format.js
test/
  *.test.js
```

## Prerequisites

- Node.js 18+ (Node 20 recommended).
- For local hosting only:
  - `ngrok` installed and authenticated.
  - PostgreSQL CLI tools installed (`initdb`, `pg_ctl`, `psql`) for automated local stack start.
- A Slack app with:
  - Socket Mode enabled.
  - Slash command `/calypso`.
  - Relevant Slack message event subscriptions/history scopes if you want Calypso to nudge users who type `deploying prod`.
- Optional support-email setup:
  - A Gmail or Outlook mailbox for customer support.
  - For Gmail: Google Cloud Pub/Sub topic + authenticated push subscription pointing at `POST /email/webhook`.
  - For Gmail: Google OAuth client credentials + refresh token with Gmail API access.
  - For Outlook: Azure/Microsoft Entra app credentials with Microsoft Graph mail read access for the support mailbox.
- Optional:
  - DigitalOcean App Platform app and token for live deploy trigger.

## Environment Variables

Always required:

- `DATABASE_URL`
- `BOT_NAME` (default: `Calypso`)
- `COMMUNICATION_PROVIDER` (default: `slack`)
- `CODE_HOST_PROVIDER` (default: `github`)
- `DEPLOY_PROVIDER` (default: `digitalocean`)
- `EMAIL_PROVIDER` (default: `gmail`)
- `AI_PROVIDER` (default: `openai`)
- `ERROR_TRACKING_PROVIDER` (default: `sentry`)

Required when `COMMUNICATION_PROVIDER=slack`:

- `COMMUNICATION_BOT_TOKEN`
- `COMMUNICATION_APP_TOKEN`

Required when `CODE_HOST_PROVIDER=github` or `CODE_HOST_PROVIDER=bitbucket`:

- `CODE_HOST_WEBHOOK_SECRET`
- `CODE_HOST_REPOSITORY` (example: `croft-eng/croft`)
- `CODE_HOST_MAIN_BRANCH` (example: `main`)

Optional:

- `PORT` (default `3001`)
- `POSTGRES_PASSWORD` (required when using `docker-compose.droplet.yml`)
- `CADDY_EMAIL` (used by `Caddyfile.droplet` for TLS contact email)
- `DEPLOY_TOKEN`
- `DEPLOY_PROD_APP_ID`
- `DEPLOY_STAGING_APP_ID`
- `DEPLOY_POLL_INTERVAL_SECONDS` (default `10`)
- `DEPLOY_TIMEOUT_SECONDS` (default `1200`)
- `CODE_HOST_TOKEN` (recommended for daily open-PR reconciliation)
- `CODE_HOST_CODEX_USER_LOGINS` (default: `codex,codex[bot]`)
- `CODE_HOST_OPEN_PR_SYNC_INTERVAL_HOURS` (default `24`)
- `CODEX_APPROVAL_POLL_INTERVAL_MINUTES` (default `5`)
- `ENVIRONMENT_STATUS_POLL_INTERVAL_SECONDS` (default `60`)
- `ENVIRONMENT_STATUS_TIMEOUT_SECONDS` (default `60`)
- `ENVIRONMENT_STATUS_FAILURE_THRESHOLD` (default `3`)
- `ENVIRONMENT_STATUS_RETRY_INITIAL_DELAY_SECONDS` (default `5`)
- `ENVIRONMENT_STATUS_RETRY_BACKOFF_MULTIPLIER` (default `3`)
- `ENVIRONMENT_STATUS_RETRY_MAX_DELAY_SECONDS` (default `45`)
- `ENVIRONMENT_STATUS_CONNECTIVITY_PROBE_URL` (recommended)
- `ERROR_TRACKING_POLL_INTERVAL_SECONDS` (default `300`)
- `ERROR_TRACKING_TIMEOUT_SECONDS` (default `15`)
- `ERROR_TRACKING_SENTRY_BASE_URL` (default `https://sentry.io`)
- `ERROR_TRACKING_SENTRY_AUTH_TOKEN`
- `ERROR_TRACKING_SENTRY_ORGANIZATION_SLUG`
- `ERROR_TRACKING_ROLLBAR_BASE_URL` (default `https://api.rollbar.com`)
- `ERROR_TRACKING_ROLLBAR_ACCESS_TOKEN`
- `EMAIL_PROVIDER` (default `gmail`)
- `AI_PROVIDER` (default `openai`)
- `AI_TIMEOUT_SECONDS` (default `30`)
- `AI_OPENAI_API_KEY`
- `AI_OPENAI_MODEL`
- `AI_OPENAI_BASE_URL` (default `https://api.openai.com/v1`)
- `AI_ANTHROPIC_API_KEY`
- `AI_ANTHROPIC_MODEL`
- `AI_ANTHROPIC_BASE_URL` (default `https://api.anthropic.com`)
- `AI_SUPPORT_EMAIL_SYSTEM_PROMPT`
- `EMAIL_GMAIL_ADDRESS`
- `EMAIL_GMAIL_CLIENT_ID`
- `EMAIL_GMAIL_CLIENT_SECRET`
- `EMAIL_GMAIL_REFRESH_TOKEN`
- `EMAIL_GMAIL_PUBSUB_TOPIC`
- `EMAIL_WEBHOOK_AUDIENCE`
- `EMAIL_PUSH_SERVICE_ACCOUNT_EMAIL`
- `EMAIL_OUTLOOK_ADDRESS`
- `EMAIL_OUTLOOK_TENANT_ID`
- `EMAIL_OUTLOOK_CLIENT_ID`
- `EMAIL_OUTLOOK_CLIENT_SECRET`
- `EMAIL_WATCH_RENEW_INTERVAL_HOURS` (default `24`)
- `EMAIL_SYNC_FALLBACK_INTERVAL_MINUTES` (default `5`)

Provider support matrix:

- Communication:
  - `slack`: implemented
  - `microsoft_teams`: implemented
- Code host:
  - `github`: implemented
  - `bitbucket`: implemented
- Deploy:
  - `digitalocean`: implemented
  - `aws`: implemented (CodePipeline)
- Email:
  - `gmail`: implemented
  - `outlook`: implemented
- AI:
  - `openai`: implemented
  - `anthropic`: implemented
- Error tracking:
  - `sentry`: implemented
  - `rollbar`: implemented

### How To Get Each Value

`COMMUNICATION_PROVIDER`

- Provider selector for communication integration.
- Supported values: `slack` (implemented), `microsoft_teams` (implemented).
- Default: `slack`.

`CODE_HOST_PROVIDER`

- Provider selector for code-host integration.
- Supported values: `github` (implemented), `bitbucket` (implemented).
- Default: `github`.

`DEPLOY_PROVIDER`

- Provider selector for deploy integration.
- Supported values: `digitalocean` (implemented), `aws` (implemented via CodePipeline).
- Default: `digitalocean`.

`EMAIL_PROVIDER`

- Provider selector for support-email integration.
- Supported values: `gmail` (implemented), `outlook` (implemented).
- Default: `gmail`.

`AI_PROVIDER`

- Provider selector for AI-assisted drafting.
- Supported values: `openai` (implemented), `anthropic` (implemented).
- Default: `openai`.

`ERROR_TRACKING_PROVIDER`

- Provider selector for error-tracking integration.
- Supported values: `sentry` (implemented), `rollbar` (implemented).
- Default: `sentry`.

`DEPLOY_REGION`

- Deploy provider region.
- Used by AWS CodePipeline deploy provider.
- Default: `us-east-1`.

`DEPLOY_ACCESS_KEY_ID`

- Access key id used by AWS deploy provider request signing.

`DEPLOY_SECRET_ACCESS_KEY`

- Secret access key used by AWS deploy provider request signing.

`DEPLOY_SESSION_TOKEN`

- Optional session token for temporary AWS credentials.

`BOT_NAME`

- Display name used in bot-generated help and error messages.
- Default: `Calypso`.

`COMMUNICATION_BOT_TOKEN`

- Slack App -> `OAuth & Permissions` -> install/reinstall app -> copy `Bot User OAuth Token` (`xoxb-...`).
- Add bot scope `users:read` so Calypso can detect workspace admins for deploy authorization.
- Add the matching Slack history scopes for any surfaces where Calypso should detect `deploying prod` messages.
- If you want `/calypso config email-on-call @handle ...`, keep `users:read` enabled so Calypso can resolve Slack handles to user IDs.

`COMMUNICATION_APP_TOKEN`

- Slack App -> `Socket Mode` -> enable -> generate app-level token with `connections:write` scope -> copy token (`xapp-...`).

`COMMUNICATION_COMMAND_PATH`

- Provider-agnostic HTTP path for incoming communication command requests.
- Used by `microsoft_teams` provider for Calypso command ingestion.
- Default: `/communication/commands`.

`COMMUNICATION_WEBHOOK_URL`

- Provider-agnostic outbound webhook URL for communication platforms that support webhook posting.
- Used by `microsoft_teams` for in-channel recap posts and follow-up channel messages.

`COMMUNICATION_ADMIN_USER_IDS`

- Optional comma-separated user IDs treated as workspace admins when `COMMUNICATION_PROVIDER=microsoft_teams`.

`DATABASE_URL`

- If using `npm run start` managed local runtime, use:
  - `postgresql://calypso_user@127.0.0.1:5433/postgres`
- If using your own Postgres, set your own host/port/user/db:
  - `postgresql://<user>:<password>@<host>:<port>/<database>`
- If using DigitalOcean Managed PostgreSQL, use the connection string from DO with:
  - `?sslmode=require` (Calypso enables TLS automatically when this is present)

`CODE_HOST_WEBHOOK_SECRET`

- Generate a random secret, for example:
  - `openssl rand -hex 32`
- Use the same value in `.env` and in GitHub repo webhook settings.

`CODE_HOST_REPOSITORY`

- Set to the exact full repo name:
  - `<owner>/<repo>` (example: `willakins/Test-repo`)
- Must exactly match `payload.repository.full_name` from GitHub webhook events.

`CODE_HOST_MAIN_BRANCH`

- Usually `main` (or your default protected branch, like `master`).
- Must match the base branch of merged PRs you want Calypso to track.

`CODE_HOST_TOKEN` (optional, enables daily PR reconciliation)

- GitHub -> Settings -> Developer settings -> Personal access tokens (fine-grained or classic).
- Minimum needed access for this repo: read pull requests.
- Used only for scheduled read-only sync of open PR and review state.

`CODE_HOST_CODEX_USER_LOGINS` (optional)

- Comma-separated GitHub logins that count as "Codex approved" when they react 👍 to the PR description.
- Default: `codex,codex[bot]`.
- Example: `CODE_HOST_CODEX_USER_LOGINS=codex,openai-codex[bot]`

`CODE_HOST_OPEN_PR_SYNC_INTERVAL_HOURS` (optional)

- How often Calypso reconciles open PR review state from GitHub API.
- Default: `24`.

`CODEX_APPROVAL_POLL_INTERVAL_MINUTES` (optional)

- How often Calypso refreshes Codex 👍 approval from PR-description reactions.
- Default: `5`.

`PORT` (optional)

- HTTP port Calypso binds to (used by local runtime, ngrok tunnel, and Droplet Docker/Caddy stack).
- Default is `3001`; only set this if you need a different port.

`DEPLOY_TOKEN` (optional unless using `/calypso deploy prod` or `/calypso deploy staging`)

- DigitalOcean -> `API` -> `Tokens/Keys` -> generate personal access token.
- Recommended custom scopes for this app-deploy flow:
  - `app:update` (plus required read dependencies auto-added by DO).

`DEPLOY_PROD_APP_ID` (optional unless using `/calypso deploy prod`)

- DigitalOcean App Platform app UUID.
- Find it with:
  - `doctl apps list --format ID,Spec.Name`

`DEPLOY_STAGING_APP_ID` (optional unless using `/calypso deploy staging`)

- DigitalOcean App Platform staging app UUID (or AWS staging pipeline name).
- Find it with:
  - `doctl apps list --format ID,Spec.Name`

`DEPLOY_POLL_INTERVAL_SECONDS` (optional)

- Poll interval for checking deployment completion status after deploy trigger.
- Default: `10` seconds.

`DEPLOY_TIMEOUT_SECONDS` (optional)

- Max time Calypso waits for deployment completion follow-up message.
- Default: `1200` seconds (20 minutes).

`ENVIRONMENT_STATUS_POLL_INTERVAL_SECONDS` (optional)

- How often the environment monitor polls the configured URL.
- Default: `60` seconds.

`ENVIRONMENT_STATUS_TIMEOUT_SECONDS` (optional)

- Request timeout for each environment poll.
- Default: `60` seconds.

`ENVIRONMENT_STATUS_FAILURE_THRESHOLD` (optional)

- Number of consecutive failed app probes required in one monitoring cycle before Calypso marks the app unhealthy.
- Default: `3`.

`ENVIRONMENT_STATUS_RETRY_INITIAL_DELAY_SECONDS` (optional)

- Delay before the first retry after a failed app probe.
- Default: `5` seconds.

`ENVIRONMENT_STATUS_RETRY_BACKOFF_MULTIPLIER` (optional)

- Exponential multiplier applied between failed app-probe retries.
- Default: `3`.

`ENVIRONMENT_STATUS_RETRY_MAX_DELAY_SECONDS` (optional)

- Maximum delay between failed app-probe retries.
- Default: `45` seconds.

`ENVIRONMENT_STATUS_CONNECTIVITY_PROBE_URL` (optional but recommended)

- HTTPS endpoint Calypso uses to verify its own outbound connectivity before probing the app URL.
- Should be lightweight, operator-controlled, and independent from the monitored app origin.
- If unset, environment monitoring stays skipped even when `/calypso config environment-status:on` is enabled.

`ERROR_TRACKING_POLL_INTERVAL_SECONDS` (optional)

- How often Calypso polls the configured error-tracking project scope.
- Default: `300` seconds.

`ERROR_TRACKING_TIMEOUT_SECONDS` (optional)

- Request timeout for each Sentry API poll.
- Default: `15` seconds.

`ERROR_TRACKING_SENTRY_BASE_URL` (optional)

- Base URL for Sentry API requests.
- Defaults to `https://sentry.io`.
- Override this for self-hosted Sentry-compatible installs.

`ERROR_TRACKING_SENTRY_AUTH_TOKEN` (optional, required to enable Sentry polling)

- Sentry auth token used for organization project lookup and unresolved issue polling.
- Minimum recommended scopes: `event:read` and `org:read`.

`ERROR_TRACKING_SENTRY_ORGANIZATION_SLUG` (optional, required to enable Sentry polling)

- Organization slug used in Sentry API paths, for example `acme`.

`ERROR_TRACKING_ROLLBAR_BASE_URL` (optional)

- Base URL for Rollbar API requests.
- Defaults to `https://api.rollbar.com`.

`ERROR_TRACKING_ROLLBAR_ACCESS_TOKEN` (optional, required to enable Rollbar polling)

- Rollbar project or account access token used to list active items.

`EMAIL_GMAIL_ADDRESS` (optional, enables support-email integration when paired with the Gmail credentials below)

- Support mailbox address Calypso should monitor, for example `support@example.com`.
- Also used to ignore messages sent from the support mailbox itself.

`EMAIL_GMAIL_CLIENT_ID` and `EMAIL_GMAIL_CLIENT_SECRET` (optional)

- Google Cloud OAuth client credentials for the Gmail API.
- Create an OAuth client in Google Cloud Console and enable the Gmail API for the project.

`EMAIL_GMAIL_REFRESH_TOKEN` (optional)

- Long-lived refresh token for the support mailbox OAuth grant.
- Calypso exchanges this for short-lived Gmail access tokens at runtime.

`EMAIL_GMAIL_PUBSUB_TOPIC` (optional)

- Full Pub/Sub topic name used by Gmail `users.watch`.
- Example: `projects/<gcp-project>/topics/calypso-support-email`.

`EMAIL_WEBHOOK_AUDIENCE` (optional, recommended when using the Gmail webhook)

- Expected audience claim for the authenticated Pub/Sub push JWT.
- Set this to the exact public webhook URL, for example `https://calypso.example.com/email/webhook`.

`EMAIL_PUSH_SERVICE_ACCOUNT_EMAIL` (optional)

- Extra verification for the Pub/Sub authenticated push token.
- Set this to the service account email used by the push subscription if you want Calypso to reject tokens from other service accounts.

`EMAIL_OUTLOOK_ADDRESS` (optional, enables Outlook support-email integration when paired with the Outlook credentials below)

- Support mailbox address Calypso should monitor with Microsoft Graph, for example `support@example.com`.
- Also used to ignore messages sent from the support mailbox itself.

`EMAIL_OUTLOOK_TENANT_ID`, `EMAIL_OUTLOOK_CLIENT_ID`, and `EMAIL_OUTLOOK_CLIENT_SECRET` (optional)

- Microsoft Entra application credentials used to fetch Microsoft Graph access tokens.
- The app needs application permission to read mail for the configured mailbox.

`EMAIL_WATCH_RENEW_INTERVAL_HOURS` (optional)

- How often Calypso attempts to renew the Gmail watch before expiration.
- Used only by the Gmail provider.
- Default: `24` hours.

`EMAIL_SYNC_FALLBACK_INTERVAL_MINUTES` (optional)

- Fallback support-email sync cadence.
- For Gmail, this is the fallback history-sync interval when no push notification arrives.
- For Outlook, this is the main polling interval.
- Default: `5` minutes.

## Hosting

### Pricing Snapshot (DigitalOcean)

Estimated monthly costs as of 2026-02-16:

- App Platform web service (`apps-s-1vcpu-0.5gb`) starts at `$5/mo`.
- Managed PostgreSQL single node (1 GiB) starts at `$15/mo`.
- Basic Droplets currently show `$4/mo` (512 MiB) and `$6/mo` (1 GiB).

Practical options:

- App Platform + Managed PostgreSQL: about `$20/mo` minimum.
- Single Droplet hosting app + Postgres yourself: about `$4-$6/mo` minimum.
- Droplet + Managed PostgreSQL: about `$19-$21/mo` minimum.

Notes:

- App Platform static sites have a free tier, but Calypso needs a running web service.
- App Platform additional outbound transfer is billed at `$0.02/GiB`.

### Host Locally (Fastest Development Setup)

1. Install dependencies:

```bash
npm install
```

2. Create `.env` with required values.
3. Start the managed local stack:

```bash
npm run start
```

This local command starts:

- Temporary Postgres at `.tmp/calypso-pg` (first run initializes it).
- ngrok tunnel on `PORT` (default `3001`) with `--pooling-enabled` by default.
- Calypso app process.

If your ngrok config points multiple local apps at the same public URL, ngrok will load-balance requests across them when pooling is enabled. Set a different ngrok URL for each repo if you need isolated traffic, or set `NGROK_POOLING_ENABLED=false` before `npm run start` to disable pooling for Calypso.

4. Configure your code-host webhook to the printed ngrok URL:

- `https://<ngrok-domain>/codehost/webhook`

If you enable Gmail support-email monitoring locally, also configure your Pub/Sub push subscription to:

- `https://<ngrok-domain>/email/webhook`

5. Stop local runtime:

```bash
npm run stop
```

Optional local mode (you run your own Postgres + tunnel):

```bash
npm run dev
```

### Host on DigitalOcean App Platform (Managed PaaS)

Calypso is already set up for this:

- Dockerized runtime (`Dockerfile`).
- HTTP health endpoint (`GET /healthz`).
- Public webhook route (`/codehost/webhook`).
- Public Gmail push route (`/email/webhook`).
- Startup migrations run automatically.

Steps:

1. Create a DigitalOcean Managed PostgreSQL cluster.
2. Copy DB URL and keep `sslmode=require` in `DATABASE_URL`.
3. Create App Platform app from this repo using the root `Dockerfile`.
4. Configure as a Web Service, one instance.
5. Set environment variables in App Platform:
   - Required:
     - `DATABASE_URL`
     - `COMMUNICATION_PROVIDER=slack`
     - `COMMUNICATION_BOT_TOKEN`
     - `COMMUNICATION_APP_TOKEN`
     - `CODE_HOST_PROVIDER=github`
     - `CODE_HOST_WEBHOOK_SECRET`
     - `CODE_HOST_REPOSITORY`
     - `CODE_HOST_MAIN_BRANCH`
   - Optional:
     - `BOT_NAME`
     - `PORT` (defaults to `3001`)
     - `CODE_HOST_TOKEN` (enables `/calypso sync` and scheduled backfill)
     - `DEPLOY_PROVIDER=digitalocean`
     - `DEPLOY_TOKEN`
     - `DEPLOY_PROD_APP_ID`
     - `DEPLOY_STAGING_APP_ID`
6. Configure App health check path to `/healthz`.
7. Deploy the app.
8. Set webhook URL to `https://<your-app-domain>/codehost/webhook`.
9. If using Gmail support email monitoring, set Pub/Sub push endpoint to `https://<your-app-domain>/email/webhook`.
10. Smoke test:
   - `/calypso help`
   - `/calypso status`
   - merge a PR and confirm webhook delivery `200`.

### Host on a DigitalOcean Droplet (Cheapest Always-On)

This repo includes `docker-compose.droplet.yml` and `Caddyfile.droplet` for this flow.

1. Create an Ubuntu Droplet (1 GiB recommended).
2. Point a domain `A` record to the Droplet IP (example: `calypso.example.com`).
3. Open inbound ports `22`, `80`, `443` in DO firewall.
4. SSH in and install Docker:

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin git
sudo systemctl enable --now docker
```

5. Clone this repo and create `.env` in repo root.
6. In `.env`, use a local Compose DB URL:
   - `POSTGRES_PASSWORD=<strong-password>`
   - `CADDY_EMAIL=you@yourdomain.com`
   - `PORT=3001` (optional; change only if you want a different app/proxy port)
   - `DATABASE_URL=postgresql://calypso_user:<POSTGRES_PASSWORD>@db:5432/calypso`
7. Update `Caddyfile.droplet`:
   - replace `calypso.example.com` with your domain
8. Start the stack:

```bash
docker compose -f docker-compose.droplet.yml up -d --build
```

9. Verify health:

```bash
curl https://<your-domain>/healthz
```

10. Configure webhook:
   - `https://<your-domain>/codehost/webhook`
11. If using Gmail support email monitoring, configure Pub/Sub push endpoint:
   - `https://<your-domain>/email/webhook`

Operational notes:

- Slack Socket Mode means slash commands do not require a public Slack request URL.
- Slack `deploying prod` tips require the app to receive the relevant Slack message events for the channels or conversations you want monitored.
- Gmail support-email monitoring requires a public `POST /email/webhook` endpoint plus a valid Gmail watch configuration.
- Outlook support-email monitoring is polling-only and does not require a public email webhook.
- Keep one primary Calypso runtime for stable webhook ingestion and schedulers.
- If you use the Droplet Compose DB service, do not expose `5432` publicly.

Pricing references:

- App Platform pricing: https://www.digitalocean.com/pricing/app-platform
- Managed PostgreSQL pricing: https://www.digitalocean.com/pricing/managed-databases
- Droplet pricing: https://www.digitalocean.com/pricing/droplets

## Code-Host Webhook

Endpoint:

- `POST /codehost/webhook`

Rules:

- Requires valid `X-Hub-Signature-256` HMAC signature.
- Processes `pull_request` and `pull_request_review` events.
- Only processes events for configured `CODE_HOST_MAIN_BRANCH` and configured `CODE_HOST_REPOSITORY`.
- Merged PR close events upsert to deploy-gating table as `untested`.
- Open PR lifecycle and review submissions update `open_pr_review_state`.

## Gmail Email Webhook

Endpoint:

- `POST /email/webhook`

Rules:

- Expects Google Pub/Sub authenticated push with a bearer JWT.
- Verifies issuer, signature, token expiry, and optional audience/service-account constraints.
- Ignores Gmail notifications for mailboxes other than configured `EMAIL_GMAIL_ADDRESS`.
- Stores the greatest pending Gmail history id so the background scheduler can sync mailbox changes.

## Daily Open PR Sync

- Runs as a background scheduler in the app runtime.
- Performs a full open-PR reconciliation for `CODE_HOST_REPOSITORY` + `CODE_HOST_MAIN_BRANCH`.
- Frequency is controlled by `CODE_HOST_OPEN_PR_SYNC_INTERVAL_HOURS` (default every 24 hours).
- Requires `CODE_HOST_TOKEN`; without it, webhook-based tracking still works but no periodic backfill runs.
- Reconciles Codex approval by checking current 👍 reactions on PR descriptions from configured `CODE_HOST_CODEX_USER_LOGINS`.
- Upserts all currently open PR review-state rows and marks stale local open rows as `closed`.
- Backfills merged PRs newer than last prod deploy into deploy-gating state as `untested` (without downgrading already `tested`/`deployed` rows).

## Codex Approval Sync

- Runs as a separate background scheduler in the app runtime.
- Refreshes `codex_approved` using PR-description 👍 reactions from configured `CODE_HOST_CODEX_USER_LOGINS`.
- Frequency is controlled by `CODEX_APPROVAL_POLL_INTERVAL_MINUTES` (default every 5 minutes).
- Requires `CODE_HOST_TOKEN`.

## Slash Command Behavior

`/calypso help`

- Returns usage.

`/calypso config review-recap-channel:<#CHANNEL|CHANNEL_ID>`

- Sets workspace recap target channel for scheduled in-channel posts.

`/calypso config review-recap-recency:<Nd|Nw>`

- Sets recap lookback window in legacy mode (for example `1w`, `2w`, `2d`).

`/calypso config review-recap-window:<all|last-day|last-week|last-month>`

- Sets recap PR selection scope.
- `all` includes every open, non-draft PR.
- `last-day`, `last-week`, and `last-month` apply rolling lookback windows.

`/calypso config review-recap-schedule:<daily|weekday>@HH:MM[,HH:MM...]`

- Sets one or more recap send slots using `daily` or weekday + 24h clock.
- Examples: `daily@09:00`, `daily@09:00,17:00`, `mon@09:00,17:30`, `tue@10:15`.

`/calypso config review-recap-send-weekends:<on|off>`

- Controls whether recap posts are sent on Saturday/Sunday.
- Default is `off`.

`/calypso config review-recap-send-holidays:<on|off>`

- Controls whether recap posts are sent on observed US federal holidays.
- Default is `off`.

`/calypso config environment-status:on|off`

- Enables or disables environment polling.

`/calypso config environment-status-url:https://example.com/healthz`

- Sets the single environment endpoint Calypso should poll.
- Health is exact HTTP `200`; all other responses, timeouts, and network errors are unhealthy.
- Observer-side network loss does not mark the app down; Calypso first verifies outbound DNS + HTTPS reachability through `ENVIRONMENT_STATUS_CONNECTIVITY_PROBE_URL`.

`/calypso config environment-status-channel:<#CHANNEL|CHANNEL_ID|channel-name>`

- Sets the channel that receives environment down and recovery alerts.

`/calypso config error-tracking:on|off`

- Enables or disables error-tracking polling.

`/calypso config error-tracking-channel:<#CHANNEL|CHANNEL_ID|channel-name>`

- Sets the channel that receives new-issue and regression alerts.

`/calypso config error-tracking-project:<PROJECT_SLUG>`

- Sets the active error-tracking project scope.
- For Sentry, use the project slug.
- For Rollbar, use the numeric project id if you want Calypso to filter the items API to one project.

`/calypso config error-tracking-environment:<ENVIRONMENT|any>`

- Sets the active error-tracking environment filter.
- Use `any` to clear the environment filter.

`/calypso config email-monitor:on|off`

- Enables or disables support-email ingestion for the active email provider.

`/calypso config email-channel:<#CHANNEL|CHANNEL_ID|channel-name>`

- Sets the channel for automatic support-email notifications.

`/calypso config email-on-call <@USER|USER_ID> <Nh|Nd|Nw>`

- Sets the support-email on-call recipient until the provided duration expires.
- Slack mention form is used automatically in notifications when Calypso is running on Slack.

`/calypso config email-on-call off`

- Clears the configured support-email on-call user and expiration.

`/calypso config github-slack-user-map:<GITHUB_USER>=<@USER|USER_ID|@HANDLE>`

- Maps a GitHub username to a Slack identity used in production deploy summaries.
- Prefer Slack mention or user ID for reliable tagging: `<@U123ABC>` or `U123ABC`.
- Example: `/calypso config github-slack-user-map:octocat=<@U123ABC>`

`/calypso config timezone:America/New_York`

- Sets timezone (IANA), used by human timestamps and recap schedule rendering.

`/calypso config communication-provider:slack|microsoft_teams`

- Sets communication platform provider in runtime config.
- Takes effect immediately for `/calypso` command handling.

`/calypso config code-host-provider:github|bitbucket`

- Sets code-host platform provider in runtime config.
- Takes effect immediately for `/calypso` command handling.

`/calypso config deploy-provider:digitalocean|aws`

- Sets deploy platform provider in runtime config.
- Takes effect immediately for `/calypso` command handling.

`/calypso config email-provider:gmail|outlook`

- Sets the support-email provider in runtime config.
- Resets provider-specific email sync state so the new provider can establish a fresh baseline.

`/calypso config ai-provider:openai|anthropic`

- Sets the AI provider in runtime config.
- Takes effect immediately for `/calypso` command handling.

`/calypso config error-tracking-provider:sentry|rollbar`

- Sets the error-tracking provider in runtime config.
- Resets provider-specific error-tracking sync state so the new provider can establish a fresh baseline.

`/calypso sync`

- Triggers open PR reconciliation immediately using GitHub API.
- Requires workspace admin or Calypso deploy-whitelist access.
- Returns counts for both sync paths:
  - review-state sync (open PRs upserted + stale open rows closed)
  - merged-untested sync (merged PRs backfilled as untested)

`/calypso status`

- Shows blockers since last production deployment.
- If no deployments exist, baseline is epoch (`1970-01-01T00:00:00.000Z`).
- Uses a scannable rich message with the gate state, blocker count, last production deploy,
  and a separate linked list of PRs that still need testing.
- Reports the production channel-topic marker independently from PR blockers. A red production
  marker makes the overall status blocked even when no PRs need testing.

`/calypso reviews [<GITHUB_USER>] [<day|week|month>]`

- Lists open PRs waiting on review from review-tracking state.
- Optional GitHub user filter (author login).
- Optional recency filter (`day`, `week`, `month`).
- Supports `recent` keyword variant: `/calypso reviews recent <day|week|month>`.
- Uses the same PR row format as review recap, including `Last modified` date (`M/D/YYYY`).
- Groups rows by `Last modified` age with subheaders: last month, last 3 months, and 3+ months.

`/calypso emails`

- Lists pending customer support email items oldest-first.
- Each line includes Calypso's email queue id, first sender, and subject.

`/calypso emails draft <EMAIL_ID> [ADDITIONAL_INSTRUCTIONS...]`

- Drafts a support-email reply for one queued item using the active AI provider.
- Returns the draft ephemerally and does not send or persist the generated reply.
- Restricted to workspace admins or the current support-email on-call user.
- Uses the first tracked inbound customer message for context.

`/calypso emails responded <EMAIL_ID>`

- Marks one pending support-email item as responded.
- Does not talk back to Gmail in v1; this is a manual queue-management action.

`/calypso tested <PR_NUMBER>`

- Marks the PR as tested.
- Idempotent when already tested.
- Returns clear message if PR not found.

`/calypso tested all`

- Marks all currently `untested` PRs as `tested`.

`/calypso tested recent <day|week|month>`

- Lists PRs tested in the selected recent timeframe.
- Includes PR number, repo, status, tester, and tested timestamp.

`/calypso whitelist <@USER>`

- Restricted command for workspace admins or already-whitelisted users.
- Adds a user to Calypso deploy whitelist.
- Whitelisted users can run deploy commands even if they are not workspace admins.

`/calypso config deploy-environment:prod|staging`

- Sets the workspace-wide default environment used by `/calypso deploy`.

`/calypso deploy`

- Deploys to the configured default environment (`prod` by default).
- Applies the same access, channel-topic, and production blocker checks as an explicit environment command.

`/calypso deploy list`

- Alias for `/calypso status`.

`/calypso deploy prod`

- Blocks when untested blockers exist.
- Access restricted to workspace admins and whitelisted users.
- Blocks when channel topic marks production as red.
- If no blockers and DigitalOcean env vars missing, returns "deploy not configured".
- If configured and deploy is initiated:
  - shows the triggering Slack user as a Slack mention
  - includes a `PRs to deploy` list with PR title links and mapped author handles
  - labels each PR that was tested with `(tested)`
  - does not insert a `deployments` row yet
  - does not mark PRs as `deployed` yet
- After the deploy provider reports success:
  - inserts a `deployments` row
  - marks only the planned PRs as `deployed`
  - includes a `Deployed PRs` list with the tested labels in the follow-up response
- If the provider does not return an external deployment id:
  - does not write deployment row
  - does not mark PRs deployed
- If deploy fails:
  - does not write deployment row
  - does not mark PRs deployed
- After trigger, Calypso sends a follow-up message when the deploy provider finishes the deployment.
- If the follow-up detects that the deployment failed or timed out, Calypso tags `@here` in Slack.
- Deployment blocked, started, completed, and failed messages use Slack Block Kit or a
  Microsoft Teams Adaptive Card, with plain text retained as a fallback.
- All other command responses use the same rich-message system with command-specific headers,
  outcome-aware status styling, and provider-safe content sections.

`/calypso deploy staging`

- Access restricted to workspace admins and whitelisted users.
- Triggers deployment using `DEPLOY_STAGING_APP_ID`.
- Blocks when channel topic marks staging as red.
- Does not run prod blocker checks.
- Does not mark PRs as deployed.
- Sends a deployment-completion follow-up when provider returns an external deployment id.

## Review Recap

- Runs as a background scheduler in the app runtime.
- Checks once per minute for configured recap slot (`daily@HH:MM` or `<weekday>@HH:MM`).
- Optionally skips scheduled recap posts on weekends and/or observed US federal holidays.
- Posts in-channel message in configured `review-recap-channel` containing:
  - Header: `PR Review Recap — {scope}`
  - Bold sections in priority order:
    - `Approved By Reviewers (Unmerged)`
    - `Codex Approved, Waiting On Human Approval`
    - `Other Open Pull Requests`
  - Multi-line PR rows with PR reference, title, author, review state, Codex state, and `Last modified` date (`M/D/YYYY`).
- Includes empty state (`• No open non-draft pull requests in scope.`) when no PRs match.
- PR matching rule:
  - `lifecycle_state = open`
  - `is_draft = false`
  - `opened_for_review_at` (or fallback `opened_at`) within configured scope window.

## Environment Status Monitoring

- Runs as a background scheduler in the app runtime.
- Polls one configured URL every `ENVIRONMENT_STATUS_POLL_INTERVAL_SECONDS` (default `60`).
- Before each app probe, Calypso verifies observer connectivity by resolving the probe host with DNS and fetching `ENVIRONMENT_STATUS_CONNECTIVITY_PROBE_URL` over HTTPS.
- If the observer connectivity preflight fails, Calypso skips the app probe, preserves the last known app state, and records the observer-side failure without posting a down alert.
- Uses `GET` with timeout `ENVIRONMENT_STATUS_TIMEOUT_SECONDS` (default `60`) for the app endpoint.
- App health is still strict: only HTTP `200` is healthy.
- Failed app probes use exponential backoff with:
  - `ENVIRONMENT_STATUS_FAILURE_THRESHOLD` consecutive failures required to confirm an outage
  - `ENVIRONMENT_STATUS_RETRY_INITIAL_DELAY_SECONDS` for the first retry delay
  - `ENVIRONMENT_STATUS_RETRY_BACKOFF_MULTIPLIER` for the backoff curve
  - `ENVIRONMENT_STATUS_RETRY_MAX_DELAY_SECONDS` as the delay cap
- Posts only on confirmed state transitions:
  - a down alert posts only after the configured failure threshold is reached in one cycle
  - repeated unhealthy checks stay quiet
  - recovery posts once when the endpoint returns HTTP `200` again
- First healthy observation only establishes baseline state; it does not post a recovery message.
- Rollout guidance:
  - Set `ENVIRONMENT_STATUS_CONNECTIVITY_PROBE_URL` before enabling environment monitoring.
  - Verify the probe URL is reachable from the Calypso runtime, for example with `curl https://<probe-host>/healthz`.
  - Re-enable environment monitoring after changing the target URL or probe configuration so the monitor starts from a clean baseline.

## Error Tracking Monitoring

- Runs as a background scheduler in the app runtime.
- Polls one configured Sentry or Rollbar project scope every `ERROR_TRACKING_POLL_INTERVAL_SECONDS` (default `300`).
- Provider is selected at runtime with `/calypso config error-tracking-provider:sentry|rollbar`.
- Sentry uses `ERROR_TRACKING_SENTRY_AUTH_TOKEN` and `ERROR_TRACKING_SENTRY_ORGANIZATION_SLUG`.
- Rollbar uses `ERROR_TRACKING_ROLLBAR_ACCESS_TOKEN`.
- First successful sync after enablement or project/environment scope change establishes baseline state and does not back-alert existing unresolved issues.
- Posts only on transitions:
  - first observation of a newly tracked unresolved issue posts one alert
  - repeated unresolved observations stay quiet
  - a resolved issue that reappears posts one regression alert
- `/calypso errors` lists unresolved tracked issues from Postgres for the active project/environment scope.

## Support Email Monitoring

- Runs as a background scheduler in the app runtime.
- Provider is selected at runtime with `/calypso config email-provider:gmail|outlook`.
- First enablement performs a one-time 7-day inbox backfill.
- Gmail mode requires OAuth refresh-token credentials plus a Pub/Sub topic for `users.watch`.
- Gmail push notifications update pending history, and Calypso also runs fallback history sync every `EMAIL_SYNC_FALLBACK_INTERVAL_MINUTES` (default `5`).
- Outlook mode uses Microsoft Graph with app credentials and polls the mailbox every `EMAIL_SYNC_FALLBACK_INTERVAL_MINUTES` (default `5`).
- New inbox threads create rows in `support_email_threads` with:
  - subject
  - first sender
  - first inbound message text
  - source provider
  - received timestamp
  - manual response state
- New queue items trigger an automatic notification in the configured email channel.
- If an unexpired on-call user is configured, Calypso appends `On call: <@USER>` on Slack notifications.
- Notification delivery is separate from ingestion, so a temporary post failure is retried without losing the email record.

## AI Drafting

- AI provider is selected at runtime with `/calypso config ai-provider:openai|anthropic`.
- OpenAI uses `AI_OPENAI_API_KEY` and `AI_OPENAI_MODEL`.
- Anthropic uses `AI_ANTHROPIC_API_KEY` and `AI_ANTHROPIC_MODEL`.
- `AI_SUPPORT_EMAIL_SYSTEM_PROMPT` can append organization-specific drafting guidance on top of Calypso's default support-email guardrails.
- Draft generation uses the first tracked inbound customer email plus optional operator instructions from `/calypso emails draft ...`.

## Testing

Run full test suite:

```bash
npm test
```

Current tests cover:

- Command parsing and routing.
- High-level command lifecycle flow.
- Config validation behavior.
- GitHub signature verification and webhook decision gates.
- DigitalOcean client request/response handling.
- Formatting behavior.

### Enforce PR Test Passes Before Merge

This repo includes GitHub Actions workflow `CI` (`.github/workflows/ci.yml`) that runs `npm test` on every PR to `main`.

To block merges when tests fail, enable branch protection on `main`:

1. GitHub repo -> `Settings` -> `Branches` -> add/edit protection rule for `main`.
2. Enable `Require status checks to pass before merging`.
3. Select required check: `CI / test`.
4. Save the rule.

## Local Validation Tips

- Offline-first validation is supported.
- Live smoke tests are optional and useful for final confidence:
  - Slack `/calypso ...` command flow in a real workspace.
  - GitHub webhook through ngrok/cloudflared.
  - Real DigitalOcean deploy trigger with test-safe app config.

## Security Notes

- Never commit `.env` or secrets.
- If secrets are exposed, rotate immediately.
- Keep `CODE_HOST_WEBHOOK_SECRET` and API tokens scoped and rotated periodically.
