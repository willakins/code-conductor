const express = require("express");

const { DEFAULT_BOT_NAME, loadConfig, resolveCodeHostApiBaseUrl } = require("./config");
const {
  createPool,
  getRuntimeProviderConfig,
  runMigrations,
  upsertPendingSupportEmailHistoryId,
  verifyConnection,
} = require("./db");
const {
  runOpenPullRequestSyncTick,
  startOpenPullRequestSyncScheduler,
} = require("./background_jobs/scheduler");
const {
  startCodexApprovalSyncScheduler,
} = require("./background_jobs/codex_approval_scheduler");
const {
  startEnvironmentStatusScheduler,
} = require("./background_jobs/environment_status_scheduler");
const {
  startErrorTrackingScheduler,
} = require("./background_jobs/error_tracking_scheduler");
const {
  startSupportEmailScheduler,
} = require("./background_jobs/support_email_scheduler");
const { createCodeHostPlatform } = require("./platform/code_host/factory");
const { createCommunicationPlatform } = require("./platform/communication/factory");
const { createDeployPlatform } = require("./platform/deploy/factory");
const { createEmailPlatform } = require("./platform/email/factory");
const { createErrorTrackingPlatform } = require("./platform/error_tracking/factory");
const { createAiPlatform } = require("./platform/ai/factory");
const { startReviewRecapScheduler } = require("./background_jobs/review_recap_scheduler");
const { createDoctorDiagnosticsFn } = require("./commands/services/doctor_diagnostics");

async function start() {
  const runtime = await loadRuntime();

  wireHealthcheckRoute(runtime);
  wireCommunicationCommands(runtime);
  wireCommunicationRoutes(runtime);
  wireCodeHostWebhook(runtime);
  wireEmailWebhook(runtime);

  await startServices(runtime);
  startBackgroundSchedulers(runtime);

  console.log(`${runtime.config.botName} is running with database migrations applied.`);
}

async function loadRuntime() {
  const baseConfig = loadConfig();
  const pool = createPool(baseConfig.databaseUrl);
  const httpApp = express();
  await initializeDatabase(pool);
  const config = await applyRuntimeProviderSelection({
    baseConfig,
    pool,
  });

  const communicationPlatform = createCommunicationPlatform({
    provider: config.communicationProvider,
    config,
  });
  const codeHostPlatform = createCodeHostPlatform({
    provider: config.codeHostProvider,
    config,
  });
  const deployPlatform = createDeployPlatform({
    provider: config.deployProvider,
    config,
  });
  const codeHostSyncClient = codeHostPlatform.createSyncClient();

  return {
    config,
    communicationPlatform,
    codeHostPlatform,
    codeHostSyncClient,
    deployPlatform,
    httpApp,
    pool,
  };
}

async function applyRuntimeProviderSelection({ baseConfig, pool }) {
  const runtimeProviderConfig = await getRuntimeProviderConfig(pool);
  return {
    ...baseConfig,
    communicationProvider:
      runtimeProviderConfig.communicationProvider || baseConfig.communicationProvider,
    codeHostProvider: runtimeProviderConfig.codeHostProvider || baseConfig.codeHostProvider,
    deployProvider: runtimeProviderConfig.deployProvider || baseConfig.deployProvider,
    emailProvider: runtimeProviderConfig.emailProvider || baseConfig.emailProvider,
    aiProvider: runtimeProviderConfig.aiProvider || baseConfig.aiProvider,
    errorTrackingProvider:
      runtimeProviderConfig.errorTrackingProvider || baseConfig.errorTrackingProvider,
  };
}

async function initializeDatabase(pool) {
  await verifyConnection(pool);
  await runMigrations(pool);
}

function wireCommunicationCommands(runtime) {
  const dynamicDeployFunctions = buildDynamicDeployFunctions(runtime);

  runtime.communicationPlatform.registerCalypsoCommand({
    botName: runtime.config.botName,
    enableDeploymentCompletionNotifications: true,
    enableGateControl: true,
    getRuntimeProviderConfigFn: getRuntimeProviderConfig,
    communicationProvider: runtime.config.communicationProvider,
    errorTrackingProvider: runtime.config.errorTrackingProvider,
    aiProvider: runtime.config.aiProvider,
    aiSupportEmailSystemPrompt: runtime.config.aiSupportEmailSystemPrompt,
    pool: runtime.pool,
    deployPlatform: runtime.deployPlatform,
    isWorkspaceAdminFn: async (_communicationClient, userId) =>
      runtime.communicationPlatform.isWorkspaceAdmin(userId),
    deployConfig: buildDeployConfig(runtime.config),
    resolveAiClientFn: buildResolveAiClientFn(runtime),
    resolveEmailClientByProviderFn: buildResolveEmailClientByProviderFn(runtime),
    triggerProdDeployFn: dynamicDeployFunctions.triggerProdDeployFn,
    waitForProdDeployCompletionFn: dynamicDeployFunctions.waitForProdDeployCompletionFn,
    resolveUserDisplayNameFn: async (_communicationClient, userId) =>
      runtime.communicationPlatform.resolveUserDisplayName(userId),
    runOpenPullRequestSyncNowFn: buildRunOpenPullRequestSyncNow(runtime),
    runDoctorDiagnosticsFn: createDoctorDiagnosticsFn(runtime),
  });
}

function wireHealthcheckRoute(runtime) {
  runtime.httpApp.get("/healthz", (_request, response) => {
    response.status(200).json({ ok: true });
  });
}

function wireCommunicationRoutes(runtime) {
  if (typeof runtime.communicationPlatform.registerHttpRoutes === "function") {
    runtime.communicationPlatform.registerHttpRoutes(runtime.httpApp);
  }
}

function buildDeployConfig(config) {
  return {
    deployProvider: config.deployProvider,
    deploymentPollIntervalMs: config.deployPollIntervalSeconds * 1000,
    deploymentTimeoutMs: config.deployTimeoutSeconds * 1000,
    deployToken: config.deployToken,
    deployProductionAppId: config.deployProductionAppId,
    deployStagingAppId: config.deployStagingAppId,
    deployRegion: config.deployRegion,
    deployAccessKeyId: config.deployAccessKeyId,
    deploySecretAccessKey: config.deploySecretAccessKey,
    deploySessionToken: config.deploySessionToken,
  };
}

function wireCodeHostWebhook(runtime) {
  runtime.codeHostPlatform.registerWebhookRoutes(runtime.httpApp, {
    pool: runtime.pool,
  });
}

function wireEmailWebhook(runtime) {
  for (const provider of ["gmail", "outlook"]) {
    const emailPlatform = createEmailPlatform({
      provider,
      config: runtime.config,
    });
    emailPlatform.registerWebhookRoutes(runtime.httpApp, {
      pool: runtime.pool,
      upsertPendingSupportEmailHistoryIdFn: upsertPendingSupportEmailHistoryId,
    });
  }
}

async function startServices(runtime) {
  await startHttpServer(runtime.httpApp, runtime.config.port, {
    codeHostProvider: runtime.config.codeHostProvider,
  });
  await runtime.communicationPlatform.start();
}

function startBackgroundSchedulers(runtime) {
  runtime.reviewRecapScheduler = startReviewRecapScheduler({
    communicationClient: runtime.communicationPlatform,
    pool: runtime.pool,
  });

  runtime.openPullRequestSyncScheduler = startOpenPullRequestSyncScheduler({
    codeHostClient: runtime.codeHostSyncClient,
    mainBranch: runtime.config.codeHostMainBranch,
    pool: runtime.pool,
    repository: runtime.config.codeHostRepository,
    syncIntervalMs: runtime.config.codeHostOpenPrSyncIntervalHours * 60 * 60 * 1000,
  });

  runtime.codexApprovalSyncScheduler = startCodexApprovalSyncScheduler({
    codeHostClient: runtime.codeHostSyncClient,
    mainBranch: runtime.config.codeHostMainBranch,
    pool: runtime.pool,
    repository: runtime.config.codeHostRepository,
    syncIntervalMs: runtime.config.codexApprovalPollIntervalMinutes * 60 * 1000,
  });

  runtime.environmentStatusScheduler = startEnvironmentStatusScheduler({
    communicationClient: runtime.communicationPlatform,
    connectivityProbeUrl: runtime.config.environmentStatusConnectivityProbeUrl,
    environmentStatusFailureThreshold: runtime.config.environmentStatusFailureThreshold,
    environmentStatusRetryBackoffMultiplier:
      runtime.config.environmentStatusRetryBackoffMultiplier,
    environmentStatusRetryInitialDelayMs:
      runtime.config.environmentStatusRetryInitialDelaySeconds * 1000,
    environmentStatusRetryMaxDelayMs:
      runtime.config.environmentStatusRetryMaxDelaySeconds * 1000,
    environmentStatusTimeoutMs: runtime.config.environmentStatusTimeoutSeconds * 1000,
    pool: runtime.pool,
    tickIntervalMs: runtime.config.environmentStatusPollIntervalSeconds * 1000,
  });

  runtime.errorTrackingScheduler = startErrorTrackingScheduler({
    communicationClient: runtime.communicationPlatform,
    errorTrackingTimeoutMs: runtime.config.errorTrackingTimeoutSeconds * 1000,
    pool: runtime.pool,
    resolveErrorTrackingContextFn: async () => {
      const errorTrackingProvider = await resolveErrorTrackingProvider(runtime);
      const errorTrackingPlatform = createErrorTrackingPlatform({
        provider: errorTrackingProvider,
        config: runtime.config,
      });
      return {
        errorTrackingClient: errorTrackingPlatform.createIssueClient(),
        errorTrackingProvider,
      };
    },
    tickIntervalMs: runtime.config.errorTrackingPollIntervalSeconds * 1000,
  });

  runtime.supportEmailScheduler = startSupportEmailScheduler({
    communicationClient: runtime.communicationPlatform,
    emailSyncFallbackIntervalMs: runtime.config.emailSyncFallbackIntervalMinutes * 60 * 1000,
    emailWatchRenewIntervalMs: runtime.config.emailWatchRenewIntervalHours * 60 * 60 * 1000,
    pool: runtime.pool,
    resolveEmailClientFn: async () => {
      const emailProvider = await resolveEmailProvider(runtime);
      const emailPlatform = createEmailPlatform({
        provider: emailProvider,
        config: runtime.config,
      });
      return {
        emailClient: emailPlatform.createEmailClient(),
        emailProvider,
      };
    },
  });
}

function buildRunOpenPullRequestSyncNow(runtime) {
  return async () => {
    const codeHostProvider = await resolveCodeHostProviderForCommand(runtime);
    const codeHostPlatform = createCodeHostPlatform({
      provider: codeHostProvider,
      config: buildRuntimeCodeHostConfig(runtime, codeHostProvider),
    });
    const codeHostClient = codeHostPlatform.createSyncClient();
    if (!codeHostClient) {
      return {
        unavailableReason: "Sync unavailable: configure `CODE_HOST_TOKEN`.",
      };
    }

    return runOpenPullRequestSyncTick({
      codeHostClient,
      logger: console,
      mainBranch: runtime.config.codeHostMainBranch,
      pool: runtime.pool,
      repository: runtime.config.codeHostRepository,
      swallowErrors: false,
    });
  };
}

function buildDynamicDeployFunctions(runtime) {
  return {
    triggerProdDeployFn: async (deployConfig) => {
      const deployProvider = await resolveDeployProviderForCommand(runtime, deployConfig);
      const deployPlatform = createDeployPlatform({
        provider: deployProvider,
        config: runtime.config,
      });
      const deployResult = await deployPlatform.triggerProductionDeployment({
        ...deployConfig,
        deployProvider,
      });

      return {
        ...deployResult,
        deployProvider,
      };
    },

    waitForProdDeployCompletionFn: async (deployConfig, externalDeployId) => {
      const deployProvider = await resolveDeployProviderForCommand(runtime, deployConfig);
      const deployPlatform = createDeployPlatform({
        provider: deployProvider,
        config: runtime.config,
      });

      return deployPlatform.waitForProductionDeploymentCompletion(
        {
          ...deployConfig,
          deployProvider,
        },
        externalDeployId,
      );
    },
  };
}

async function resolveDeployProviderForCommand(runtime, deployConfig = {}) {
  const runtimeProviderConfig = await readRuntimeProviderConfigSafe(runtime);
  return (
    String(deployConfig.deployProvider || "").trim().toLowerCase() ||
    runtimeProviderConfig.deployProvider ||
    runtime.config.deployProvider
  );
}

async function resolveCodeHostProviderForCommand(runtime) {
  const runtimeProviderConfig = await readRuntimeProviderConfigSafe(runtime);
  return runtimeProviderConfig.codeHostProvider || runtime.config.codeHostProvider;
}

async function resolveEmailProvider(runtime) {
  const runtimeProviderConfig = await readRuntimeProviderConfigSafe(runtime);
  return runtimeProviderConfig.emailProvider || runtime.config.emailProvider;
}

async function resolveErrorTrackingProvider(runtime) {
  const runtimeProviderConfig = await readRuntimeProviderConfigSafe(runtime);
  return runtimeProviderConfig.errorTrackingProvider || runtime.config.errorTrackingProvider;
}

async function resolveAiProvider(runtime) {
  const runtimeProviderConfig = await readRuntimeProviderConfigSafe(runtime);
  return runtimeProviderConfig.aiProvider || runtime.config.aiProvider;
}

function buildResolveAiClientFn(runtime) {
  return async () => {
    const aiProvider = await resolveAiProvider(runtime);
    const aiPlatform = createAiPlatform({
      provider: aiProvider,
      config: runtime.config,
    });

    return {
      aiClient: aiPlatform.createAiClient(),
      aiProvider,
    };
  };
}

function buildResolveEmailClientByProviderFn(runtime) {
  return async (provider = null) => {
    const emailProvider = provider || await resolveEmailProvider(runtime);
    const emailPlatform = createEmailPlatform({
      provider: emailProvider,
      config: runtime.config,
    });

    return {
      emailClient: emailPlatform.createEmailClient(),
      emailProvider,
    };
  };
}

function buildRuntimeCodeHostConfig(runtime, codeHostProvider) {
  return {
    ...runtime.config,
    codeHostProvider,
    codeHostApiBaseUrl: resolveCodeHostApiBaseUrl(codeHostProvider),
  };
}

async function readRuntimeProviderConfigSafe(runtime) {
  if (!runtime.pool) {
    return {
      communicationProvider: runtime.config.communicationProvider,
      codeHostProvider: runtime.config.codeHostProvider,
      deployProvider: runtime.config.deployProvider,
      emailProvider: runtime.config.emailProvider,
      aiProvider: runtime.config.aiProvider,
      errorTrackingProvider: runtime.config.errorTrackingProvider,
    };
  }

  try {
    return await getRuntimeProviderConfig(runtime.pool);
  } catch (_error) {
    return {
      communicationProvider: runtime.config.communicationProvider,
      codeHostProvider: runtime.config.codeHostProvider,
      deployProvider: runtime.config.deployProvider,
      emailProvider: runtime.config.emailProvider,
      aiProvider: runtime.config.aiProvider,
      errorTrackingProvider: runtime.config.errorTrackingProvider,
    };
  }
}

function startHttpServer(httpApp, port, options = {}) {
  const providerLabel = formatProviderLabel(options.codeHostProvider || "code-host");
  return new Promise((resolve) => {
    httpApp.listen(port, () => {
      console.log(`${providerLabel} webhook server listening on port ${port}.`);
      resolve();
    });
  });
}

function formatProviderLabel(providerName) {
  const normalizedProviderName = String(providerName || "").trim().toLowerCase();
  if (normalizedProviderName === "") {
    return "Code-host";
  }

  return normalizedProviderName
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

start().catch((error) => {
  console.error(`Failed to start ${DEFAULT_BOT_NAME}.`);
  console.error(error.message);
  process.exit(1);
});
