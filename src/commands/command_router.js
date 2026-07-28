const { parseCalypsoCommand } = require("./parsing/command_parser");
const { createCalypsoCommandService } = require("./services/command_service");
const { DEFAULT_BOT_NAME } = require("../config");
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

  const commandHandler = async ({ client, command, ack, respond }) => {
    await ack();
    let parsedCommand = null;

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
        currentChannelId: resolveCommandChannelId(command),
        currentChannelName: resolveCommandChannelName(command),
        sendInterimResponseFn: async ({ responseType, text, presentation }) => {
          await respond(buildCommandResponse({
            commandName: parsedCommand.commandName,
            communicationProvider: options.communicationProvider,
            responseType,
            text,
            presentation,
          }));
        },
      });

      await respond(buildCommandResponse({
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
        respond,
      });
    } catch (error) {
      console.error("Failed to process /calypso command.");
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
  app.command("/calypso", commandHandler);

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
      }));
  }
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
    const { completionState, finalizationResult } = await completionWork;

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
  executionResult,
  externalDeploymentId,
  finalizationResult,
}) {
  const completionPhase = completionState?.phase || completionState?.status || "unknown";
  const deployEnvironment =
    executionResult.deployConfigOverrides?.deployTargetEnvironment || "prod";
  const environmentLabel = deployEnvironment === "staging" ? "Staging" : "Production";
  const deployedPullRequests = Array.isArray(finalizationResult?.deployedPullRequests)
    ? finalizationResult.deployedPullRequests
    : [];
  const facts = [
    {
      label: "Deployment ID",
      value: externalDeploymentId,
    },
    {
      label: "Provider status",
      value: String(completionPhase),
    },
  ];
  if (finalizationResult) {
    facts.push({
      label: "PRs deployed",
      value: String(finalizationResult.deployedPullRequestCount),
    });
  }

  return {
    tone: "success",
    title: `${environmentLabel} deployment complete`,
    summary: `${environmentLabel} finished successfully.`,
    facts,
    sections: finalizationResult
      ? [
          {
            title: "Changes deployed",
            text: deployedPullRequests.length === 0 ? "No PR details were available." : "",
            items: deployedPullRequests.map((pullRequest) => ({
              title: String(pullRequest?.title || "").trim()
                || `${pullRequest?.repo}#${pullRequest?.pr_number}`,
              url: pullRequest?.url || "",
              description: `${pullRequest?.repo}#${pullRequest?.pr_number}`,
            })),
          },
        ]
      : [],
    context: finalizationResult
      ? "Deployment state and included PRs were committed together."
      : "",
  };
}

function buildDeploymentCompletionFailurePresentation({ externalDeploymentId, error }) {
  const stateCommitFailed = error?.code === "DEPLOY_STATE_ROLLED_BACK";
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
    return `${SLACK_HERE_MENTION} Deployment ${externalDeploymentId} finished, but Calypso could not commit deployment state: ${error.message} No deploy records or PR statuses were committed.`;
  }

  return `${SLACK_HERE_MENTION} Deployment ${externalDeploymentId} failed after trigger: ${error.message}. No deploy records or PR statuses were committed.`;
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

    if (executionResult.shouldFinalizeProductionDeployment) {
      finalizationResult = await calypsoCommandService.finalizeProductionDeployment(
        executionResult.productionDeploymentFinalization,
        commandContext,
      );
    }
    if (
      executionResult.deploymentRunId
      && !executionResult.shouldFinalizeProductionDeployment
    ) {
      await calypsoCommandService.completeDeploymentRun(
        executionResult.deploymentRunId,
        { status: "succeeded" },
        commandContext,
      );
    }

    return {
      completionState,
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
