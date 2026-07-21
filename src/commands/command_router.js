const { parseCalypsoCommand } = require("./parsing/command_parser");
const { createCalypsoCommandService } = require("./services/command_service");
const { DEFAULT_BOT_NAME } = require("../config");

const SLACK_HERE_MENTION = "<!here>";

function handleCalypsoCommand({ text, user_id, botName }) {
  void user_id;
  return parseCalypsoCommand({ text, botName });
}

function registerCalypsoCommand(app, options = {}) {
  const botName = resolveBotName(options.botName);
  const calypsoCommandService = createCalypsoCommandService(options);

  app.command("/calypso", async ({ client, command, ack, respond }) => {
    await ack();

    try {
      const parsedCommand = parseCalypsoCommand({
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
        sendInterimResponseFn: async ({ responseType, text }) => {
          await respond({
            response_type: normalizeResponseType(responseType),
            text,
          });
        },
      });

      await respond({
        response_type: normalizeResponseType(executionResult.responseType),
        text: executionResult.responseText,
      });

      await sendDeploymentCompletionFollowUpIfNeeded({
        calypsoCommandService,
        userId,
        executionResult,
        communicationClient: client,
        respond,
      });
    } catch (error) {
      console.error("Failed to process /calypso command.");
      console.error(error.message);
      await respond({
        response_type: "ephemeral",
        text: `${botName} hit an error while processing that command.`,
      });
    }
  });
}

async function sendDeploymentCompletionFollowUpIfNeeded({
  calypsoCommandService,
  communicationClient,
  executionResult,
  userId,
  respond,
}) {
  const shouldNotifyCompletion = Boolean(executionResult.shouldNotifyDeploymentCompletion);
  const shouldFinalizeProductionDeployment = Boolean(
    executionResult.shouldFinalizeProductionDeployment,
  );
  const externalDeploymentId = executionResult.externalDeploymentId || null;
  if ((!shouldNotifyCompletion && !shouldFinalizeProductionDeployment) || !externalDeploymentId) {
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

    await respond({
      response_type: normalizeResponseType(
        executionResult.followUpResponseType || executionResult.responseType,
      ),
      text: await buildDeploymentCompletionSuccessText({
        calypsoCommandService,
        communicationClient,
        completionState,
        executionResult,
        externalDeploymentId,
        finalizationResult,
        userId,
      }),
    });
  } catch (error) {
    await respond({
      response_type: normalizeResponseType(
        executionResult.followUpResponseType || executionResult.responseType,
      ),
      text: buildDeploymentCompletionFailureText({
        externalDeploymentId,
        error,
      }),
    });
  }
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

  return {
    completionState,
    finalizationResult,
  };
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
