const {
  addUserToDeployWhitelist,
  cacheSupportEmailThreadMessageText,
  clearSupportEmailOnCall,
  completeDeploymentRun,
  consumeDeploymentConfirmation,
  createDeploymentConfirmation,
  DEFAULT_TIME_FORMAT,
  DEFAULT_TIME_ZONE,
  getErrorTrackingConfig,
  getActiveDeploymentRun,
  getDeploymentGateState,
  getEnvironmentStatusConfig,
  getConfiguredTimeFormat,
  getConfiguredTimeZone,
  getLastProdDeployAt,
  getReviewRecapConfig,
  getRuntimeProviderConfig,
  getSupportEmailThreadById,
  getSupportEmailConfig,
  isUserWhitelistedForDeploy,
  insertDeployment,
  insertAuditEvent,
  listAuditEvents,
  listDeployablePullRequestsForDeployment,
  listGithubSlackUserMappings,
  listPendingSupportEmailThreads,
  listOpenErrorTrackingIssues,
  listOpenPullRequestsForReviewRecapSince,
  listOpenPullRequestsWaitingOnReviewSince,
  listRecentlyTestedPullRequests,
  listBlockingPullRequests,
  markEnvironmentStatusNotificationSent,
  markDeploymentRunTriggered,
  markReviewRecapSent,
  markAllUntestedPullRequestsTested,
  markPullRequestTested,
  markPullRequestsDeployed,
  markSupportEmailThreadNotificationSent,
  markSupportEmailThreadResponded,
  recordEnvironmentStatusObservation,
  reserveDeploymentRun,
  setConfiguredTimeFormat,
  setConfiguredTimeZone,
  setConfiguredCommunicationProvider,
  setConfiguredCodeHostProvider,
  setConfiguredDeployProvider,
  setConfiguredDeployEnvironment,
  setConfiguredEmailProvider,
  setConfiguredAiProvider,
  setConfiguredErrorTrackingProvider,
  setGithubSlackUserMapping,
  setPullRequestForceDeployBlocked,
  setErrorTrackingChannel,
  setErrorTrackingEnabled,
  setErrorTrackingEnvironment,
  setErrorTrackingProject,
  setDeploymentGateState,
  setDeploymentGateStateWithAudit,
  setEnvironmentStatusChannel,
  setEnvironmentStatusEnabled,
  setEnvironmentStatusUrl,
  setReviewRecapChannel,
  setReviewRecapRecency,
  setReviewRecapScope,
  setReviewRecapSchedule,
  setReviewRecapSendHolidays,
  setReviewRecapSendWeekends,
  setReviewRecapTimeZone,
  setSupportEmailChannel,
  setSupportEmailMonitorEnabled,
  setSupportEmailOnCall,
  updateSupportEmailRuntimeState,
} = require("../../db");
const { DEFAULT_BOT_NAME } = require("../../config");
const { formatStatusResponse, isValidTimeZone } = require("../../util/format");
const { updateDeployAvailabilityInTopic } = require("../../shared/deploy_availability");
const { createCalypsoCommandRegistry } = require("../registry/command_registry");
const {
  buildDeploymentPullRequestSummary: formatDeploymentPullRequestSummary,
} = require("../types/deploy_command");

function createCalypsoCommandService(serviceOptions = {}) {
  const commandRegistry = createCalypsoCommandRegistry({
    botName: serviceOptions.botName,
  });
  const defaultDependencies = createDefaultDependencies();

  return {
    async execute(parsedCommand, commandContext = {}) {
      const runtimeContext = buildRuntimeContext({
        serviceOptions,
        commandContext,
        defaultDependencies,
      });

      return commandRegistry.execute(parsedCommand, runtimeContext);
    },

    async waitForProdDeploymentCompletion(externalDeployId, commandContext = {}) {
      const runtimeContext = buildRuntimeContext({
        serviceOptions,
        commandContext,
        defaultDependencies,
      });

      return runtimeContext.waitForProdDeployCompletionFn(
        runtimeContext.deployConfig,
        externalDeployId,
      );
    },

    async finalizeProductionDeployment(deploymentFinalization, commandContext = {}) {
      const runtimeContext = buildRuntimeContext({
        serviceOptions,
        commandContext,
        defaultDependencies,
      });

      return finalizeProductionDeployment(runtimeContext, deploymentFinalization);
    },

    async readEnvironmentStatus(commandContext = {}) {
      const runtimeContext = buildRuntimeContext({
        serviceOptions,
        commandContext,
        defaultDependencies,
      });

      return runtimeContext.getEnvironmentStatusConfigFn(runtimeContext.pool);
    },

    async completeDeploymentRun(runId, completion, commandContext = {}) {
      const runtimeContext = buildRuntimeContext({
        serviceOptions,
        commandContext,
        defaultDependencies,
      });
      const completedRun = await runtimeContext.completeDeploymentRunFn(
        runtimeContext.pool,
        runId,
        completion,
      );
      await runtimeContext.insertAuditEventFn(runtimeContext.pool, {
        actorUserId: runtimeContext.userId,
        environment: completedRun?.environment,
        eventType: completion.status === "succeeded" ? "deployment_succeeded" : "deployment_failed",
        metadata: {
          durationSeconds: calculateDurationSeconds(
            completedRun?.started_at,
            completedRun?.completed_at,
          ),
          externalDeploymentId: completedRun?.external_deploy_id || null,
          failureMessage: completion.failureMessage || null,
          provider: completedRun?.provider || null,
          runId,
        },
        summary: completion.status === "succeeded"
          ? `${completedRun?.environment || "Deployment"} run #${runId} succeeded.`
          : `${completedRun?.environment || "Deployment"} run #${runId} failed: ${completion.failureMessage || "Unknown failure."}`,
      });
      return completedRun;
    },

    async buildDeploymentPullRequestSummary(summaryOptions, commandContext = {}) {
      const runtimeContext = buildRuntimeContext({
        serviceOptions,
        commandContext,
        defaultDependencies,
      });

      return formatDeploymentPullRequestSummary({
        runtime: runtimeContext,
        ...summaryOptions,
      });
    },

    async resolveDeployAccess(commandContext = {}) {
      const runtimeContext = buildRuntimeContext({
        serviceOptions,
        commandContext,
        defaultDependencies,
      });

      return runtimeContext.resolveDeployAccessFn(runtimeContext);
    },
  };
}

function createDefaultDependencies() {
  return {
    defaultBotName: DEFAULT_BOT_NAME,
    getErrorTrackingConfigFn: getErrorTrackingConfig,
    getActiveDeploymentRunFn: (pool, environment) =>
      hasQueryablePool(pool) ? getActiveDeploymentRun(pool, environment) : null,
    getDeploymentGateStateFn: (pool, environment) =>
      hasQueryablePool(pool) ? getDeploymentGateState(pool, environment) : null,
    formatStatusResponseFn: formatStatusResponse,
    addUserToDeployWhitelistFn: addUserToDeployWhitelist,
    cacheSupportEmailThreadMessageTextFn: cacheSupportEmailThreadMessageText,
    clearSupportEmailOnCallFn: clearSupportEmailOnCall,
    getEnvironmentStatusConfigFn: (pool) =>
      hasQueryablePool(pool) ? getEnvironmentStatusConfig(pool) : null,
    getLastProdDeployAtFn: (pool) =>
      hasQueryablePool(pool) ? getLastProdDeployAt(pool) : new Date(0),
    getConfiguredTimeFormatFn: getConfiguredTimeFormat,
    getConfiguredTimeZoneFn: getConfiguredTimeZone,
    isUserWhitelistedForDeployFn: isUserWhitelistedForDeploy,
    isValidTimeZoneFn: isValidTimeZone,
    isWorkspaceAdminFn: isWorkspaceAdmin,
    insertDeploymentFn: insertDeployment,
    consumeDeploymentConfirmationFn: consumeDeploymentConfirmation,
    createDeploymentConfirmationFn: createDeploymentConfirmation,
    insertAuditEventFn: (pool, event) =>
      hasQueryablePool(pool) ? insertAuditEvent(pool, event) : event,
    listAuditEventsFn: (pool, options) =>
      hasQueryablePool(pool) ? listAuditEvents(pool, options) : [],
    getReviewRecapConfigFn: getReviewRecapConfig,
    getRuntimeProviderConfigFn: getRuntimeProviderConfig,
    getSupportEmailConfigFn: getSupportEmailConfig,
    getSupportEmailThreadByIdFn: getSupportEmailThreadById,
    listPendingSupportEmailThreadsFn: listPendingSupportEmailThreads,
    listDeployablePullRequestsForDeploymentFn: (
      pool,
      lastDeployAt,
      deploymentCutoffAt,
      options,
    ) =>
      hasQueryablePool(pool)
        ? listDeployablePullRequestsForDeployment(
          pool,
          lastDeployAt,
          deploymentCutoffAt,
          options,
        )
        : [],
    listOpenErrorTrackingIssuesFn: listOpenErrorTrackingIssues,
    listOpenPullRequestsForReviewRecapSinceFn: listOpenPullRequestsForReviewRecapSince,
    listOpenPullRequestsWaitingOnReviewSinceFn: listOpenPullRequestsWaitingOnReviewSince,
    listGithubSlackUserMappingsFn: listGithubSlackUserMappings,
    markReviewRecapSentFn: markReviewRecapSent,
    listRecentlyTestedPullRequestsFn: listRecentlyTestedPullRequests,
    listBlockingPullRequestsFn: (pool, lastDeployAt) =>
      hasQueryablePool(pool) ? listBlockingPullRequests(pool, lastDeployAt) : [],
    markAllUntestedPullRequestsTestedFn: markAllUntestedPullRequestsTested,
    markEnvironmentStatusNotificationSentFn: markEnvironmentStatusNotificationSent,
    markDeploymentRunTriggeredFn: (pool, runId, update) =>
      hasQueryablePool(pool) ? markDeploymentRunTriggered(pool, runId, update) : null,
    markPullRequestTestedFn: markPullRequestTested,
    markPullRequestsDeployedFn: markPullRequestsDeployed,
    markSupportEmailThreadNotificationSentFn: markSupportEmailThreadNotificationSent,
    markSupportEmailThreadRespondedFn: markSupportEmailThreadResponded,
    recordEnvironmentStatusObservationFn: recordEnvironmentStatusObservation,
    reserveDeploymentRunFn: (pool, reservation) =>
      hasQueryablePool(pool)
        ? reserveDeploymentRun(pool, reservation)
        : { acquired: true, run: { id: null, environment: reservation.environment } },
    readTimeFormatPreferenceFn: readTimeFormatPreference,
    readTimeZonePreferenceFn: readTimeZonePreference,
    resolveUserDisplayNameFn: resolveUserDisplayNameFromCommunicationClient,
    resolveCurrentChannelTopicFn: resolveCurrentChannelTopicFromCommunicationClient,
    updateCurrentChannelTopicFn: updateCurrentChannelTopicFromCommunicationClient,
    resolveDeployAccessFn: resolveDeployAccess,
    resolveAiClientFn: null,
    resolveEmailClientByProviderFn: null,
    runOpenPullRequestSyncNowFn: null,
    setConfiguredTimeFormatFn: setConfiguredTimeFormat,
    setConfiguredTimeZoneFn: setConfiguredTimeZone,
    setConfiguredCommunicationProviderFn: setConfiguredCommunicationProvider,
    setConfiguredCodeHostProviderFn: setConfiguredCodeHostProvider,
    setConfiguredDeployProviderFn: setConfiguredDeployProvider,
    setConfiguredDeployEnvironmentFn: setConfiguredDeployEnvironment,
    setConfiguredEmailProviderFn: setConfiguredEmailProvider,
    setConfiguredAiProviderFn: setConfiguredAiProvider,
    setConfiguredErrorTrackingProviderFn: setConfiguredErrorTrackingProvider,
    setGithubSlackUserMappingFn: setGithubSlackUserMapping,
    setPullRequestForceDeployBlockedFn: setPullRequestForceDeployBlocked,
    setErrorTrackingChannelFn: setErrorTrackingChannel,
    setErrorTrackingEnabledFn: setErrorTrackingEnabled,
    setErrorTrackingEnvironmentFn: setErrorTrackingEnvironment,
    setErrorTrackingProjectFn: setErrorTrackingProject,
    setDeploymentGateStateFn: (pool, state) =>
      hasQueryablePool(pool) ? setDeploymentGateState(pool, state) : state,
    setDeploymentGateStateWithAuditFn: (pool, change) =>
      hasQueryablePool(pool)
        ? setDeploymentGateStateWithAudit(pool, change)
        : {
            state: {
              changed_by: change.actorUserId,
              environment: change.environment,
              reason: change.reason || null,
              status: change.status,
            },
          },
    setEnvironmentStatusChannelFn: setEnvironmentStatusChannel,
    setEnvironmentStatusEnabledFn: setEnvironmentStatusEnabled,
    setEnvironmentStatusUrlFn: setEnvironmentStatusUrl,
    setReviewRecapChannelFn: setReviewRecapChannel,
    setReviewRecapRecencyFn: setReviewRecapRecency,
    setReviewRecapScopeFn: setReviewRecapScope,
    setReviewRecapScheduleFn: setReviewRecapSchedule,
    setReviewRecapSendWeekendsFn: setReviewRecapSendWeekends,
    setReviewRecapSendHolidaysFn: setReviewRecapSendHolidays,
    setReviewRecapTimeZoneFn: setReviewRecapTimeZone,
    setSupportEmailChannelFn: setSupportEmailChannel,
    setSupportEmailMonitorEnabledFn: setSupportEmailMonitorEnabled,
    setSupportEmailOnCallFn: setSupportEmailOnCall,
    triggerProdDeployFn: triggerProductionDeploymentUnavailable,
    completeDeploymentRunFn: (pool, runId, completion) =>
      hasQueryablePool(pool) ? completeDeploymentRun(pool, runId, completion) : {
        id: runId,
        status: completion.status,
      },
    runDoctorDiagnosticsFn: runDefaultDoctorDiagnostics,
    updateSupportEmailRuntimeStateFn: updateSupportEmailRuntimeState,
    waitForProdDeployCompletionFn: waitForProductionDeploymentCompletionUnavailable,
  };
}

function buildRuntimeContext({ serviceOptions, commandContext, defaultDependencies }) {
  const mergedOptions = { ...serviceOptions, ...commandContext };
  const userId = mergedOptions.userId || mergedOptions.slackUserId;
  const callerUserName = mergedOptions.callerUserName || mergedOptions.userName || null;
  const communicationProvider =
    mergedOptions.communicationProvider || serviceOptions.communicationProvider || "slack";
  const communicationClient = mergedOptions.communicationClient || mergedOptions.slackClient || null;
  const currentChannelId = mergedOptions.currentChannelId || mergedOptions.channelId || null;
  const currentChannelName = mergedOptions.currentChannelName || mergedOptions.channelName || null;
  const deployPlatform = mergedOptions.deployPlatform || null;
  const deployConfig = {
    ...(serviceOptions.deployConfig || {}),
    ...(commandContext.deployConfig || {}),
  };
  if (commandContext.deployProvider) {
    deployConfig.deployProvider = commandContext.deployProvider;
  }

  return {
    botName: String(mergedOptions.botName || defaultDependencies.defaultBotName),
    errorTrackingProvider:
      mergedOptions.errorTrackingProvider || serviceOptions.errorTrackingProvider || "sentry",
    addUserToDeployWhitelistFn:
      mergedOptions.addUserToDeployWhitelistFn || defaultDependencies.addUserToDeployWhitelistFn,
    clearSupportEmailOnCallFn:
      mergedOptions.clearSupportEmailOnCallFn || defaultDependencies.clearSupportEmailOnCallFn,
    cacheSupportEmailThreadMessageTextFn:
      mergedOptions.cacheSupportEmailThreadMessageTextFn ||
      defaultDependencies.cacheSupportEmailThreadMessageTextFn,
    deployConfig,
    formatStatusResponseFn:
      mergedOptions.formatStatusResponseFn || defaultDependencies.formatStatusResponseFn,
    getErrorTrackingConfigFn:
      mergedOptions.getErrorTrackingConfigFn || defaultDependencies.getErrorTrackingConfigFn,
    getActiveDeploymentRunFn:
      mergedOptions.getActiveDeploymentRunFn || defaultDependencies.getActiveDeploymentRunFn,
    getDeploymentGateStateFn:
      mergedOptions.getDeploymentGateStateFn || defaultDependencies.getDeploymentGateStateFn,
    getEnvironmentStatusConfigFn:
      mergedOptions.getEnvironmentStatusConfigFn || defaultDependencies.getEnvironmentStatusConfigFn,
    getLastProdDeployAtFn:
      mergedOptions.getLastProdDeployAtFn || defaultDependencies.getLastProdDeployAtFn,
    getConfiguredTimeFormatFn:
      mergedOptions.getConfiguredTimeFormatFn || defaultDependencies.getConfiguredTimeFormatFn,
    getConfiguredTimeZoneFn:
      mergedOptions.getConfiguredTimeZoneFn || defaultDependencies.getConfiguredTimeZoneFn,
    getReviewRecapConfigFn:
      mergedOptions.getReviewRecapConfigFn || defaultDependencies.getReviewRecapConfigFn,
    getRuntimeProviderConfigFn:
      mergedOptions.getRuntimeProviderConfigFn || defaultDependencies.getRuntimeProviderConfigFn,
    getSupportEmailConfigFn:
      mergedOptions.getSupportEmailConfigFn || defaultDependencies.getSupportEmailConfigFn,
    getSupportEmailThreadByIdFn:
      mergedOptions.getSupportEmailThreadByIdFn || defaultDependencies.getSupportEmailThreadByIdFn,
    isUserWhitelistedForDeployFn:
      mergedOptions.isUserWhitelistedForDeployFn || defaultDependencies.isUserWhitelistedForDeployFn,
    isValidTimeZoneFn: mergedOptions.isValidTimeZoneFn || defaultDependencies.isValidTimeZoneFn,
    isWorkspaceAdminFn: mergedOptions.isWorkspaceAdminFn || defaultDependencies.isWorkspaceAdminFn,
    insertDeploymentFn: mergedOptions.insertDeploymentFn || defaultDependencies.insertDeploymentFn,
    consumeDeploymentConfirmationFn:
      mergedOptions.consumeDeploymentConfirmationFn ||
      defaultDependencies.consumeDeploymentConfirmationFn,
    createDeploymentConfirmationFn:
      mergedOptions.createDeploymentConfirmationFn ||
      defaultDependencies.createDeploymentConfirmationFn,
    insertAuditEventFn:
      mergedOptions.insertAuditEventFn || defaultDependencies.insertAuditEventFn,
    listAuditEventsFn:
      mergedOptions.listAuditEventsFn || defaultDependencies.listAuditEventsFn,
    listPendingSupportEmailThreadsFn:
      mergedOptions.listPendingSupportEmailThreadsFn ||
      defaultDependencies.listPendingSupportEmailThreadsFn,
    listOpenErrorTrackingIssuesFn:
      mergedOptions.listOpenErrorTrackingIssuesFn ||
      defaultDependencies.listOpenErrorTrackingIssuesFn,
    listOpenPullRequestsForReviewRecapSinceFn:
      mergedOptions.listOpenPullRequestsForReviewRecapSinceFn ||
      defaultDependencies.listOpenPullRequestsForReviewRecapSinceFn,
    listRecentlyTestedPullRequestsFn:
      mergedOptions.listRecentlyTestedPullRequestsFn ||
      defaultDependencies.listRecentlyTestedPullRequestsFn,
    listOpenPullRequestsWaitingOnReviewSinceFn:
      mergedOptions.listOpenPullRequestsWaitingOnReviewSinceFn ||
      defaultDependencies.listOpenPullRequestsWaitingOnReviewSinceFn,
    listGithubSlackUserMappingsFn:
      mergedOptions.listGithubSlackUserMappingsFn ||
      defaultDependencies.listGithubSlackUserMappingsFn,
    listBlockingPullRequestsFn:
      mergedOptions.listBlockingPullRequestsFn || defaultDependencies.listBlockingPullRequestsFn,
    listDeployablePullRequestsForDeploymentFn:
      mergedOptions.listDeployablePullRequestsForDeploymentFn ||
      defaultDependencies.listDeployablePullRequestsForDeploymentFn,
    markAllUntestedPullRequestsTestedFn:
      mergedOptions.markAllUntestedPullRequestsTestedFn ||
      defaultDependencies.markAllUntestedPullRequestsTestedFn,
    markEnvironmentStatusNotificationSentFn:
      mergedOptions.markEnvironmentStatusNotificationSentFn ||
      defaultDependencies.markEnvironmentStatusNotificationSentFn,
    markDeploymentRunTriggeredFn:
      mergedOptions.markDeploymentRunTriggeredFn ||
      defaultDependencies.markDeploymentRunTriggeredFn,
    markReviewRecapSentFn:
      mergedOptions.markReviewRecapSentFn || defaultDependencies.markReviewRecapSentFn,
    markPullRequestTestedFn:
      mergedOptions.markPullRequestTestedFn || defaultDependencies.markPullRequestTestedFn,
    markPullRequestsDeployedFn:
      mergedOptions.markPullRequestsDeployedFn ||
      defaultDependencies.markPullRequestsDeployedFn,
    markSupportEmailThreadNotificationSentFn:
      mergedOptions.markSupportEmailThreadNotificationSentFn ||
      defaultDependencies.markSupportEmailThreadNotificationSentFn,
    markSupportEmailThreadRespondedFn:
      mergedOptions.markSupportEmailThreadRespondedFn ||
      defaultDependencies.markSupportEmailThreadRespondedFn,
    pool: mergedOptions.pool,
    recordEnvironmentStatusObservationFn:
      mergedOptions.recordEnvironmentStatusObservationFn ||
      defaultDependencies.recordEnvironmentStatusObservationFn,
    reserveDeploymentRunFn:
      mergedOptions.reserveDeploymentRunFn || defaultDependencies.reserveDeploymentRunFn,
    readTimeFormatPreferenceFn:
      mergedOptions.readTimeFormatPreferenceFn || defaultDependencies.readTimeFormatPreferenceFn,
    readTimeZonePreferenceFn:
      mergedOptions.readTimeZonePreferenceFn || defaultDependencies.readTimeZonePreferenceFn,
    resolveUserDisplayNameFn:
      mergedOptions.resolveUserDisplayNameFn || defaultDependencies.resolveUserDisplayNameFn,
    resolveCurrentChannelTopicFn:
      mergedOptions.resolveCurrentChannelTopicFn ||
      defaultDependencies.resolveCurrentChannelTopicFn,
    updateCurrentChannelTopicFn:
      mergedOptions.updateCurrentChannelTopicFn ||
      defaultDependencies.updateCurrentChannelTopicFn,
    resolveDeployAccessFn:
      mergedOptions.resolveDeployAccessFn || defaultDependencies.resolveDeployAccessFn,
    resolveAiClientFn:
      mergedOptions.resolveAiClientFn || defaultDependencies.resolveAiClientFn,
    resolveEmailClientByProviderFn:
      mergedOptions.resolveEmailClientByProviderFn ||
      defaultDependencies.resolveEmailClientByProviderFn,
    runOpenPullRequestSyncNowFn:
      mergedOptions.runOpenPullRequestSyncNowFn || defaultDependencies.runOpenPullRequestSyncNowFn,
    setConfiguredTimeFormatFn:
      mergedOptions.setConfiguredTimeFormatFn || defaultDependencies.setConfiguredTimeFormatFn,
    setConfiguredTimeZoneFn:
      mergedOptions.setConfiguredTimeZoneFn || defaultDependencies.setConfiguredTimeZoneFn,
    setConfiguredCommunicationProviderFn:
      mergedOptions.setConfiguredCommunicationProviderFn ||
      defaultDependencies.setConfiguredCommunicationProviderFn,
    setConfiguredCodeHostProviderFn:
      mergedOptions.setConfiguredCodeHostProviderFn ||
      defaultDependencies.setConfiguredCodeHostProviderFn,
    setConfiguredDeployProviderFn:
      mergedOptions.setConfiguredDeployProviderFn || defaultDependencies.setConfiguredDeployProviderFn,
    setConfiguredDeployEnvironmentFn:
      mergedOptions.setConfiguredDeployEnvironmentFn ||
      defaultDependencies.setConfiguredDeployEnvironmentFn,
    setConfiguredEmailProviderFn:
      mergedOptions.setConfiguredEmailProviderFn || defaultDependencies.setConfiguredEmailProviderFn,
    setConfiguredAiProviderFn:
      mergedOptions.setConfiguredAiProviderFn || defaultDependencies.setConfiguredAiProviderFn,
    setConfiguredErrorTrackingProviderFn:
      mergedOptions.setConfiguredErrorTrackingProviderFn ||
      defaultDependencies.setConfiguredErrorTrackingProviderFn,
    setGithubSlackUserMappingFn:
      mergedOptions.setGithubSlackUserMappingFn ||
      defaultDependencies.setGithubSlackUserMappingFn,
    setPullRequestForceDeployBlockedFn:
      mergedOptions.setPullRequestForceDeployBlockedFn ||
      defaultDependencies.setPullRequestForceDeployBlockedFn,
    setErrorTrackingChannelFn:
      mergedOptions.setErrorTrackingChannelFn || defaultDependencies.setErrorTrackingChannelFn,
    setErrorTrackingEnabledFn:
      mergedOptions.setErrorTrackingEnabledFn || defaultDependencies.setErrorTrackingEnabledFn,
    setErrorTrackingEnvironmentFn:
      mergedOptions.setErrorTrackingEnvironmentFn ||
      defaultDependencies.setErrorTrackingEnvironmentFn,
    setErrorTrackingProjectFn:
      mergedOptions.setErrorTrackingProjectFn || defaultDependencies.setErrorTrackingProjectFn,
    setDeploymentGateStateFn:
      mergedOptions.setDeploymentGateStateFn || defaultDependencies.setDeploymentGateStateFn,
    setDeploymentGateStateWithAuditFn:
      mergedOptions.setDeploymentGateStateWithAuditFn ||
      defaultDependencies.setDeploymentGateStateWithAuditFn,
    setEnvironmentStatusChannelFn:
      mergedOptions.setEnvironmentStatusChannelFn || defaultDependencies.setEnvironmentStatusChannelFn,
    setEnvironmentStatusEnabledFn:
      mergedOptions.setEnvironmentStatusEnabledFn || defaultDependencies.setEnvironmentStatusEnabledFn,
    setEnvironmentStatusUrlFn:
      mergedOptions.setEnvironmentStatusUrlFn || defaultDependencies.setEnvironmentStatusUrlFn,
    setReviewRecapChannelFn:
      mergedOptions.setReviewRecapChannelFn || defaultDependencies.setReviewRecapChannelFn,
    setReviewRecapRecencyFn:
      mergedOptions.setReviewRecapRecencyFn || defaultDependencies.setReviewRecapRecencyFn,
    setReviewRecapScopeFn:
      mergedOptions.setReviewRecapScopeFn || defaultDependencies.setReviewRecapScopeFn,
    setReviewRecapScheduleFn:
      mergedOptions.setReviewRecapScheduleFn || defaultDependencies.setReviewRecapScheduleFn,
    setReviewRecapSendWeekendsFn:
      mergedOptions.setReviewRecapSendWeekendsFn ||
      defaultDependencies.setReviewRecapSendWeekendsFn,
    setReviewRecapSendHolidaysFn:
      mergedOptions.setReviewRecapSendHolidaysFn ||
      defaultDependencies.setReviewRecapSendHolidaysFn,
    setReviewRecapTimeZoneFn:
      mergedOptions.setReviewRecapTimeZoneFn || defaultDependencies.setReviewRecapTimeZoneFn,
    setSupportEmailChannelFn:
      mergedOptions.setSupportEmailChannelFn || defaultDependencies.setSupportEmailChannelFn,
    setSupportEmailMonitorEnabledFn:
      mergedOptions.setSupportEmailMonitorEnabledFn ||
      defaultDependencies.setSupportEmailMonitorEnabledFn,
    setSupportEmailOnCallFn:
      mergedOptions.setSupportEmailOnCallFn || defaultDependencies.setSupportEmailOnCallFn,
    sendInterimResponseFn: mergedOptions.sendInterimResponseFn || null,
    runDoctorDiagnosticsFn:
      mergedOptions.runDoctorDiagnosticsFn || defaultDependencies.runDoctorDiagnosticsFn,
    communicationClient,
    currentChannelId,
    currentChannelName,
    aiProvider: mergedOptions.aiProvider || serviceOptions.aiProvider || "openai",
    aiSupportEmailSystemPrompt:
      mergedOptions.aiSupportEmailSystemPrompt || serviceOptions.aiSupportEmailSystemPrompt || "",
    emailProvider: mergedOptions.emailProvider || serviceOptions.emailProvider || "gmail",
    userId,
    callerUserName,
    communicationProvider,
    // Backward-compatible aliases while commands migrate to neutral naming.
    slackClient: communicationClient,
    slackUserId: userId,
    enableDeploymentCompletionNotifications: Boolean(
      mergedOptions.enableDeploymentCompletionNotifications,
    ),
    enableGateControl: Boolean(mergedOptions.enableGateControl),
    triggerProdDeployFn:
      mergedOptions.triggerProdDeployFn ||
      deriveDeployTriggerFunction(deployPlatform) ||
      defaultDependencies.triggerProdDeployFn,
    completeDeploymentRunFn:
      mergedOptions.completeDeploymentRunFn || defaultDependencies.completeDeploymentRunFn,
    updateSupportEmailRuntimeStateFn:
      mergedOptions.updateSupportEmailRuntimeStateFn ||
      defaultDependencies.updateSupportEmailRuntimeStateFn,
    waitForProdDeployCompletionFn:
      mergedOptions.waitForProdDeployCompletionFn ||
      deriveDeployCompletionWaitFunction(deployPlatform) ||
      defaultDependencies.waitForProdDeployCompletionFn,
  };
}

function deriveDeployTriggerFunction(deployPlatform) {
  if (!deployPlatform || typeof deployPlatform.triggerProductionDeployment !== "function") {
    return null;
  }

  return deployPlatform.triggerProductionDeployment.bind(deployPlatform);
}

function deriveDeployCompletionWaitFunction(deployPlatform) {
  if (!deployPlatform || typeof deployPlatform.waitForProductionDeploymentCompletion !== "function") {
    return null;
  }

  return deployPlatform.waitForProductionDeploymentCompletion.bind(deployPlatform);
}

async function triggerProductionDeploymentUnavailable() {
  throw new Error("Deploy provider is not configured.");
}

async function waitForProductionDeploymentCompletionUnavailable() {
  throw new Error("Deploy provider is not configured.");
}

async function runDefaultDoctorDiagnostics(runtime) {
  const checks = [];
  try {
    await runtime.pool?.query("SELECT 1");
    checks.push({ label: "Database", status: runtime.pool ? "ok" : "error", detail: runtime.pool ? "Connected." : "Pool is not configured." });
  } catch (error) {
    checks.push({ label: "Database", status: "error", detail: error.message });
  }

  const topic = typeof runtime.resolveCurrentChannelTopicFn === "function"
    ? await runtime.resolveCurrentChannelTopicFn(runtime)
    : null;
  checks.push({
    label: "Channel topic access",
    status: topic ? "ok" : "warning",
    detail: topic ? "Current channel topic is readable." : "Topic unavailable; explicit gate state is recommended.",
  });
  checks.push({
    label: "Deploy provider",
    status: runtime.deployConfig?.deployProductionAppId ? "ok" : "warning",
    detail: runtime.deployConfig?.deployProductionAppId
      ? `${runtime.deployConfig.deployProvider || "Configured provider"} has a production target.`
      : "Production deployment target is not configured.",
  });
  checks.push({
    label: "Completion monitoring",
    status: typeof runtime.waitForProdDeployCompletionFn === "function" ? "ok" : "error",
    detail: "Deployment completion tracking is available.",
  });
  return checks;
}

function hasQueryablePool(pool) {
  return Boolean(pool && typeof pool.query === "function");
}

function calculateDurationSeconds(startedAt, completedAt) {
  const startTimestamp = new Date(startedAt || "").getTime();
  const completedTimestamp = new Date(completedAt || "").getTime();
  if (!Number.isFinite(startTimestamp) || !Number.isFinite(completedTimestamp)) {
    return null;
  }
  return Math.max(Math.round((completedTimestamp - startTimestamp) / 1000), 0);
}

async function finalizeProductionDeployment(runtimeContext, deploymentFinalization = {}) {
  if (!runtimeContext.pool) {
    throw new Error("Deployment finalization unavailable: database pool is not configured.");
  }

  const externalDeploymentId = String(deploymentFinalization.externalDeploymentId || "").trim();
  if (externalDeploymentId === "") {
    throw new Error("Deployment finalization unavailable: missing external deployment id.");
  }

  const provider =
    deploymentFinalization.deployProvider ||
    deploymentFinalization.provider ||
    runtimeContext.deployConfig.deployProvider ||
    "digitalocean";
  const deploymentCutoffAt = deploymentFinalization.deploymentCutoffAt || null;
  const plannedPullRequests = Array.isArray(deploymentFinalization.plannedPullRequests)
    ? deploymentFinalization.plannedPullRequests
    : [];

  return withDatabaseTransaction(runtimeContext.pool, async (transactionClient) => {
    const deploymentRecord = await runtimeContext.insertDeploymentFn(transactionClient, {
      environment: "prod",
      provider,
      externalDeployId: externalDeploymentId,
      deployedAt: deploymentCutoffAt,
    });
    const deployedAt = deploymentRecord?.deployed_at || deploymentCutoffAt;
    const deployedPullRequestMarkingResult = await runtimeContext.markPullRequestsDeployedFn(
      transactionClient,
      plannedPullRequests,
      deployedAt,
    );
    const normalizedDeployedPullRequestMarkingResult =
      normalizeDeployedPullRequestMarkingResult(deployedPullRequestMarkingResult);
    let deploymentRun = null;
    if (deploymentFinalization.deploymentRunId) {
      deploymentRun = await runtimeContext.completeDeploymentRunFn(
        transactionClient,
        deploymentFinalization.deploymentRunId,
        { status: "succeeded" },
      );
      await runtimeContext.insertAuditEventFn(transactionClient, {
        actorUserId: runtimeContext.userId,
        environment: "prod",
        eventType: "deployment_succeeded",
        metadata: {
          deployedPullRequestCount:
            normalizedDeployedPullRequestMarkingResult.deployedPullRequestCount,
          externalDeploymentId,
          runId: deploymentFinalization.deploymentRunId,
        },
        summary: `Production deployment run #${deploymentFinalization.deploymentRunId} succeeded.`,
      });
    }

    return {
      deploymentRun,
      deploymentRecord,
      deployedPullRequestCount:
        normalizedDeployedPullRequestMarkingResult.deployedPullRequestCount,
      deployedPullRequests:
        normalizedDeployedPullRequestMarkingResult.deployedPullRequests,
      externalDeploymentId,
    };
  });
}

async function withDatabaseTransaction(pool, transactionalWork) {
  let transactionStarted = false;
  const transactionClient =
    typeof pool.connect === "function" ? await pool.connect() : pool;

  try {
    await transactionClient.query("BEGIN");
    transactionStarted = true;

    const result = await transactionalWork(transactionClient);

    await transactionClient.query("COMMIT");
    transactionStarted = false;
    return result;
  } catch (error) {
    if (transactionStarted) {
      await transactionClient.query("ROLLBACK");
      throw buildRolledBackDeploymentError(error);
    }
    throw error;
  } finally {
    if (transactionClient !== pool && typeof transactionClient.release === "function") {
      transactionClient.release();
    }
  }
}

function buildRolledBackDeploymentError(cause) {
  const rolledBackError = new Error("Deployment state transaction rolled back.", { cause });
  rolledBackError.code = "DEPLOY_STATE_ROLLED_BACK";
  return rolledBackError;
}

function normalizeDeployedPullRequestMarkingResult(markingResult) {
  if (typeof markingResult === "number" && Number.isFinite(markingResult)) {
    return {
      deployedPullRequestCount: markingResult,
      deployedPullRequests: [],
    };
  }

  if (!markingResult || typeof markingResult !== "object") {
    return {
      deployedPullRequestCount: 0,
      deployedPullRequests: [],
    };
  }

  const deployedPullRequests = normalizeDeployedPullRequests(
    markingResult.deployedPullRequests || markingResult.pullRequests,
  );
  const parsedCount = Number(markingResult.deployedPullRequestCount);
  const deployedPullRequestCount = Number.isFinite(parsedCount)
    ? parsedCount
    : deployedPullRequests.length;

  return {
    deployedPullRequestCount,
    deployedPullRequests,
  };
}

function normalizeDeployedPullRequests(deployedPullRequests) {
  return (Array.isArray(deployedPullRequests) ? deployedPullRequests : [])
    .map((pullRequest) => ({
      repo: String(pullRequest?.repo || "").trim(),
      pr_number: pullRequest?.pr_number,
      title: String(pullRequest?.title || "").trim() || null,
      url: String(pullRequest?.url || "").trim() || null,
      author_login: String(pullRequest?.author_login || "").trim() || null,
      tested:
        pullRequest?.tested === true ||
        String(pullRequest?.status || "").trim().toLowerCase() === "tested" ||
        Boolean(pullRequest?.tested_at),
    }))
    .filter((pullRequest) => Boolean(pullRequest.repo) && pullRequest.pr_number !== undefined);
}

async function resolveDeployAccess(runtimeContext) {
  const callerUserId = runtimeContext.userId;
  if (!callerUserId) {
    return {
      canDeploy: false,
      reason: "missing user id",
    };
  }

  const callerIsWorkspaceAdmin = await runtimeContext.isWorkspaceAdminFn(
    runtimeContext.communicationClient,
    callerUserId,
  );
  if (callerIsWorkspaceAdmin) {
    return {
      canDeploy: true,
      source: "workspace_admin",
    };
  }

  if (!runtimeContext.pool || typeof runtimeContext.pool.query !== "function") {
    return {
      canDeploy: false,
      reason: "whitelist lookup unavailable",
    };
  }

  const callerIsWhitelisted = await runtimeContext.isUserWhitelistedForDeployFn(
    runtimeContext.pool,
    callerUserId,
  );
  if (callerIsWhitelisted) {
    return {
      canDeploy: true,
      source: "deploy_whitelist",
    };
  }

  return {
    canDeploy: false,
    reason: "not authorized",
  };
}

async function readTimeFormatPreference(runtimeContext) {
  if (!runtimeContext.pool || typeof runtimeContext.pool.query !== "function") {
    return DEFAULT_TIME_FORMAT;
  }

  try {
    return await runtimeContext.getConfiguredTimeFormatFn(
      runtimeContext.pool,
      runtimeContext.userId,
    );
  } catch (_error) {
    return DEFAULT_TIME_FORMAT;
  }
}

async function readTimeZonePreference(runtimeContext) {
  if (!runtimeContext.pool || typeof runtimeContext.pool.query !== "function") {
    return DEFAULT_TIME_ZONE;
  }

  try {
    return await runtimeContext.getConfiguredTimeZoneFn(
      runtimeContext.pool,
      runtimeContext.userId,
    );
  } catch (_error) {
    return DEFAULT_TIME_ZONE;
  }
}

async function resolveUserDisplayNameFromCommunicationClient(communicationClient, userId) {
  if (!communicationClient || !userId || !communicationClient.users || !communicationClient.users.info) {
    return null;
  }

  try {
    const response = await communicationClient.users.info({ user: userId });
    const user = response.user || {};
    const profile = user.profile || {};
    return profile.display_name || profile.real_name || user.name || null;
  } catch (_error) {
    return null;
  }
}

async function resolveCurrentChannelTopicFromCommunicationClient(runtimeContext) {
  const channelId = String(runtimeContext.currentChannelId || "").trim();
  const conversationsApi = runtimeContext.communicationClient?.conversations;
  if (channelId === "" || !conversationsApi || typeof conversationsApi.info !== "function") {
    return null;
  }

  try {
    const response = await conversationsApi.info({ channel: channelId });
    const topic = response?.channel?.topic?.value;
    return typeof topic === "string" ? topic : null;
  } catch (_error) {
    return null;
  }
}

async function updateCurrentChannelTopicFromCommunicationClient(
  runtimeContext,
  { environment, status },
) {
  const channelId = String(runtimeContext.currentChannelId || "").trim();
  const conversationsApi = runtimeContext.communicationClient?.conversations;
  if (
    channelId === ""
    || !conversationsApi
    || typeof conversationsApi.info !== "function"
    || typeof conversationsApi.setTopic !== "function"
  ) {
    return false;
  }

  const currentTopic = await resolveCurrentChannelTopicFromCommunicationClient(runtimeContext);
  const updatedTopic = updateDeployAvailabilityInTopic(currentTopic, environment, status);
  await conversationsApi.setTopic({ channel: channelId, topic: updatedTopic });
  return true;
}

async function isWorkspaceAdmin(communicationClient, userId) {
  if (!communicationClient || !userId || !communicationClient.users || !communicationClient.users.info) {
    return false;
  }

  try {
    const response = await communicationClient.users.info({ user: userId });
    const user = response.user || {};
    return Boolean(user.is_admin || user.is_owner || user.is_primary_owner);
  } catch (_error) {
    return false;
  }
}

module.exports = {
  createCalypsoCommandService,
};
