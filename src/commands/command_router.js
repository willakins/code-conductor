const { parseCalypsoCommand } = require("./parsing/command_parser");
const { createCalypsoCommandService } = require("./services/command_service");
const { DEFAULT_BOT_NAME } = require("../config");
const { resolveBotCommandPrefix } = require("../shared/bot_command");
const {
  buildCommunicationMessage,
} = require("../platform/communication/message_renderer");
const {
  buildDefaultCommandPresentation,
} = require("./presentation/default_command_presentation");

const SLACK_HERE_MENTION = "<!here>";

function handleCalypsoCommand({ text, user_id, botName }) {
  void user_id;
  return parseCalypsoCommand({ text, botName });
}

function registerCalypsoCommand(app, options = {}) {
  const botName = resolveBotName(options.botName);
  const calypsoCommandService = createCalypsoCommandService(options);

  const commandHandler = async ({
    client,
    command,
    ack,
    respond,
    respondsToInteractiveAction = false,
  }) => {
    await ack();
    let parsedCommand = null;
    const currentChannelId = resolveCommandChannelId(command);
    const sendResponse = async (response) =>
      sendCommunicationResponse({
        communicationProvider: options.communicationProvider,
        respond,
        respondsToInteractiveAction,
        response,
      });

    try {
      parsedCommand = parseCalypsoCommand({
        text: command.text,
        botName,
      });
      const userId = resolveCommandUserId(command);

      const executionResult = await calypsoCommandService.execute(parsedCommand, {
        userId,
        callerUserName: resolveCommandUserName(command),
        communicationClient: client,
        currentChannelId,
        currentChannelName: resolveCommandChannelName(command),
        sendInterimResponseFn: async ({ responseType, text, presentation }) => {
          await sendResponse(buildCommandResponse({
            commandName: parsedCommand.commandName,
            communicationProvider: options.communicationProvider,
            responseType,
            text,
            presentation,
          }));
        },
      });

      await sendResponse(buildCommandResponse({
        commandName: parsedCommand.commandName,
        communicationProvider: options.communicationProvider,
        responseType: executionResult.responseType,
        text: executionResult.responseText,
        presentation: executionResult.presentation,
      }));

      await sendDeploymentCompletionFollowUpIfNeeded({
        calypsoCommandService,
        userId,
        executionResult,
        communicationClient: client,
        communicationProvider: options.communicationProvider,
        respond: sendResponse,
      });
    } catch (error) {
      console.error(`Failed to process ${resolveBotCommandPrefix(botName)} command.`);
      console.error(error.message);
      const errorText = `${botName} hit an error while processing that command.`;
      await respond(buildCommandResponse({
        commandName: parsedCommand?.commandName || "unknown",
        communicationProvider: options.communicationProvider,
        responseType: "ephemeral",
        text: errorText,
      }));
    }
  };
  // Keep both historical names as compatibility aliases for existing workspaces.
  const commandPrefixes = new Set([
    "/calypso",
    "/conductor",
    resolveBotCommandPrefix(botName),
  ]);
  for (const commandPrefix of commandPrefixes) {
    app.command(commandPrefix, commandHandler);
  }

  if (typeof app.action === "function") {
    app.action(/^calypso:/, async ({ ack, action, body, client, respond }) =>
      commandHandler({
        ack,
        client,
        command: {
          channel_id: body?.channel?.id || body?.container?.channel_id || null,
          channel_name: body?.channel?.name || null,
          text: action?.value || "",
          user_id: body?.user?.id || null,
          user_name: body?.user?.username || body?.user?.name || null,
        },
        respond,
        respondsToInteractiveAction: true,
      }));
  }
}

async function sendCommunicationResponse({
  communicationProvider,
  respond,
  respondsToInteractiveAction,
  response,
}) {
  const shouldPublishNewSlackActionResponse =
    String(communicationProvider || "").trim().toLowerCase() === "slack"
    && response?.response_type === "in_channel"
    && respondsToInteractiveAction;
  await respond(
    shouldPublishNewSlackActionResponse
      ? { ...response, replace_original: false }
      : response,
  );
}

async function sendDeploymentCompletionFollowUpIfNeeded({
  calypsoCommandService,
  communicationClient,
  communicationProvider,
  executionResult,
  userId,
  respond,
}) {
  const shouldNotifyCompletion = Boolean(executionResult.shouldNotifyDeploymentCompletion);
  const shouldFinalizeProductionDeployment = Boolean(
    executionResult.shouldFinalizeProductionDeployment,
  );
  const externalDeploymentId = executionResult.externalDeploymentId || null;
  const shouldTrackDeploymentRun = Boolean(executionResult.deploymentRunId);
  if (
    (!shouldNotifyCompletion && !shouldFinalizeProductionDeployment && !shouldTrackDeploymentRun)
    || !externalDeploymentId
  ) {
    return;
  }

  const completionWork = waitForDeploymentCompletionAndFinalize({
    calypsoCommandService,
    communicationClient,
    executionResult,
    externalDeploymentId,
    userId,
  });

  if (!shouldNotifyCompletion) {
    completionWork.catch((error) => {
      console.error(`Failed to finalize deployment ${externalDeploymentId}.`);
      console.error(error.message);
    });
    return;
  }

  try {
    const { completionState, deploymentRun, finalizationResult } = await completionWork;
    const deployEnvironment =
      executionResult.deployConfigOverrides?.deployTargetEnvironment || "prod";
    const environmentStatus = deployEnvironment === "prod"
      ? await calypsoCommandService.readEnvironmentStatus({
        communicationClient,
        deployConfig: executionResult.deployConfigOverrides || {},
        deployProvider: executionResult.deployProvider,
        userId,
      }).catch(() => null)
      : null;

    const successText = await buildDeploymentCompletionSuccessText({
      calypsoCommandService,
      communicationClient,
      completionState,
      executionResult,
      externalDeploymentId,
      finalizationResult,
      userId,
    });

    await respond(buildCommandResponse({
      communicationProvider,
      responseType: executionResult.followUpResponseType || executionResult.responseType,
      text: successText,
      presentation: buildDeploymentCompletionSuccessPresentation({
        completionState,
        deploymentRun,
        environmentStatus,
        executionResult,
        externalDeploymentId,
        finalizationResult,
      }),
    }));
  } catch (error) {
    const failureText = buildDeploymentCompletionFailureText({
      externalDeploymentId,
      error,
    });
    await respond(buildCommandResponse({
      communicationProvider,
      responseType: executionResult.followUpResponseType || executionResult.responseType,
      text: failureText,
      presentation: buildDeploymentCompletionFailurePresentation({
        externalDeploymentId,
        error,
      }),
    }));
  }
}

function buildCommandResponse({
  commandName,
  communicationProvider,
  responseType,
  text,
  presentation,
}) {
  const resolvedPresentation =
    presentation ||
    buildDefaultCommandPresentation({
      commandName,
      responseText: text,
    });

  return {
    response_type: normalizeResponseType(responseType),
    ...buildCommunicationMessage({
      provider: communicationProvider,
      text,
      presentation: resolvedPresentation,
    }),
  };
}

function buildDeploymentCompletionSuccessPresentation({
  completionState,
  deploymentRun,
  environmentStatus,
  executionResult,
  externalDeploymentId,
  finalizationResult,
}) {
  const deployEnvironment =
    executionResult.deployConfigOverrides?.deployTargetEnvironment || "prod";
  const environmentLabel = deployEnvironment === "staging" ? "Staging" : "Production";
  const completionPhase = completionState?.phase || completionState?.status || "unknown";
  if (deployEnvironment === "staging") {
    return {
      tone: "success",
      title: "Staging deployment complete",
      summary: "Staging finished successfully.",
      facts: [
        { label: "Deployment ID", value: externalDeploymentId },
        { label: "Provider status", value: String(completionPhase) },
      ],
    };
  }

  const deployedPullRequestCount = Number(finalizationResult?.deployedPullRequestCount) || 0;
  const completedRun = deploymentRun || finalizationResult?.deploymentRun || null;
  const provider = completedRun?.provider || executionResult.deployProvider;
  const duration = formatDeploymentDuration(
    completedRun?.started_at,
    completedRun?.completed_at,
  );
  const completedAt = completedRun?.completed_at || null;
  const deploymentReference = formatDeploymentReference({
    deployAppId: executionResult.deployConfigOverrides?.deployProductionAppId,
    externalDeploymentId,
    provider,
  });
  const facts = [
    {
      label: "Deployment details",
      value: [
        `🔀 ${formatPullRequestCount(deployedPullRequestCount)}`,
        `🏗️ ${formatDeployProvider(provider)} · ${deploymentReference}`,
        duration ? `🕒 Completed in ${duration}` : "",
      ].filter(Boolean).join("\n"),
    },
    buildDeploymentHealthFact(environmentStatus, completedAt),
  ].filter(Boolean);

  return {
    tone: "success",
    title: `${environmentLabel} deployment complete`,
    status: {
      detail: "Deployment completed",
      label: "Live",
      showIcon: false,
      tone: "success",
    },
    facts,
    factsSeparator: true,
    showHeaderIcon: true,
    compactFooter: true,
    actions: [{
      id: `history_${deployEnvironment}`,
      label: "View deployment history",
      command: `history ${deployEnvironment}`,
    }],
    context: "🛡️ Monitoring continues automatically when enabled.",
  };
}

function buildDeploymentHealthFact(environmentStatus, completedAt) {
  if (
    !environmentStatus?.enabled
    || !isHealthObservationAfterDeployment(environmentStatus.lastCheckedAt, completedAt)
  ) {
    return null;
  }

  const state = String(environmentStatus.lastObservedState || "unknown").toLowerCase();
  const httpStatus = environmentStatus.lastHttpStatus
    ? ` · HTTP ${environmentStatus.lastHttpStatus}`
    : "";
  if (state === "healthy") {
    return { label: "Production health", value: `✅ Healthy${httpStatus}` };
  }
  if (state === "unhealthy") {
    return { label: "Production health", value: `⛔ Unhealthy${httpStatus}` };
  }
  return null;
}

function isHealthObservationAfterDeployment(lastCheckedAt, completedAt) {
  const lastCheckedTimestamp = new Date(lastCheckedAt || "").getTime();
  const completedTimestamp = new Date(completedAt || "").getTime();
  if (!Number.isFinite(completedTimestamp)) {
    return false;
  }
  return Number.isFinite(lastCheckedTimestamp) && lastCheckedTimestamp > completedTimestamp;
}

function formatDeployProvider(provider) {
  const normalizedProvider = String(provider || "").trim().toLowerCase();
  if (normalizedProvider === "digitalocean") return "DigitalOcean";
  if (normalizedProvider === "aws") return "AWS CodePipeline";
  return normalizedProvider || "Unknown provider";
}

function formatDeploymentReference({ deployAppId, externalDeploymentId, provider }) {
  const label = `Deployment ${externalDeploymentId}`;
  const normalizedAppId = String(deployAppId || "").trim();
  const normalizedProvider = String(provider || "").trim().toLowerCase();
  if (normalizedProvider !== "digitalocean" || !normalizedAppId) {
    return label;
  }

  return `<https://cloud.digitalocean.com/apps/${encodeURIComponent(normalizedAppId)}|${label}>`;
}

function formatDeploymentDuration(startedAt, completedAt) {
  const startedTimestamp = new Date(startedAt || "").getTime();
  const completedTimestamp = new Date(completedAt || "").getTime();
  if (!Number.isFinite(startedTimestamp) || !Number.isFinite(completedTimestamp)) {
    return "";
  }

  const totalSeconds = Math.max(Math.round((completedTimestamp - startedTimestamp) / 1000), 0);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function formatPullRequestCount(count) {
  return `${count} pull request${count === 1 ? "" : "s"}`;
}

function buildDeploymentCompletionFailurePresentation({ externalDeploymentId, error }) {
  const stateCommitFailed = error?.code === "DEPLOY_STATE_ROLLED_BACK";
  const deploymentInterrupted = error?.code === "DEPLOYMENT_INTERRUPTED";
  if (deploymentInterrupted) {
    const interruption = describeDeploymentInterruption(error);
    return {
      tone: "warning",
      title: interruption.title,
      summary: interruption.summary,
      facts: [
        {
          label: "Deployment ID",
          value: externalDeploymentId,
        },
      ],
      context: "No deployment record or PR status was committed for this interrupted deployment.",
    };
  }

  return {
    tone: "danger",
    title: stateCommitFailed ? "Deployment state update failed" : "Deployment failed",
    summary: error?.message || "The deploy provider reported a failure.",
    facts: [
      {
        label: "Deployment ID",
        value: externalDeploymentId,
      },
    ],
    context: "No deployment record or PR status was committed.",
  };
}

function buildDeploymentCompletionFailureText({ externalDeploymentId, error }) {
  if (error?.code === "DEPLOY_STATE_ROLLED_BACK") {
    return `${SLACK_HERE_MENTION} Deployment ${externalDeploymentId} finished, but Code Conductor could not commit deployment state: ${error.message} No deploy records or PR statuses were committed.`;
  }
  if (error?.code === "DEPLOYMENT_INTERRUPTED") {
    const interruption = describeDeploymentInterruption(error);
    return `${SLACK_HERE_MENTION} Deployment ${externalDeploymentId} ${interruption.outcome}. ${interruption.explanation}. No deploy records or PR statuses were committed for this interrupted deployment.`;
  }

  return `${SLACK_HERE_MENTION} Deployment ${externalDeploymentId} failed after trigger: ${error.message}. No deploy records or PR statuses were committed.`;
}

function describeDeploymentInterruption(error) {
  if (error?.deploymentPhase === "SUPERSEDED") {
    return {
      title: "Deployment superseded",
      outcome: "was superseded by the provider",
      explanation: "A newer provider deployment replaced it",
      summary: "The provider replaced this deployment with a newer one. This does not necessarily mean the app failed to deploy.",
    };
  }

  return {
    title: "Deployment canceled",
    outcome: "was canceled by the provider",
    explanation: "A newer deployment or configuration change may have replaced it",
    summary: "The provider canceled this deployment. This commonly happens when a newer deployment or configuration change replaces one already in progress. This does not necessarily mean the app failed to deploy.",
  };
}

async function waitForDeploymentCompletionAndFinalize({
  calypsoCommandService,
  communicationClient,
  executionResult,
  externalDeploymentId,
  userId,
}) {
  const commandContext = {
    communicationClient,
    deployConfig: executionResult.deployConfigOverrides || {},
    deployProvider: executionResult.deployProvider,
    userId,
  };
  try {
    const completionState = await calypsoCommandService.waitForProdDeploymentCompletion(
      externalDeploymentId,
      commandContext,
    );
    let finalizationResult = null;
    let deploymentRun = null;

    if (executionResult.shouldFinalizeProductionDeployment) {
      finalizationResult = await calypsoCommandService.finalizeProductionDeployment(
        executionResult.productionDeploymentFinalization,
        commandContext,
      );
      deploymentRun = finalizationResult?.deploymentRun || null;
    }
    if (
      executionResult.deploymentRunId
      && !executionResult.shouldFinalizeProductionDeployment
    ) {
      deploymentRun = await calypsoCommandService.completeDeploymentRun(
        executionResult.deploymentRunId,
        { status: "succeeded" },
        commandContext,
      );
    }

    return {
      completionState,
      deploymentRun,
      finalizationResult,
    };
  } catch (error) {
    if (
      executionResult.deploymentRunId
      && error?.code !== "DEPLOY_STATE_ROLLED_BACK"
    ) {
      await calypsoCommandService.completeDeploymentRun(
        executionResult.deploymentRunId,
        { failureMessage: error.message, status: "failed" },
        commandContext,
      );
    }
    throw error;
  }
}

async function buildDeploymentCompletionSuccessText({
  calypsoCommandService,
  communicationClient,
  completionState,
  executionResult,
  externalDeploymentId,
  finalizationResult,
  userId,
}) {
  const completionPhase = completionState?.phase || completionState?.status || "unknown";
  const baseText = `Deployment ${externalDeploymentId} finished successfully with phase ${completionPhase}.`;
  if (!finalizationResult) {
    return baseText;
  }

  const deployedPullRequestSummaryText =
    await calypsoCommandService.buildDeploymentPullRequestSummary(
      {
        heading: "Deployed PRs:",
        pullRequestCount: finalizationResult.deployedPullRequestCount,
        pullRequests: finalizationResult.deployedPullRequests,
        detailsUnavailableText: "PR(s) deployed (details unavailable).",
      },
      {
        communicationClient,
        deployConfig: executionResult.deployConfigOverrides || {},
        deployProvider: executionResult.deployProvider,
        userId,
      },
    );

  return [
    `${baseText} Marked ${finalizationResult.deployedPullRequestCount} PR(s) deployed.`,
    deployedPullRequestSummaryText,
  ].join("\n");
}

function normalizeResponseType(responseType) {
  return responseType === "in_channel" ? "in_channel" : "ephemeral";
}

function resolveCommandUserId(command) {
  if (!command) {
    return null;
  }

  return command.userId || command.user_id || null;
}

function resolveCommandUserName(command) {
  if (!command) {
    return null;
  }

  return command.userName || command.user_name || null;
}

function resolveCommandChannelId(command) {
  if (!command) {
    return null;
  }

  return command.channelId || command.channel_id || null;
}

function resolveCommandChannelName(command) {
  if (!command) {
    return null;
  }

  return command.channelName || command.channel_name || null;
}

function resolveBotName(botName) {
  const normalizedBotName = String(botName || "").trim();
  return normalizedBotName || DEFAULT_BOT_NAME;
}

module.exports = {
  handleCalypsoCommand,
  registerCalypsoCommand,
};
