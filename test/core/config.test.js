const assert = require("node:assert/strict");
const test = require("node:test");

const {
  AI_PROVIDERS,
  CODE_HOST_PROVIDERS,
  COMMUNICATION_PROVIDERS,
  DEFAULT_AI_PROVIDER,
  DEFAULT_ANTHROPIC_BASE_URL,
  DEFAULT_AI_TIMEOUT_SECONDS,
  DEFAULT_CODE_HOST_PROVIDER,
  DEFAULT_COMMUNICATION_PROVIDER,
  DEFAULT_DEPLOY_PROVIDER,
  DEFAULT_EMAIL_PROVIDER,
  DEFAULT_ERROR_TRACKING_PROVIDER,
  DEFAULT_OPENAI_BASE_URL,
  DEPLOY_PROVIDERS,
  EMAIL_PROVIDERS,
  ERROR_TRACKING_PROVIDERS,
  loadConfig,
} = require("../../src/config");

const REQUIRED_ENV = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/conductor",
  CODE_HOST_MAIN_BRANCH: "main",
  CODE_HOST_REPOSITORY: "croft-eng/croft",
  CODE_HOST_WEBHOOK_SECRET: "secret",
  COMMUNICATION_APP_TOKEN: "xapp-test",
  COMMUNICATION_BOT_TOKEN: "xoxb-test",
};

test("loadConfig throws when required values are missing", { concurrency: false }, () => {
  withEnvironment(
    {
      DATABASE_URL: "",
      CODE_HOST_MAIN_BRANCH: "",
      CODE_HOST_REPOSITORY: "",
      CODE_HOST_WEBHOOK_SECRET: "",
      COMMUNICATION_APP_TOKEN: "",
      COMMUNICATION_BOT_TOKEN: "",
    },
    () => {
      assert.throws(
        () => loadConfig(),
        /Missing required environment variables: DATABASE_URL, COMMUNICATION_BOT_TOKEN, COMMUNICATION_APP_TOKEN, CODE_HOST_WEBHOOK_SECRET, CODE_HOST_REPOSITORY, CODE_HOST_MAIN_BRANCH/,
      );
    },
  );
});

test("loadConfig defaults provider selections", { concurrency: false }, () => {
  withEnvironment(
    {
      ...REQUIRED_ENV,
      COMMUNICATION_PROVIDER: undefined,
      CODE_HOST_PROVIDER: undefined,
      DEPLOY_PROVIDER: undefined,
      EMAIL_PROVIDER: undefined,
      AI_PROVIDER: undefined,
      BOT_NAME: undefined,
    },
    () => {
      const config = loadConfig();
      assert.equal(config.botName, "Code Conductor");
      assert.equal(config.communicationProvider, DEFAULT_COMMUNICATION_PROVIDER);
      assert.equal(config.codeHostProvider, DEFAULT_CODE_HOST_PROVIDER);
      assert.equal(config.deployProvider, DEFAULT_DEPLOY_PROVIDER);
      assert.equal(config.emailProvider, DEFAULT_EMAIL_PROVIDER);
      assert.equal(config.aiProvider, DEFAULT_AI_PROVIDER);
      assert.equal(config.errorTrackingProvider, DEFAULT_ERROR_TRACKING_PROVIDER);
    },
  );
});

test("loadConfig reads required and optional values", { concurrency: false }, () => {
  withEnvironment(
    {
      ...REQUIRED_ENV,
      COMMUNICATION_PROVIDER: "slack",
      CODE_HOST_PROVIDER: "github",
      DEPLOY_PROVIDER: "digitalocean",
      EMAIL_PROVIDER: "gmail",
      AI_PROVIDER: "openai",
      DEPLOY_POLL_INTERVAL_SECONDS: "15",
      DEPLOY_TIMEOUT_SECONDS: "900",
      DEPLOY_TOKEN: "  do-token  ",
      DEPLOY_PROD_APP_ID: "  app-id  ",
      DEPLOY_STAGING_APP_ID: "  staging-app-id  ",
      DEPLOY_REGION: " us-west-2 ",
      DEPLOY_ACCESS_KEY_ID: " AKIA123 ",
      DEPLOY_SECRET_ACCESS_KEY: " secret-123 ",
      DEPLOY_SESSION_TOKEN: " session-123 ",
      CODE_HOST_TOKEN: undefined,
      BOT_NAME: "  Voyager  ",
      PORT: "4100",
    },
    () => {
      const config = loadConfig();

      assert.equal(config.botName, "Voyager");
      assert.equal(config.communicationProvider, COMMUNICATION_PROVIDERS.slack);
      assert.equal(config.codeHostProvider, CODE_HOST_PROVIDERS.github);
      assert.equal(config.deployProvider, DEPLOY_PROVIDERS.digitalocean);
      assert.equal(config.emailProvider, EMAIL_PROVIDERS.gmail);
      assert.equal(config.aiProvider, AI_PROVIDERS.openai);
      assert.equal(config.errorTrackingProvider, ERROR_TRACKING_PROVIDERS.sentry);
      assert.equal(config.communicationBotToken, "xoxb-test");
      assert.equal(config.communicationAppToken, "xapp-test");
      assert.equal(config.communicationWebhookUrl, "");
      assert.equal(config.communicationCommandPath, "/communication/commands");
      assert.deepEqual(config.communicationAdminUserIds, []);
      assert.equal(config.databaseUrl, REQUIRED_ENV.DATABASE_URL);
      assert.equal(config.codeHostWebhookSecret, "secret");
      assert.equal(config.codeHostRepository, "croft-eng/croft");
      assert.equal(config.codeHostMainBranch, "main");
      assert.equal(config.codeHostToken, "");
      assert.deepEqual(config.codeHostCodexUserLogins, ["codex", "codex[bot]"]);
      assert.equal(config.codeHostOpenPrSyncIntervalHours, 24);
      assert.equal(config.codexApprovalPollIntervalMinutes, 5);
      assert.equal(config.codeHostApiBaseUrl, "https://api.github.com");
      assert.equal(config.codeHostApiVersion, "2022-11-28");
      assert.equal(config.codeHostApiPageSize, 100);
      assert.equal(config.codeHostApiMaxPages, 100);
      assert.equal(config.codeHostApiUserAgent, "code-conductor-bot");
      assert.equal(config.deployPollIntervalSeconds, 15);
      assert.equal(config.deployTimeoutSeconds, 900);
      assert.equal(config.deployToken, "do-token");
      assert.equal(config.deployProductionAppId, "app-id");
      assert.equal(config.deployStagingAppId, "staging-app-id");
      assert.equal(config.deployRegion, "us-west-2");
      assert.equal(config.deployAccessKeyId, "AKIA123");
      assert.equal(config.deploySecretAccessKey, "secret-123");
      assert.equal(config.deploySessionToken, "session-123");
      assert.equal(config.environmentStatusPollIntervalSeconds, 60);
      assert.equal(config.environmentStatusTimeoutSeconds, 60);
      assert.equal(config.environmentStatusFailureThreshold, 3);
      assert.equal(config.environmentStatusRetryInitialDelaySeconds, 5);
      assert.equal(config.environmentStatusRetryBackoffMultiplier, 3);
      assert.equal(config.environmentStatusRetryMaxDelaySeconds, 45);
      assert.equal(config.environmentStatusConnectivityProbeUrl, "");
      assert.equal(config.errorTrackingPollIntervalSeconds, 300);
      assert.equal(config.errorTrackingTimeoutSeconds, 15);
      assert.equal(config.errorTrackingSentryBaseUrl, "https://sentry.io");
      assert.equal(config.errorTrackingSentryAuthToken, "");
      assert.equal(config.errorTrackingSentryOrganizationSlug, "");
      assert.equal(config.errorTrackingRollbarBaseUrl, "https://api.rollbar.com");
      assert.equal(config.errorTrackingRollbarAccessToken, "");
      assert.equal(config.emailGmailAddress, "");
      assert.equal(config.emailGmailClientId, "");
      assert.equal(config.emailGmailClientSecret, "");
      assert.equal(config.emailGmailRefreshToken, "");
      assert.equal(config.emailGmailPubsubTopic, "");
      assert.equal(config.emailWebhookAudience, "");
      assert.equal(config.emailPushServiceAccountEmail, "");
      assert.equal(config.emailOutlookAddress, "");
      assert.equal(config.emailOutlookTenantId, "");
      assert.equal(config.emailOutlookClientId, "");
      assert.equal(config.emailOutlookClientSecret, "");
      assert.equal(config.emailWatchRenewIntervalHours, 24);
      assert.equal(config.emailSyncFallbackIntervalMinutes, 5);
      assert.equal(config.port, 4100);
    },
  );
});

test("loadConfig supports non-default provider selections without requiring unrelated provider env vars", { concurrency: false }, () => {
  withEnvironment(
    {
      DATABASE_URL: "postgresql://user:pass@localhost:5432/conductor",
      COMMUNICATION_PROVIDER: "microsoft_teams",
      CODE_HOST_PROVIDER: "bitbucket",
      DEPLOY_PROVIDER: "aws",
      EMAIL_PROVIDER: "outlook",
      AI_PROVIDER: "anthropic",
      ERROR_TRACKING_PROVIDER: "rollbar",
      CODE_HOST_MAIN_BRANCH: "main",
      CODE_HOST_REPOSITORY: "workspace/repo",
      CODE_HOST_WEBHOOK_SECRET: "secret",
      COMMUNICATION_APP_TOKEN: undefined,
      COMMUNICATION_BOT_TOKEN: undefined,
    },
    () => {
      const config = loadConfig();
      assert.equal(config.communicationProvider, COMMUNICATION_PROVIDERS.microsoftTeams);
      assert.equal(config.codeHostProvider, CODE_HOST_PROVIDERS.bitbucket);
      assert.equal(config.deployProvider, DEPLOY_PROVIDERS.aws);
      assert.equal(config.emailProvider, EMAIL_PROVIDERS.outlook);
      assert.equal(config.aiProvider, AI_PROVIDERS.anthropic);
      assert.equal(config.errorTrackingProvider, ERROR_TRACKING_PROVIDERS.rollbar);
      assert.equal(config.communicationBotToken, "");
      assert.equal(config.communicationAppToken, "");
      assert.equal(config.communicationWebhookUrl, "");
      assert.equal(config.communicationCommandPath, "/communication/commands");
      assert.deepEqual(config.communicationAdminUserIds, []);
      assert.equal(config.codeHostWebhookSecret, "secret");
      assert.equal(config.codeHostRepository, "workspace/repo");
      assert.equal(config.codeHostMainBranch, "main");
      assert.deepEqual(config.codeHostCodexUserLogins, ["codex", "codex[bot]"]);
    },
  );
});

test("loadConfig rejects unknown communication provider", { concurrency: false }, () => {
  withEnvironment(
    {
      ...REQUIRED_ENV,
      COMMUNICATION_PROVIDER: "irc",
    },
    () => {
      assert.throws(
        () => loadConfig(),
        /COMMUNICATION_PROVIDER must be one of: slack, microsoft_teams/,
      );
    },
  );
});

test("loadConfig rejects unknown code-host provider", { concurrency: false }, () => {
  withEnvironment(
    {
      ...REQUIRED_ENV,
      CODE_HOST_PROVIDER: "azure_devops",
    },
    () => {
      assert.throws(() => loadConfig(), /CODE_HOST_PROVIDER must be one of: github, bitbucket/);
    },
  );
});

test("loadConfig rejects unknown deploy provider", { concurrency: false }, () => {
  withEnvironment(
    {
      ...REQUIRED_ENV,
      DEPLOY_PROVIDER: "render",
    },
    () => {
      assert.throws(() => loadConfig(), /DEPLOY_PROVIDER must be one of: digitalocean, aws/);
    },
  );
});

test("loadConfig rejects unknown email provider", { concurrency: false }, () => {
  withEnvironment(
    {
      ...REQUIRED_ENV,
      EMAIL_PROVIDER: "zoho",
    },
    () => {
      assert.throws(
        () => loadConfig(),
        /EMAIL_PROVIDER must be one of: gmail, outlook/,
      );
    },
  );
});

test("loadConfig rejects unknown ai provider", { concurrency: false }, () => {
  withEnvironment(
    {
      ...REQUIRED_ENV,
      AI_PROVIDER: "gemini",
    },
    () => {
      assert.throws(
        () => loadConfig(),
        /AI_PROVIDER must be one of: openai, anthropic/,
      );
    },
  );
});

test("loadConfig rejects unknown error tracking provider", { concurrency: false }, () => {
  withEnvironment(
    {
      ...REQUIRED_ENV,
      ERROR_TRACKING_PROVIDER: "bugsnag",
    },
    () => {
      assert.throws(
        () => loadConfig(),
        /ERROR_TRACKING_PROVIDER must be one of: sentry, rollbar/,
      );
    },
  );
});

test("loadConfig uses defaults for optional values", { concurrency: false }, () => {
  withEnvironment(
    {
      ...REQUIRED_ENV,
      DEPLOY_POLL_INTERVAL_SECONDS: undefined,
      DEPLOY_TIMEOUT_SECONDS: undefined,
      DEPLOY_TOKEN: undefined,
      DEPLOY_PROD_APP_ID: undefined,
      DEPLOY_STAGING_APP_ID: undefined,
      DEPLOY_REGION: undefined,
      DEPLOY_ACCESS_KEY_ID: undefined,
      DEPLOY_SECRET_ACCESS_KEY: undefined,
      DEPLOY_SESSION_TOKEN: undefined,
      ENVIRONMENT_STATUS_POLL_INTERVAL_SECONDS: undefined,
      ENVIRONMENT_STATUS_TIMEOUT_SECONDS: undefined,
      EMAIL_PROVIDER: undefined,
      AI_PROVIDER: undefined,
      AI_TIMEOUT_SECONDS: undefined,
      AI_OPENAI_API_KEY: undefined,
      AI_OPENAI_MODEL: undefined,
      AI_OPENAI_BASE_URL: undefined,
      AI_ANTHROPIC_API_KEY: undefined,
      AI_ANTHROPIC_MODEL: undefined,
      AI_ANTHROPIC_BASE_URL: undefined,
      AI_SUPPORT_EMAIL_SYSTEM_PROMPT: undefined,
      ERROR_TRACKING_ROLLBAR_BASE_URL: undefined,
      ERROR_TRACKING_ROLLBAR_ACCESS_TOKEN: undefined,
      EMAIL_GMAIL_ADDRESS: undefined,
      EMAIL_GMAIL_CLIENT_ID: undefined,
      EMAIL_GMAIL_CLIENT_SECRET: undefined,
      EMAIL_GMAIL_REFRESH_TOKEN: undefined,
      EMAIL_GMAIL_PUBSUB_TOPIC: undefined,
      EMAIL_WEBHOOK_AUDIENCE: undefined,
      EMAIL_PUSH_SERVICE_ACCOUNT_EMAIL: undefined,
      EMAIL_OUTLOOK_ADDRESS: undefined,
      EMAIL_OUTLOOK_TENANT_ID: undefined,
      EMAIL_OUTLOOK_CLIENT_ID: undefined,
      EMAIL_OUTLOOK_CLIENT_SECRET: undefined,
      EMAIL_WATCH_RENEW_INTERVAL_HOURS: undefined,
      EMAIL_SYNC_FALLBACK_INTERVAL_MINUTES: undefined,
      CODE_HOST_TOKEN: undefined,
      PORT: undefined,
    },
    () => {
      const config = loadConfig();

      assert.equal(config.deployPollIntervalSeconds, 10);
      assert.equal(config.deployTimeoutSeconds, 1200);
      assert.equal(config.deployToken, "");
      assert.equal(config.deployProductionAppId, "");
      assert.equal(config.deployStagingAppId, "");
      assert.equal(config.deployRegion, "us-east-1");
      assert.equal(config.deployAccessKeyId, "");
      assert.equal(config.deploySecretAccessKey, "");
      assert.equal(config.deploySessionToken, "");
      assert.equal(config.environmentStatusPollIntervalSeconds, 60);
      assert.equal(config.environmentStatusTimeoutSeconds, 60);
      assert.equal(config.environmentStatusFailureThreshold, 3);
      assert.equal(config.environmentStatusRetryInitialDelaySeconds, 5);
      assert.equal(config.environmentStatusRetryBackoffMultiplier, 3);
      assert.equal(config.environmentStatusRetryMaxDelaySeconds, 45);
      assert.equal(config.environmentStatusConnectivityProbeUrl, "");
      assert.equal(config.errorTrackingPollIntervalSeconds, 300);
      assert.equal(config.errorTrackingTimeoutSeconds, 15);
      assert.equal(config.errorTrackingSentryBaseUrl, "https://sentry.io");
      assert.equal(config.errorTrackingSentryAuthToken, "");
      assert.equal(config.errorTrackingSentryOrganizationSlug, "");
      assert.equal(config.errorTrackingRollbarBaseUrl, "https://api.rollbar.com");
      assert.equal(config.errorTrackingRollbarAccessToken, "");
      assert.equal(config.emailProvider, DEFAULT_EMAIL_PROVIDER);
      assert.equal(config.aiProvider, DEFAULT_AI_PROVIDER);
      assert.equal(config.aiTimeoutSeconds, DEFAULT_AI_TIMEOUT_SECONDS);
      assert.equal(config.aiOpenAiApiKey, "");
      assert.equal(config.aiOpenAiModel, "");
      assert.equal(config.aiOpenAiBaseUrl, DEFAULT_OPENAI_BASE_URL);
      assert.equal(config.aiAnthropicApiKey, "");
      assert.equal(config.aiAnthropicModel, "");
      assert.equal(config.aiAnthropicBaseUrl, DEFAULT_ANTHROPIC_BASE_URL);
      assert.equal(config.aiSupportEmailSystemPrompt, "");
      assert.equal(config.emailGmailAddress, "");
      assert.equal(config.emailGmailClientId, "");
      assert.equal(config.emailGmailClientSecret, "");
      assert.equal(config.emailGmailRefreshToken, "");
      assert.equal(config.emailGmailPubsubTopic, "");
      assert.equal(config.emailWebhookAudience, "");
      assert.equal(config.emailPushServiceAccountEmail, "");
      assert.equal(config.emailOutlookAddress, "");
      assert.equal(config.emailOutlookTenantId, "");
      assert.equal(config.emailOutlookClientId, "");
      assert.equal(config.emailOutlookClientSecret, "");
      assert.equal(config.emailWatchRenewIntervalHours, 24);
      assert.equal(config.emailSyncFallbackIntervalMinutes, 5);
      assert.equal(config.codeHostToken, "");
      assert.deepEqual(config.codeHostCodexUserLogins, ["codex", "codex[bot]"]);
      assert.equal(config.communicationWebhookUrl, "");
      assert.equal(config.communicationCommandPath, "/communication/commands");
      assert.deepEqual(config.communicationAdminUserIds, []);
      assert.equal(config.codeHostOpenPrSyncIntervalHours, 24);
      assert.equal(config.codexApprovalPollIntervalMinutes, 5);
      assert.equal(config.codeHostApiBaseUrl, "https://api.github.com");
      assert.equal(config.codeHostApiVersion, "2022-11-28");
      assert.equal(config.codeHostApiPageSize, 100);
      assert.equal(config.codeHostApiMaxPages, 100);
      assert.equal(config.codeHostApiUserAgent, "code-conductor-bot");
      assert.equal(config.port, 3001);
    },
  );
});

test("loadConfig rejects invalid port", { concurrency: false }, () => {
  withEnvironment(
    {
      ...REQUIRED_ENV,
      PORT: "not-a-number",
    },
    () => {
      assert.throws(() => loadConfig(), /PORT must be a positive integer/);
    },
  );
});

test("loadConfig rejects invalid DO polling values", { concurrency: false }, () => {
  withEnvironment(
    {
      ...REQUIRED_ENV,
      DEPLOY_POLL_INTERVAL_SECONDS: "-1",
    },
    () => {
      assert.throws(
        () => loadConfig(),
        /DEPLOY_POLL_INTERVAL_SECONDS must be a positive integer/,
      );
    },
  );
});

test("loadConfig reads GitHub sync optional values", { concurrency: false }, () => {
  withEnvironment(
    {
      ...REQUIRED_ENV,
      CODE_HOST_TOKEN: "  ghp-token  ",
      CODE_HOST_CODEX_USER_LOGINS: " codex-bot , codex[bot] ",
      CODE_HOST_OPEN_PR_SYNC_INTERVAL_HOURS: "12",
      CODEX_APPROVAL_POLL_INTERVAL_MINUTES: "7",
    },
    () => {
      const config = loadConfig();
      assert.equal(config.codeHostToken, "ghp-token");
      assert.deepEqual(config.codeHostCodexUserLogins, ["codex-bot", "codex[bot]"]);
      assert.equal(config.codeHostOpenPrSyncIntervalHours, 12);
      assert.equal(config.codexApprovalPollIntervalMinutes, 7);
    },
  );
});

test("loadConfig rejects invalid GitHub sync interval", { concurrency: false }, () => {
  withEnvironment(
    {
      ...REQUIRED_ENV,
      CODE_HOST_OPEN_PR_SYNC_INTERVAL_HOURS: "0",
    },
    () => {
      assert.throws(
        () => loadConfig(),
        /CODE_HOST_OPEN_PR_SYNC_INTERVAL_HOURS must be a positive integer/,
      );
    },
  );
});

test("loadConfig rejects invalid codex approval poll interval", { concurrency: false }, () => {
  withEnvironment(
    {
      ...REQUIRED_ENV,
      CODEX_APPROVAL_POLL_INTERVAL_MINUTES: "0",
    },
    () => {
      assert.throws(
        () => loadConfig(),
        /CODEX_APPROVAL_POLL_INTERVAL_MINUTES must be a positive integer/,
      );
    },
  );
});

test("loadConfig reads microsoft teams optional communication values", { concurrency: false }, () => {
  withEnvironment(
    {
      ...REQUIRED_ENV,
      COMMUNICATION_WEBHOOK_URL: "  https://example.test/hook  ",
      COMMUNICATION_COMMAND_PATH: " teams/conductor ",
      COMMUNICATION_ADMIN_USER_IDS: " U1 ,U2, U3 ",
    },
    () => {
      const config = loadConfig();
      assert.equal(config.communicationWebhookUrl, "https://example.test/hook");
      assert.equal(config.communicationCommandPath, "teams/conductor");
      assert.deepEqual(config.communicationAdminUserIds, ["U1", "U2", "U3"]);
    },
  );
});

test("loadConfig reads optional environment status and email polling values", { concurrency: false }, () => {
  withEnvironment(
    {
      ...REQUIRED_ENV,
      ENVIRONMENT_STATUS_POLL_INTERVAL_SECONDS: "30",
      ENVIRONMENT_STATUS_TIMEOUT_SECONDS: "8",
      ENVIRONMENT_STATUS_FAILURE_THRESHOLD: "4",
      ENVIRONMENT_STATUS_RETRY_INITIAL_DELAY_SECONDS: "6",
      ENVIRONMENT_STATUS_RETRY_BACKOFF_MULTIPLIER: "4",
      ENVIRONMENT_STATUS_RETRY_MAX_DELAY_SECONDS: "40",
      ENVIRONMENT_STATUS_CONNECTIVITY_PROBE_URL: " https://status-probe.example.com/ok ",
      ERROR_TRACKING_POLL_INTERVAL_SECONDS: "120",
      ERROR_TRACKING_TIMEOUT_SECONDS: "11",
      ERROR_TRACKING_SENTRY_BASE_URL: " https://sentry.example.com ",
      ERROR_TRACKING_SENTRY_AUTH_TOKEN: " sentry-token ",
      ERROR_TRACKING_SENTRY_ORGANIZATION_SLUG: " acme ",
      AI_TIMEOUT_SECONDS: "45",
      AI_OPENAI_API_KEY: " openai-key ",
      AI_OPENAI_MODEL: " gpt-4.1-mini ",
      AI_OPENAI_BASE_URL: " https://openai.example.com/v1 ",
      AI_SUPPORT_EMAIL_SYSTEM_PROMPT: " Keep replies concise. ",
      EMAIL_GMAIL_ADDRESS: " support@example.com ",
      EMAIL_GMAIL_CLIENT_ID: " gmail-client-id ",
      EMAIL_GMAIL_CLIENT_SECRET: " gmail-client-secret ",
      EMAIL_GMAIL_REFRESH_TOKEN: " gmail-refresh-token ",
      EMAIL_GMAIL_PUBSUB_TOPIC: " projects/test/topics/conductor-support ",
      EMAIL_WEBHOOK_AUDIENCE: " https://example.com/email/webhook ",
      EMAIL_PUSH_SERVICE_ACCOUNT_EMAIL: " pubsub@example.iam.gserviceaccount.com ",
      EMAIL_WATCH_RENEW_INTERVAL_HOURS: "12",
      EMAIL_SYNC_FALLBACK_INTERVAL_MINUTES: "9",
    },
    () => {
      const config = loadConfig();
      assert.equal(config.environmentStatusPollIntervalSeconds, 30);
      assert.equal(config.environmentStatusTimeoutSeconds, 8);
      assert.equal(config.environmentStatusFailureThreshold, 4);
      assert.equal(config.environmentStatusRetryInitialDelaySeconds, 6);
      assert.equal(config.environmentStatusRetryBackoffMultiplier, 4);
      assert.equal(config.environmentStatusRetryMaxDelaySeconds, 40);
      assert.equal(
        config.environmentStatusConnectivityProbeUrl,
        "https://status-probe.example.com/ok",
      );
      assert.equal(config.errorTrackingPollIntervalSeconds, 120);
      assert.equal(config.errorTrackingTimeoutSeconds, 11);
      assert.equal(config.errorTrackingSentryBaseUrl, "https://sentry.example.com");
      assert.equal(config.errorTrackingSentryAuthToken, "sentry-token");
      assert.equal(config.errorTrackingSentryOrganizationSlug, "acme");
      assert.equal(config.aiTimeoutSeconds, 45);
      assert.equal(config.aiOpenAiApiKey, "openai-key");
      assert.equal(config.aiOpenAiModel, "gpt-4.1-mini");
      assert.equal(config.aiOpenAiBaseUrl, "https://openai.example.com/v1");
      assert.equal(config.aiSupportEmailSystemPrompt, "Keep replies concise.");
      assert.equal(config.emailGmailAddress, "support@example.com");
      assert.equal(config.emailGmailClientId, "gmail-client-id");
      assert.equal(config.emailGmailClientSecret, "gmail-client-secret");
      assert.equal(config.emailGmailRefreshToken, "gmail-refresh-token");
      assert.equal(config.emailGmailPubsubTopic, "projects/test/topics/conductor-support");
      assert.equal(config.emailWebhookAudience, "https://example.com/email/webhook");
      assert.equal(
        config.emailPushServiceAccountEmail,
        "pubsub@example.iam.gserviceaccount.com",
      );
      assert.equal(config.emailWatchRenewIntervalHours, 12);
      assert.equal(config.emailSyncFallbackIntervalMinutes, 9);
    },
  );
});

test("loadConfig reads optional outlook and rollbar values", { concurrency: false }, () => {
  withEnvironment(
    {
      ...REQUIRED_ENV,
      EMAIL_PROVIDER: "outlook",
      AI_PROVIDER: "anthropic",
      ERROR_TRACKING_PROVIDER: "rollbar",
      AI_ANTHROPIC_API_KEY: " anthropic-key ",
      AI_ANTHROPIC_MODEL: " claude-3-7-sonnet ",
      AI_ANTHROPIC_BASE_URL: " https://anthropic.example.com ",
      ERROR_TRACKING_ROLLBAR_BASE_URL: " https://api.rollbar.example.com ",
      ERROR_TRACKING_ROLLBAR_ACCESS_TOKEN: " rollbar-token ",
      EMAIL_OUTLOOK_ADDRESS: " support@example.com ",
      EMAIL_OUTLOOK_TENANT_ID: " tenant-id ",
      EMAIL_OUTLOOK_CLIENT_ID: " outlook-client-id ",
      EMAIL_OUTLOOK_CLIENT_SECRET: " outlook-client-secret ",
    },
    () => {
      const config = loadConfig();
      assert.equal(config.emailProvider, EMAIL_PROVIDERS.outlook);
      assert.equal(config.aiProvider, AI_PROVIDERS.anthropic);
      assert.equal(config.errorTrackingProvider, ERROR_TRACKING_PROVIDERS.rollbar);
      assert.equal(config.aiAnthropicApiKey, "anthropic-key");
      assert.equal(config.aiAnthropicModel, "claude-3-7-sonnet");
      assert.equal(config.aiAnthropicBaseUrl, "https://anthropic.example.com");
      assert.equal(config.errorTrackingRollbarBaseUrl, "https://api.rollbar.example.com");
      assert.equal(config.errorTrackingRollbarAccessToken, "rollbar-token");
      assert.equal(config.emailOutlookAddress, "support@example.com");
      assert.equal(config.emailOutlookTenantId, "tenant-id");
      assert.equal(config.emailOutlookClientId, "outlook-client-id");
      assert.equal(config.emailOutlookClientSecret, "outlook-client-secret");
    },
  );
});

test("loadConfig rejects invalid environment status connectivity probe url", { concurrency: false }, () => {
  withEnvironment(
    {
      ...REQUIRED_ENV,
      ENVIRONMENT_STATUS_CONNECTIVITY_PROBE_URL: "http://status-probe.example.com",
    },
    () => {
      assert.throws(
        () => loadConfig(),
        /ENVIRONMENT_STATUS_CONNECTIVITY_PROBE_URL must be a valid HTTPS URL/,
      );
    },
  );
});

function withEnvironment(overrides, fn) {
  const originalEnvironment = process.env;
  process.env = { ...originalEnvironment };
  const managedEnvironmentKeys = [
    "DATABASE_URL",
    "COMMUNICATION_PROVIDER",
    "CODE_HOST_PROVIDER",
    "DEPLOY_PROVIDER",
    "EMAIL_PROVIDER",
    "AI_PROVIDER",
    "COMMUNICATION_BOT_TOKEN",
    "COMMUNICATION_APP_TOKEN",
    "COMMUNICATION_WEBHOOK_URL",
    "COMMUNICATION_COMMAND_PATH",
    "COMMUNICATION_ADMIN_USER_IDS",
    "CODE_HOST_WEBHOOK_SECRET",
    "CODE_HOST_REPOSITORY",
    "CODE_HOST_MAIN_BRANCH",
    "CODE_HOST_TOKEN",
    "CODE_HOST_CODEX_USER_LOGINS",
    "CODE_HOST_OPEN_PR_SYNC_INTERVAL_HOURS",
    "CODEX_APPROVAL_POLL_INTERVAL_MINUTES",
    "ERROR_TRACKING_PROVIDER",
    "AI_TIMEOUT_SECONDS",
    "AI_OPENAI_API_KEY",
    "AI_OPENAI_MODEL",
    "AI_OPENAI_BASE_URL",
    "AI_ANTHROPIC_API_KEY",
    "AI_ANTHROPIC_MODEL",
    "AI_ANTHROPIC_BASE_URL",
    "AI_SUPPORT_EMAIL_SYSTEM_PROMPT",
    "ERROR_TRACKING_POLL_INTERVAL_SECONDS",
    "ERROR_TRACKING_TIMEOUT_SECONDS",
    "ERROR_TRACKING_SENTRY_BASE_URL",
    "ERROR_TRACKING_SENTRY_AUTH_TOKEN",
    "ERROR_TRACKING_SENTRY_ORGANIZATION_SLUG",
    "ERROR_TRACKING_ROLLBAR_BASE_URL",
    "ERROR_TRACKING_ROLLBAR_ACCESS_TOKEN",
    "ENVIRONMENT_STATUS_POLL_INTERVAL_SECONDS",
    "ENVIRONMENT_STATUS_TIMEOUT_SECONDS",
    "ENVIRONMENT_STATUS_FAILURE_THRESHOLD",
    "ENVIRONMENT_STATUS_RETRY_INITIAL_DELAY_SECONDS",
    "ENVIRONMENT_STATUS_RETRY_BACKOFF_MULTIPLIER",
    "ENVIRONMENT_STATUS_RETRY_MAX_DELAY_SECONDS",
    "ENVIRONMENT_STATUS_CONNECTIVITY_PROBE_URL",
    "EMAIL_GMAIL_ADDRESS",
    "EMAIL_GMAIL_CLIENT_ID",
    "EMAIL_GMAIL_CLIENT_SECRET",
    "EMAIL_GMAIL_REFRESH_TOKEN",
    "EMAIL_GMAIL_PUBSUB_TOPIC",
    "EMAIL_WEBHOOK_AUDIENCE",
    "EMAIL_PUSH_SERVICE_ACCOUNT_EMAIL",
    "EMAIL_OUTLOOK_ADDRESS",
    "EMAIL_OUTLOOK_TENANT_ID",
    "EMAIL_OUTLOOK_CLIENT_ID",
    "EMAIL_OUTLOOK_CLIENT_SECRET",
    "EMAIL_WATCH_RENEW_INTERVAL_HOURS",
    "EMAIL_SYNC_FALLBACK_INTERVAL_MINUTES",
    "DEPLOY_POLL_INTERVAL_SECONDS",
    "DEPLOY_TIMEOUT_SECONDS",
    "DEPLOY_TOKEN",
    "DEPLOY_PROD_APP_ID",
    "DEPLOY_STAGING_APP_ID",
    "DEPLOY_REGION",
    "DEPLOY_ACCESS_KEY_ID",
    "DEPLOY_SECRET_ACCESS_KEY",
    "DEPLOY_SESSION_TOKEN",
    "BOT_NAME",
    "PORT",
  ];
  for (const key of managedEnvironmentKeys) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    fn();
  } finally {
    process.env = originalEnvironment;
  }
}
