const dotenv = require("dotenv");

dotenv.config({ quiet: true });

const COMMUNICATION_PROVIDERS = Object.freeze({
  slack: "slack",
  microsoftTeams: "microsoft_teams",
});
const CODE_HOST_PROVIDERS = Object.freeze({
  github: "github",
  bitbucket: "bitbucket",
});
const DEPLOY_PROVIDERS = Object.freeze({
  digitalocean: "digitalocean",
  aws: "aws",
});
const EMAIL_PROVIDERS = Object.freeze({
  gmail: "gmail",
  outlook: "outlook",
});
const AI_PROVIDERS = Object.freeze({
  openai: "openai",
  anthropic: "anthropic",
});
const ERROR_TRACKING_PROVIDERS = Object.freeze({
  sentry: "sentry",
  rollbar: "rollbar",
});
const DEFAULT_COMMUNICATION_PROVIDER = COMMUNICATION_PROVIDERS.slack;
const DEFAULT_CODE_HOST_PROVIDER = CODE_HOST_PROVIDERS.github;
const DEFAULT_DEPLOY_PROVIDER = DEPLOY_PROVIDERS.digitalocean;
const DEFAULT_EMAIL_PROVIDER = EMAIL_PROVIDERS.gmail;
const DEFAULT_AI_PROVIDER = AI_PROVIDERS.openai;
const DEFAULT_ERROR_TRACKING_PROVIDER = ERROR_TRACKING_PROVIDERS.sentry;
const DEFAULT_BOT_NAME = "Code Conductor";
const DEFAULT_CODE_HOST_OPEN_PR_SYNC_INTERVAL_HOURS = 24;
const DEFAULT_COMMUNICATION_COMMAND_PATH = "/communication/commands";
const DEFAULT_GITHUB_API_BASE_URL = "https://api.github.com";
const DEFAULT_BITBUCKET_API_BASE_URL = "https://api.bitbucket.org/2.0";
const DEFAULT_CODE_HOST_API_VERSION = "2022-11-28";
const DEFAULT_CODE_HOST_API_PAGE_SIZE = 100;
const DEFAULT_CODE_HOST_API_MAX_PAGES = 100;
const DEFAULT_CODE_HOST_API_USER_AGENT = "code-conductor-bot";
const DEFAULT_CODE_HOST_CODEX_USER_LOGINS = Object.freeze(["codex", "codex[bot]"]);
const DEFAULT_DEPLOY_REGION = "us-east-1";
const DEFAULT_CODEX_APPROVAL_POLL_INTERVAL_MINUTES = 5;
const DEFAULT_ENVIRONMENT_STATUS_POLL_INTERVAL_SECONDS = 60;
const DEFAULT_ENVIRONMENT_STATUS_TIMEOUT_SECONDS = 60;
const DEFAULT_ENVIRONMENT_STATUS_FAILURE_THRESHOLD = 3;
const DEFAULT_ENVIRONMENT_STATUS_RETRY_INITIAL_DELAY_SECONDS = 5;
const DEFAULT_ENVIRONMENT_STATUS_RETRY_BACKOFF_MULTIPLIER = 3;
const DEFAULT_ENVIRONMENT_STATUS_RETRY_MAX_DELAY_SECONDS = 45;
const DEFAULT_EMAIL_WATCH_RENEW_INTERVAL_HOURS = 24;
const DEFAULT_EMAIL_SYNC_FALLBACK_INTERVAL_MINUTES = 5;
const DEFAULT_AI_TIMEOUT_SECONDS = 30;
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const DEFAULT_ERROR_TRACKING_POLL_INTERVAL_SECONDS = 300;
const DEFAULT_ERROR_TRACKING_TIMEOUT_SECONDS = 15;
const DEFAULT_SENTRY_BASE_URL = "https://sentry.io";
const DEFAULT_ROLLBAR_BASE_URL = "https://api.rollbar.com";

function loadConfig() {
  const communicationProvider = readProviderSelection(
    "COMMUNICATION_PROVIDER",
    DEFAULT_COMMUNICATION_PROVIDER,
    Object.values(COMMUNICATION_PROVIDERS),
  );
  const codeHostProvider = readProviderSelection(
    "CODE_HOST_PROVIDER",
    DEFAULT_CODE_HOST_PROVIDER,
    Object.values(CODE_HOST_PROVIDERS),
  );
  const deployProvider = readProviderSelection(
    "DEPLOY_PROVIDER",
    DEFAULT_DEPLOY_PROVIDER,
    Object.values(DEPLOY_PROVIDERS),
  );
  const emailProvider = readProviderSelection(
    "EMAIL_PROVIDER",
    DEFAULT_EMAIL_PROVIDER,
    Object.values(EMAIL_PROVIDERS),
  );
  const aiProvider = readProviderSelection(
    "AI_PROVIDER",
    DEFAULT_AI_PROVIDER,
    Object.values(AI_PROVIDERS),
  );
  const errorTrackingProvider = readProviderSelection(
    "ERROR_TRACKING_PROVIDER",
    DEFAULT_ERROR_TRACKING_PROVIDER,
    Object.values(ERROR_TRACKING_PROVIDERS),
  );

  assertRequiredEnvironmentVariablesExist(
    buildRequiredEnvironmentVariables({ communicationProvider, codeHostProvider }),
  );

  const communicationBotToken = readCommunicationValue({
    communicationProvider,
    name: "COMMUNICATION_BOT_TOKEN",
  });
  const communicationAppToken = readCommunicationValue({
    communicationProvider,
    name: "COMMUNICATION_APP_TOKEN",
  });
  const communicationWebhookUrl = readOptionalEnvironmentValue("COMMUNICATION_WEBHOOK_URL");
  const communicationCommandPath =
    readOptionalEnvironmentValue("COMMUNICATION_COMMAND_PATH") ||
    DEFAULT_COMMUNICATION_COMMAND_PATH;
  const communicationAdminUserIds = readCommaSeparatedValues("COMMUNICATION_ADMIN_USER_IDS");
  const codeHostMainBranch = readCodeHostValue({
    codeHostProvider,
    name: "CODE_HOST_MAIN_BRANCH",
  });
  const codeHostRepository = readCodeHostValue({
    codeHostProvider,
    name: "CODE_HOST_REPOSITORY",
  });
  const codeHostWebhookSecret = readCodeHostValue({
    codeHostProvider,
    name: "CODE_HOST_WEBHOOK_SECRET",
  });
  const codeHostToken = readOptionalEnvironmentValue("CODE_HOST_TOKEN");
  const configuredCodexUserLogins = readCommaSeparatedValues("CODE_HOST_CODEX_USER_LOGINS");
  const codeHostCodexUserLogins =
    configuredCodexUserLogins.length > 0
      ? configuredCodexUserLogins
      : [...DEFAULT_CODE_HOST_CODEX_USER_LOGINS];
  const codeHostOpenPrSyncIntervalHours = readPositiveInteger(
    "CODE_HOST_OPEN_PR_SYNC_INTERVAL_HOURS",
    DEFAULT_CODE_HOST_OPEN_PR_SYNC_INTERVAL_HOURS,
  );
  const codexApprovalPollIntervalMinutes = readPositiveInteger(
    "CODEX_APPROVAL_POLL_INTERVAL_MINUTES",
    DEFAULT_CODEX_APPROVAL_POLL_INTERVAL_MINUTES,
  );
  const deployPollIntervalSeconds = readPositiveInteger(
    "DEPLOY_POLL_INTERVAL_SECONDS",
    10,
  );
  const deployTimeoutSeconds = readPositiveInteger(
    "DEPLOY_TIMEOUT_SECONDS",
    1200,
  );
  const deployToken = readOptionalEnvironmentValue("DEPLOY_TOKEN");
  const deployProductionAppId = readOptionalEnvironmentValue("DEPLOY_PROD_APP_ID");
  const deployStagingAppId = readOptionalEnvironmentValue("DEPLOY_STAGING_APP_ID");
  const deployRegion = readOptionalEnvironmentValue("DEPLOY_REGION") || DEFAULT_DEPLOY_REGION;
  const deployAccessKeyId = readOptionalEnvironmentValue("DEPLOY_ACCESS_KEY_ID");
  const deploySecretAccessKey = readOptionalEnvironmentValue("DEPLOY_SECRET_ACCESS_KEY");
  const deploySessionToken = readOptionalEnvironmentValue("DEPLOY_SESSION_TOKEN");
  const environmentStatusPollIntervalSeconds = readPositiveInteger(
    "ENVIRONMENT_STATUS_POLL_INTERVAL_SECONDS",
    DEFAULT_ENVIRONMENT_STATUS_POLL_INTERVAL_SECONDS,
  );
  const environmentStatusTimeoutSeconds = readPositiveInteger(
    "ENVIRONMENT_STATUS_TIMEOUT_SECONDS",
    DEFAULT_ENVIRONMENT_STATUS_TIMEOUT_SECONDS,
  );
  const environmentStatusFailureThreshold = readPositiveInteger(
    "ENVIRONMENT_STATUS_FAILURE_THRESHOLD",
    DEFAULT_ENVIRONMENT_STATUS_FAILURE_THRESHOLD,
  );
  const environmentStatusRetryInitialDelaySeconds = readPositiveInteger(
    "ENVIRONMENT_STATUS_RETRY_INITIAL_DELAY_SECONDS",
    DEFAULT_ENVIRONMENT_STATUS_RETRY_INITIAL_DELAY_SECONDS,
  );
  const environmentStatusRetryBackoffMultiplier = readPositiveInteger(
    "ENVIRONMENT_STATUS_RETRY_BACKOFF_MULTIPLIER",
    DEFAULT_ENVIRONMENT_STATUS_RETRY_BACKOFF_MULTIPLIER,
  );
  const environmentStatusRetryMaxDelaySeconds = readPositiveInteger(
    "ENVIRONMENT_STATUS_RETRY_MAX_DELAY_SECONDS",
    DEFAULT_ENVIRONMENT_STATUS_RETRY_MAX_DELAY_SECONDS,
  );
  const environmentStatusConnectivityProbeUrl = readOptionalHttpsUrl(
    "ENVIRONMENT_STATUS_CONNECTIVITY_PROBE_URL",
  );
  const emailGmailAddress = readOptionalEnvironmentValue("EMAIL_GMAIL_ADDRESS");
  const emailGmailClientId = readOptionalEnvironmentValue("EMAIL_GMAIL_CLIENT_ID");
  const emailGmailClientSecret = readOptionalEnvironmentValue("EMAIL_GMAIL_CLIENT_SECRET");
  const emailGmailRefreshToken = readOptionalEnvironmentValue("EMAIL_GMAIL_REFRESH_TOKEN");
  const emailGmailPubsubTopic = readOptionalEnvironmentValue("EMAIL_GMAIL_PUBSUB_TOPIC");
  const emailWebhookAudience = readOptionalEnvironmentValue("EMAIL_WEBHOOK_AUDIENCE");
  const emailPushServiceAccountEmail = readOptionalEnvironmentValue("EMAIL_PUSH_SERVICE_ACCOUNT_EMAIL");
  const emailOutlookAddress = readOptionalEnvironmentValue("EMAIL_OUTLOOK_ADDRESS");
  const emailOutlookTenantId = readOptionalEnvironmentValue("EMAIL_OUTLOOK_TENANT_ID");
  const emailOutlookClientId = readOptionalEnvironmentValue("EMAIL_OUTLOOK_CLIENT_ID");
  const emailOutlookClientSecret = readOptionalEnvironmentValue("EMAIL_OUTLOOK_CLIENT_SECRET");
  const emailWatchRenewIntervalHours = readPositiveInteger(
    "EMAIL_WATCH_RENEW_INTERVAL_HOURS",
    DEFAULT_EMAIL_WATCH_RENEW_INTERVAL_HOURS,
  );
  const emailSyncFallbackIntervalMinutes = readPositiveInteger(
    "EMAIL_SYNC_FALLBACK_INTERVAL_MINUTES",
    DEFAULT_EMAIL_SYNC_FALLBACK_INTERVAL_MINUTES,
  );
  const aiTimeoutSeconds = readPositiveInteger(
    "AI_TIMEOUT_SECONDS",
    DEFAULT_AI_TIMEOUT_SECONDS,
  );
  const aiOpenAiApiKey = readOptionalEnvironmentValue("AI_OPENAI_API_KEY");
  const aiOpenAiModel = readOptionalEnvironmentValue("AI_OPENAI_MODEL");
  const aiOpenAiBaseUrl =
    readOptionalEnvironmentValue("AI_OPENAI_BASE_URL") || DEFAULT_OPENAI_BASE_URL;
  const aiAnthropicApiKey = readOptionalEnvironmentValue("AI_ANTHROPIC_API_KEY");
  const aiAnthropicModel = readOptionalEnvironmentValue("AI_ANTHROPIC_MODEL");
  const aiAnthropicBaseUrl =
    readOptionalEnvironmentValue("AI_ANTHROPIC_BASE_URL") || DEFAULT_ANTHROPIC_BASE_URL;
  const aiSupportEmailSystemPrompt = readOptionalEnvironmentValue("AI_SUPPORT_EMAIL_SYSTEM_PROMPT");
  const errorTrackingPollIntervalSeconds = readPositiveInteger(
    "ERROR_TRACKING_POLL_INTERVAL_SECONDS",
    DEFAULT_ERROR_TRACKING_POLL_INTERVAL_SECONDS,
  );
  const errorTrackingTimeoutSeconds = readPositiveInteger(
    "ERROR_TRACKING_TIMEOUT_SECONDS",
    DEFAULT_ERROR_TRACKING_TIMEOUT_SECONDS,
  );
  const errorTrackingSentryBaseUrl =
    readOptionalEnvironmentValue("ERROR_TRACKING_SENTRY_BASE_URL") || DEFAULT_SENTRY_BASE_URL;
  const errorTrackingSentryAuthToken = readOptionalEnvironmentValue("ERROR_TRACKING_SENTRY_AUTH_TOKEN");
  const errorTrackingSentryOrganizationSlug = readOptionalEnvironmentValue(
    "ERROR_TRACKING_SENTRY_ORGANIZATION_SLUG",
  );
  const errorTrackingRollbarBaseUrl =
    readOptionalEnvironmentValue("ERROR_TRACKING_ROLLBAR_BASE_URL") || DEFAULT_ROLLBAR_BASE_URL;
  const errorTrackingRollbarAccessToken = readOptionalEnvironmentValue(
    "ERROR_TRACKING_ROLLBAR_ACCESS_TOKEN",
  );
  const botName = readOptionalEnvironmentValue("BOT_NAME") || DEFAULT_BOT_NAME;

  return {
    botName,
    communicationProvider,
    codeHostProvider,
    deployProvider,
    emailProvider,
    aiProvider,
    errorTrackingProvider,
    databaseUrl: readRequiredEnvironmentVariable("DATABASE_URL"),
    deployPollIntervalSeconds,
    deployTimeoutSeconds,
    deployToken,
    deployProductionAppId,
    deployStagingAppId,
    deployRegion,
    deployAccessKeyId,
    deploySecretAccessKey,
    deploySessionToken,
    environmentStatusPollIntervalSeconds,
    environmentStatusTimeoutSeconds,
    environmentStatusFailureThreshold,
    environmentStatusRetryInitialDelaySeconds,
    environmentStatusRetryBackoffMultiplier,
    environmentStatusRetryMaxDelaySeconds,
    environmentStatusConnectivityProbeUrl,
    codeHostOpenPrSyncIntervalHours,
    codexApprovalPollIntervalMinutes,
    codeHostApiBaseUrl: resolveCodeHostApiBaseUrl(codeHostProvider),
    codeHostApiVersion: DEFAULT_CODE_HOST_API_VERSION,
    codeHostApiPageSize: DEFAULT_CODE_HOST_API_PAGE_SIZE,
    codeHostApiMaxPages: DEFAULT_CODE_HOST_API_MAX_PAGES,
    codeHostApiUserAgent: DEFAULT_CODE_HOST_API_USER_AGENT,
    codeHostMainBranch,
    codeHostRepository,
    codeHostToken,
    codeHostCodexUserLogins,
    codeHostWebhookSecret,
    port: readPortNumber("PORT", 3001),
    communicationBotToken,
    communicationAppToken,
    communicationWebhookUrl,
    communicationCommandPath,
    communicationAdminUserIds,
    emailGmailAddress,
    emailGmailClientId,
    emailGmailClientSecret,
    emailGmailRefreshToken,
    emailGmailPubsubTopic,
    emailWebhookAudience,
    emailPushServiceAccountEmail,
    emailOutlookAddress,
    emailOutlookTenantId,
    emailOutlookClientId,
    emailOutlookClientSecret,
    emailWatchRenewIntervalHours,
    emailSyncFallbackIntervalMinutes,
    aiTimeoutSeconds,
    aiOpenAiApiKey,
    aiOpenAiModel,
    aiOpenAiBaseUrl,
    aiAnthropicApiKey,
    aiAnthropicModel,
    aiAnthropicBaseUrl,
    aiSupportEmailSystemPrompt,
    errorTrackingPollIntervalSeconds,
    errorTrackingTimeoutSeconds,
    errorTrackingSentryBaseUrl,
    errorTrackingSentryAuthToken,
    errorTrackingSentryOrganizationSlug,
    errorTrackingRollbarBaseUrl,
    errorTrackingRollbarAccessToken,
  };
}

function buildRequiredEnvironmentVariables({ communicationProvider, codeHostProvider }) {
  const requiredEnvironmentVariables = ["DATABASE_URL"];

  if (communicationProvider === COMMUNICATION_PROVIDERS.slack) {
    requiredEnvironmentVariables.push(
      "COMMUNICATION_BOT_TOKEN",
      "COMMUNICATION_APP_TOKEN",
    );
  }

  if (
    codeHostProvider === CODE_HOST_PROVIDERS.github ||
    codeHostProvider === CODE_HOST_PROVIDERS.bitbucket
  ) {
    requiredEnvironmentVariables.push(
      "CODE_HOST_WEBHOOK_SECRET",
      "CODE_HOST_REPOSITORY",
      "CODE_HOST_MAIN_BRANCH",
    );
  }

  return requiredEnvironmentVariables;
}

function assertRequiredEnvironmentVariablesExist(requiredNames) {
  const missingEnvironmentVariables = requiredNames.filter(
    (name) => readOptionalEnvironmentValue(name) === "",
  );

  if (missingEnvironmentVariables.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingEnvironmentVariables.join(", ")}`,
    );
  }
}

function readRequiredEnvironmentVariable(name) {
  const value = readOptionalEnvironmentValue(name);
  if (value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function readOptionalEnvironmentValue(name) {
  const value = process.env[name];
  return value ? value.trim() : "";
}

function readProviderSelection(name, fallback, supportedValues) {
  const rawValue = readOptionalEnvironmentValue(name);
  const selectedValue = rawValue === "" ? fallback : rawValue.toLowerCase();
  if (supportedValues.includes(selectedValue)) {
    return selectedValue;
  }

  throw new Error(
    `${name} must be one of: ${supportedValues.join(", ")}`,
  );
}

function readCommunicationValue({ communicationProvider, name }) {
  if (communicationProvider === COMMUNICATION_PROVIDERS.slack) {
    return readRequiredEnvironmentVariable(name);
  }

  return readOptionalEnvironmentValue(name);
}

function readCodeHostValue({ codeHostProvider, name }) {
  if (
    codeHostProvider === CODE_HOST_PROVIDERS.github ||
    codeHostProvider === CODE_HOST_PROVIDERS.bitbucket
  ) {
    return readRequiredEnvironmentVariable(name);
  }

  return readOptionalEnvironmentValue(name);
}

function readPortNumber(name, fallbackPort) {
  const value = readOptionalEnvironmentValue(name);
  if (value === "") {
    return fallbackPort;
  }

  const parsedPort = Number(value);
  const isValidPort = Number.isInteger(parsedPort) && parsedPort > 0;
  if (!isValidPort) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsedPort;
}

function readPositiveInteger(name, fallbackValue) {
  const value = readOptionalEnvironmentValue(name);
  if (value === "") {
    return fallbackValue;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function readOptionalHttpsUrl(name) {
  const value = readOptionalEnvironmentValue(name);
  if (value === "") {
    return "";
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(value);
  } catch (_error) {
    throw new Error(`${name} must be a valid HTTPS URL`);
  }

  if (parsedUrl.protocol !== "https:") {
    throw new Error(`${name} must be a valid HTTPS URL`);
  }

  return parsedUrl.toString();
}

function readCommaSeparatedValues(name) {
  const value = readOptionalEnvironmentValue(name);
  if (value === "") {
    return [];
  }

  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function resolveCodeHostApiBaseUrl(codeHostProvider) {
  if (codeHostProvider === CODE_HOST_PROVIDERS.bitbucket) {
    return DEFAULT_BITBUCKET_API_BASE_URL;
  }

  return DEFAULT_GITHUB_API_BASE_URL;
}

module.exports = {
  AI_PROVIDERS,
  CODE_HOST_PROVIDERS,
  COMMUNICATION_PROVIDERS,
  DEFAULT_AI_PROVIDER,
  DEFAULT_CODE_HOST_PROVIDER,
  DEFAULT_COMMUNICATION_PROVIDER,
  DEFAULT_DEPLOY_PROVIDER,
  DEFAULT_EMAIL_PROVIDER,
  DEFAULT_ERROR_TRACKING_PROVIDER,
  DEPLOY_PROVIDERS,
  EMAIL_PROVIDERS,
  ERROR_TRACKING_PROVIDERS,
  DEFAULT_GITHUB_API_BASE_URL,
  DEFAULT_BITBUCKET_API_BASE_URL,
  DEFAULT_CODE_HOST_API_MAX_PAGES,
  DEFAULT_CODE_HOST_API_PAGE_SIZE,
  DEFAULT_CODE_HOST_API_USER_AGENT,
  DEFAULT_CODE_HOST_API_VERSION,
  DEFAULT_CODE_HOST_CODEX_USER_LOGINS,
  DEFAULT_CODE_HOST_OPEN_PR_SYNC_INTERVAL_HOURS,
  DEFAULT_CODEX_APPROVAL_POLL_INTERVAL_MINUTES,
  DEFAULT_ENVIRONMENT_STATUS_FAILURE_THRESHOLD,
  DEFAULT_ANTHROPIC_BASE_URL,
  DEFAULT_AI_TIMEOUT_SECONDS,
  DEFAULT_COMMUNICATION_COMMAND_PATH,
  DEFAULT_BOT_NAME,
  DEFAULT_ENVIRONMENT_STATUS_RETRY_BACKOFF_MULTIPLIER,
  DEFAULT_ENVIRONMENT_STATUS_RETRY_INITIAL_DELAY_SECONDS,
  DEFAULT_ENVIRONMENT_STATUS_RETRY_MAX_DELAY_SECONDS,
  DEFAULT_ERROR_TRACKING_POLL_INTERVAL_SECONDS,
  DEFAULT_ERROR_TRACKING_TIMEOUT_SECONDS,
  DEFAULT_ROLLBAR_BASE_URL,
  DEFAULT_SENTRY_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
  resolveCodeHostApiBaseUrl,
  DEFAULT_DEPLOY_REGION,
  loadConfig,
};
