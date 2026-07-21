const { BaseCalypsoCommand } = require("./base_command");
const { formatPullRequestReference } = require("../../util/format");

class DeployCommand extends BaseCalypsoCommand {
  constructor() {
    super("deploy");
  }

  parse({ commandWords }) {
    const hasEnvironmentArgument = commandWords.length === 2 || commandWords.length === 3;
    const environmentName = (commandWords[1] || "").toLowerCase();
    const forceWord = (commandWords[2] || "").toLowerCase();
    const isForceDeployWord = forceWord === "force" || forceWord === "forced";
    const hasValidForceArgument = commandWords.length === 2 || isForceDeployWord;
    const hasValidEnvironmentName = environmentName === "prod" || environmentName === "staging";
    const isValidDeployCommand =
      hasEnvironmentArgument && hasValidForceArgument && hasValidEnvironmentName;

    if (!isValidDeployCommand) {
      return this.buildRespondParsedCommand(
        [
          "Usage:",
          "`/calypso deploy staging`",
          "`/calypso deploy prod`",
          "`/calypso deploy prod force`",
        ].join("\n"),
      );
    }

    return this.buildParsedCommand({
      action: environmentName === "staging" ? "deploy_staging" : "deploy_prod",
      deployEnvironment: environmentName,
      forceDeployment: isForceDeployWord,
    });
  }

  async checkCallerAccess({ runtime }) {
    const deployAccess = await runtime.resolveDeployAccessFn(runtime);
    if (!deployAccess.canDeploy) {
      return this.denyAccess(
        [
          "Deploy denied.",
          "Only workspace admins or whitelisted users can deploy.",
          "Ask a workspace admin to run `/calypso whitelist <@USER>`.",
        ].join("\n"),
      );
    }

    return this.allowAccess();
  }

  async execute({ parsedCommand, runtime }) {
    if (!runtime.pool) {
      return this.buildExecutionResult("Deploy command unavailable: database pool is not configured.");
    }

    const deployEnvironment = this.resolveDeployEnvironment(parsedCommand);
    const isProductionDeploy = deployEnvironment === "prod";
    const forceDeployment = Boolean(parsedCommand.forceDeployment);
    const channelTopicGuardDecision = await this.evaluateChannelTopicGuard({
      runtime,
      deployEnvironment,
    });
    if (!channelTopicGuardDecision.isAllowed) {
      return this.buildExecutionResult(channelTopicGuardDecision.reasonText);
    }
    let deployGateState = {
      blockingPullRequests: [],
      lastProductionDeploymentAt: null,
    };
    let blockingPullRequestCount = 0;

    if (isProductionDeploy) {
      deployGateState = await this.readDeployGateState(runtime);
      blockingPullRequestCount = deployGateState.blockingPullRequests.length;

      if (blockingPullRequestCount > 0 && !forceDeployment) {
        return this.buildExecutionResult(
          [
            "Deploy blocked due to untested PRs:",
            ...deployGateState.blockingPullRequests.map(
              (pr) =>
                `• ${formatPullRequestReference({ repo: pr.repo, prNumber: pr.pr_number, url: pr.url })} (${pr.status})`,
            ),
          ].join("\n"),
        );
      }

      if (forceDeployment) {
        const forceDeployBlockedPullRequests = readForceDeployBlockedPullRequests(
          deployGateState.blockingPullRequests,
        );
        if (forceDeployBlockedPullRequests.length > 0) {
          return this.buildExecutionResult(
            [
              "Force deploy blocked.",
              "These PRs are marked as must-test and cannot be bypassed:",
              ...forceDeployBlockedPullRequests.map(
                (pr) =>
                  `• ${formatPullRequestReference({ repo: pr.repo, prNumber: pr.pr_number, url: pr.url })} (${pr.status})`,
              ),
              "Mark them tested with `/calypso tested <PR_NUMBER>` or clear the requirement with `/calypso must-test off <PR_NUMBER>`.",
            ].join("\n"),
          );
        }
      }
    }

    const deployConfiguration = this.resolveDeployConfiguration(
      runtime.deployConfig,
      deployEnvironment,
    );
    if (!this.hasDeployConfiguration(deployConfiguration)) {
      if (isProductionDeploy && forceDeployment && blockingPullRequestCount > 0) {
        return this.buildExecutionResult(
          `Force deploy bypassed ${blockingPullRequestCount} blocking PR(s), but deploy not configured.`,
        );
      }

      if (isProductionDeploy) {
        return this.buildExecutionResult("Deploy gate is clear, but deploy not configured.");
      }

      return this.buildExecutionResult("Deploy to staging is not configured.");
    }

    try {
      const productionDeploymentPlan = isProductionDeploy
        ? await this.readProductionDeploymentPlan({
            runtime,
            lastProductionDeploymentAt: deployGateState.lastProductionDeploymentAt,
            includeUntested: forceDeployment,
          })
        : null;
      const deployResult = await runtime.triggerProdDeployFn(deployConfiguration);
      const deploymentTriggeredBy = await this.resolveDeploymentTriggeredBy(runtime);
      const deployProvider =
        deployResult.deployProvider || deployConfiguration.deployProvider || "digitalocean";
      const externalDeploymentId = deployResult.externalDeployId || null;
      const deploymentId = externalDeploymentId || "n/a";
      const shouldNotifyDeploymentCompletion =
        runtime.enableDeploymentCompletionNotifications &&
        Boolean(externalDeploymentId);
      const plannedPullRequestSummaryText = isProductionDeploy
        ? await this.buildPlannedPullRequestSummary({
            runtime,
            plannedPullRequests: productionDeploymentPlan.plannedPullRequests,
          })
        : "";
      const missingDeploymentIdText =
        isProductionDeploy && !externalDeploymentId
          ? "Calypso will not mark PRs deployed automatically because the deploy provider did not return a deployment id."
          : "";

      if (isProductionDeploy && forceDeployment && blockingPullRequestCount > 0) {
        return this.buildExecutionResult(
          this.appendDeploymentSummary(
            [
              `Force deploy to prod is in progress (id: ${deploymentId}). Triggered by ${deploymentTriggeredBy}. Bypassed ${blockingPullRequestCount} blocking PR(s).`,
              missingDeploymentIdText,
            ].filter(Boolean).join(" "),
            plannedPullRequestSummaryText,
          ),
          this.buildDeploymentExecutionFields({
            externalDeploymentId,
            deployProvider,
            shouldNotifyDeploymentCompletion,
            deployConfigOverrides: this.buildDeployConfigOverridesForCompletion(deployConfiguration),
            productionDeploymentFinalization: this.buildProductionDeploymentFinalization({
              isProductionDeploy,
              externalDeploymentId,
              deployProvider,
              productionDeploymentPlan,
            }),
          }),
        );
      }

      if (!isProductionDeploy) {
        return this.buildExecutionResult(
          `Deploy to staging is in progress (id: ${deploymentId}). Triggered by ${deploymentTriggeredBy}.`,
          this.buildDeploymentExecutionFields({
            externalDeploymentId,
            deployProvider,
            shouldNotifyDeploymentCompletion,
            deployConfigOverrides: this.buildDeployConfigOverridesForCompletion(deployConfiguration),
          }),
        );
      }

      return this.buildExecutionResult(
        this.appendDeploymentSummary(
          [
            `Deploy to prod is in progress (id: ${deploymentId}). Triggered by ${deploymentTriggeredBy}.`,
            missingDeploymentIdText,
          ].filter(Boolean).join(" "),
          plannedPullRequestSummaryText,
        ),
        this.buildDeploymentExecutionFields({
          externalDeploymentId,
          deployProvider,
          shouldNotifyDeploymentCompletion,
          deployConfigOverrides: this.buildDeployConfigOverridesForCompletion(deployConfiguration),
          productionDeploymentFinalization: this.buildProductionDeploymentFinalization({
            isProductionDeploy,
            externalDeploymentId,
            deployProvider,
            productionDeploymentPlan,
          }),
        }),
      );
    } catch (error) {
      return this.buildExecutionResult(
        `Deploy failed before deployment state was committed: ${error.message}`,
      );
    }
  }

  async readDeployGateState(runtime) {
    const lastProductionDeploymentAt = await runtime.getLastProdDeployAtFn(runtime.pool);
    const blockingPullRequests = await runtime.listBlockingPullRequestsFn(
      runtime.pool,
      lastProductionDeploymentAt,
    );

    return {
      blockingPullRequests,
      lastProductionDeploymentAt,
    };
  }

  async readProductionDeploymentPlan({
    runtime,
    lastProductionDeploymentAt,
    includeUntested,
  }) {
    const deploymentCutoffAt = new Date();
    const plannedPullRequests = await runtime.listDeployablePullRequestsForDeploymentFn(
      runtime.pool,
      lastProductionDeploymentAt,
      deploymentCutoffAt,
      { includeUntested },
    );

    return {
      deploymentCutoffAt,
      plannedPullRequests: normalizeDeployedPullRequests(plannedPullRequests),
    };
  }

  hasDeployConfiguration(deployConfig) {
    const deployToken = deployConfig.deployToken || deployConfig.digitaloceanToken;
    const deployAppId = deployConfig.deployProductionAppId;
    const hasDigitalOceanConfig = Boolean(deployToken) && Boolean(deployAppId);
    const hasAwsConfig = Boolean(
      deployAppId &&
        deployConfig.deployRegion &&
        deployConfig.deployAccessKeyId &&
        deployConfig.deploySecretAccessKey,
    );

    return hasDigitalOceanConfig || hasAwsConfig;
  }

  resolveDeployEnvironment(parsedCommand) {
    const rawEnvironment = String(parsedCommand.deployEnvironment || "prod").trim().toLowerCase();
    if (rawEnvironment === "staging") {
      return "staging";
    }
    return "prod";
  }

  async evaluateChannelTopicGuard({ runtime, deployEnvironment }) {
    const resolveCurrentChannelTopicFn = runtime.resolveCurrentChannelTopicFn;
    if (typeof resolveCurrentChannelTopicFn !== "function") {
      return { isAllowed: true };
    }

    const channelTopic = await resolveCurrentChannelTopicFn(runtime);
    if (typeof channelTopic !== "string" || channelTopic.trim() === "") {
      return { isAllowed: true };
    }

    const topicStatus = readDeployAvailabilityFromTopic(channelTopic, deployEnvironment);
    if (topicStatus !== "blocked") {
      return { isAllowed: true };
    }

    return {
      isAllowed: false,
      reasonText: [
        `Cannot deploy to ${deployEnvironment} from this channel right now.`,
        "Channel topic indicates deploy is not allowed for that environment (red status).",
      ].join(" "),
    };
  }

  resolveDeployConfiguration(deployConfig = {}, deployEnvironment = "prod") {
    const deployProductionAppId = deployConfig.deployProductionAppId || deployConfig.doAppIdProd;
    const deployStagingAppId = deployConfig.deployStagingAppId || deployConfig.doAppIdStaging;
    const selectedAppId =
      deployEnvironment === "staging" ? deployStagingAppId || "" : deployProductionAppId || "";

    return {
      ...deployConfig,
      deployTargetEnvironment: deployEnvironment,
      deployProductionAppId: selectedAppId,
    };
  }

  buildDeployConfigOverridesForCompletion(deployConfiguration) {
    return {
      deployTargetEnvironment: deployConfiguration.deployTargetEnvironment,
      deployProductionAppId: deployConfiguration.deployProductionAppId,
    };
  }

  async resolveDeploymentTriggeredBy(runtime) {
    const callerUserId = String(runtime.userId || "").trim();
    if (callerUserId !== "" && isSlackCommunicationProvider(runtime.communicationProvider)) {
      return formatSlackUserMention(callerUserId);
    }

    const callerUserName = String(runtime.callerUserName || "").trim();
    if (callerUserName !== "") {
      return callerUserName;
    }

    const resolveUserDisplayNameFn = runtime.resolveUserDisplayNameFn;
    if (callerUserId !== "" && typeof resolveUserDisplayNameFn === "function") {
      try {
        const displayName = await resolveUserDisplayNameFn(
          runtime.communicationClient,
          callerUserId,
        );
        const normalizedDisplayName = String(displayName || "").trim();
        if (normalizedDisplayName !== "") {
          return normalizedDisplayName;
        }
      } catch (_error) {
        // Ignore lookup failures and fall back to user id.
      }
    }

    if (callerUserId !== "") {
      return callerUserId;
    }

    return "unknown user";
  }

  appendDeploymentSummary(baseText, deployedPullRequestSummaryText) {
    const normalizedSummaryText = String(deployedPullRequestSummaryText || "").trim();
    if (normalizedSummaryText === "") {
      return baseText;
    }

    return `${baseText}\n${normalizedSummaryText}`;
  }

  async buildPlannedPullRequestSummary({ runtime, plannedPullRequests }) {
    return buildDeploymentPullRequestSummary({
      runtime,
      heading: "PRs to deploy:",
      pullRequestCount: plannedPullRequests.length,
      pullRequests: plannedPullRequests,
      detailsUnavailableText: "PR(s) planned for deployment (details unavailable).",
    });
  }

  resolveResponseType({ executionResult }) {
    return executionResult.deployTriggered ? "in_channel" : "ephemeral";
  }

  resolveFollowUpResponseType({ executionResult, responseType }) {
    if (executionResult.deployTriggered) {
      return "in_channel";
    }

    return responseType;
  }

  buildDeploymentExecutionFields({
    externalDeploymentId,
    deployProvider,
    shouldNotifyDeploymentCompletion,
    deployConfigOverrides,
    productionDeploymentFinalization,
  }) {
    return {
      deployTriggered: true,
      externalDeploymentId,
      deployProvider: deployProvider || null,
      deployConfigOverrides: deployConfigOverrides || {},
      shouldNotifyDeploymentCompletion,
      shouldFinalizeProductionDeployment: Boolean(productionDeploymentFinalization),
      productionDeploymentFinalization: productionDeploymentFinalization || null,
    };
  }

  buildProductionDeploymentFinalization({
    isProductionDeploy,
    externalDeploymentId,
    deployProvider,
    productionDeploymentPlan,
  }) {
    if (!isProductionDeploy || !externalDeploymentId || !productionDeploymentPlan) {
      return null;
    }

    return {
      externalDeploymentId,
      deployProvider,
      deploymentCutoffAt: productionDeploymentPlan.deploymentCutoffAt,
      plannedPullRequests: productionDeploymentPlan.plannedPullRequests,
    };
  }
}

function readForceDeployBlockedPullRequests(blockingPullRequests) {
  return (Array.isArray(blockingPullRequests) ? blockingPullRequests : []).filter((pullRequest) =>
    isForceDeployBlocked(pullRequest?.force_deploy_blocked),
  );
}

function isForceDeployBlocked(value) {
  if (value === true || value === 1 || value === "1") {
    return true;
  }

  const normalizedValue = String(value || "").trim().toLowerCase();
  return normalizedValue === "true" || normalizedValue === "t";
}

function normalizeDeployedPullRequests(deployedPullRequests) {
  return (Array.isArray(deployedPullRequests) ? deployedPullRequests : [])
    .map((pullRequest) => ({
      repo: String(pullRequest?.repo || "").trim(),
      pr_number: pullRequest?.pr_number,
      title: String(pullRequest?.title || "").trim() || null,
      url: String(pullRequest?.url || "").trim() || null,
      author_login: String(pullRequest?.author_login || "").trim() || null,
    }))
    .filter((pullRequest) => Boolean(pullRequest.repo) && pullRequest.pr_number !== undefined);
}

async function buildDeploymentPullRequestSummary({
  runtime,
  heading,
  pullRequestCount,
  pullRequests,
  detailsUnavailableText,
}) {
  const normalizedDeployedPullRequests = normalizeDeployedPullRequests(pullRequests);
  if (normalizedDeployedPullRequests.length === 0) {
    const parsedPullRequestCount = Number(pullRequestCount);
    if (Number.isFinite(parsedPullRequestCount) && parsedPullRequestCount > 0) {
      return `${heading}\n• ${parsedPullRequestCount} ${detailsUnavailableText}`;
    }
    return `${heading}\n• none.`;
  }

  const githubUsernames = [...new Set(
    normalizedDeployedPullRequests
      .map((pullRequest) => normalizeGithubUsername(pullRequest.author_login))
      .filter(Boolean),
  )];
  const slackUsernameByGithubUsername = await resolveSlackUsernameByGithubUsername({
    runtime,
    githubUsernames,
  });

  return [
    heading,
    ...normalizedDeployedPullRequests.map((pullRequest) =>
      formatDeployedPullRequestLine({
        pullRequest,
        slackUsernameByGithubUsername,
      }),
    ),
  ].join("\n");
}

async function resolveSlackUsernameByGithubUsername({ runtime, githubUsernames }) {
  if (!runtime.pool || typeof runtime.listGithubSlackUserMappingsFn !== "function") {
    return new Map();
  }

  try {
    const githubToSlackUserMapping = await runtime.listGithubSlackUserMappingsFn(
      runtime.pool,
      githubUsernames,
    );
    return normalizeGithubToSlackUserMapping(githubToSlackUserMapping);
  } catch (_error) {
    return new Map();
  }
}

function normalizeGithubToSlackUserMapping(githubToSlackUserMapping) {
  const mappings = new Map();
  if (githubToSlackUserMapping instanceof Map) {
    for (const [githubUsername, slackUsername] of githubToSlackUserMapping.entries()) {
      const normalizedGithubUsername = normalizeGithubUsername(githubUsername);
      const normalizedSlackUsername = normalizeSlackUsername(slackUsername);
      if (normalizedGithubUsername && normalizedSlackUsername) {
        mappings.set(normalizedGithubUsername, normalizedSlackUsername);
      }
    }
    return mappings;
  }

  if (
    githubToSlackUserMapping &&
    typeof githubToSlackUserMapping === "object" &&
    !Array.isArray(githubToSlackUserMapping)
  ) {
    for (const [githubUsername, slackUsername] of Object.entries(githubToSlackUserMapping)) {
      const normalizedGithubUsername = normalizeGithubUsername(githubUsername);
      const normalizedSlackUsername = normalizeSlackUsername(slackUsername);
      if (normalizedGithubUsername && normalizedSlackUsername) {
        mappings.set(normalizedGithubUsername, normalizedSlackUsername);
      }
    }
  }

  return mappings;
}

function normalizeGithubUsername(githubUsername) {
  const normalizedGithubUsername = String(githubUsername || "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
  if (normalizedGithubUsername === "") {
    return null;
  }

  return normalizedGithubUsername;
}

function normalizeSlackUsername(slackUsername) {
  const normalizedSlackReference = String(slackUsername || "").trim();
  const mentionMatch = normalizedSlackReference.match(/^<@([UW][A-Z0-9]*[0-9][A-Z0-9]*)(?:\|[^>]+)?>$/i);
  if (mentionMatch) {
    return mentionMatch[1].toUpperCase();
  }

  const userIdMatch = normalizedSlackReference.match(/^([UW][A-Z0-9]*[0-9][A-Z0-9]*)$/i);
  if (userIdMatch) {
    return userIdMatch[1].toUpperCase();
  }

  const normalizedSlackUsername = normalizedSlackReference
    .replace(/^@/, "")
    .toLowerCase();
  if (normalizedSlackUsername === "") {
    return null;
  }

  return normalizedSlackUsername;
}

function formatDeployedPullRequestLine({
  pullRequest,
  slackUsernameByGithubUsername,
}) {
  const pullRequestTitleReference = formatDeployedPullRequestTitleReference(pullRequest);
  const pullRequestAuthor = formatDeployedPullRequestAuthor({
    pullRequest,
    slackUsernameByGithubUsername,
  });
  return `• ${pullRequestTitleReference} by ${pullRequestAuthor}.`;
}

function formatDeployedPullRequestTitleReference(pullRequest) {
  const normalizedTitle = String(pullRequest?.title || "").trim();
  if (normalizedTitle && pullRequest?.url) {
    return `<${pullRequest.url}|${normalizedTitle}>`;
  }
  if (normalizedTitle) {
    return normalizedTitle;
  }

  return formatPullRequestReference({
    repo: pullRequest?.repo,
    prNumber: pullRequest?.pr_number,
    url: pullRequest?.url,
  });
}

function formatDeployedPullRequestAuthor({
  pullRequest,
  slackUsernameByGithubUsername,
}) {
  const normalizedGithubUsername = normalizeGithubUsername(pullRequest?.author_login);
  if (normalizedGithubUsername) {
    const mappedSlackUsername = slackUsernameByGithubUsername.get(normalizedGithubUsername);
    if (mappedSlackUsername) {
      if (isSlackUserId(mappedSlackUsername)) {
        return `<@${mappedSlackUsername}>`;
      }
      return `@${mappedSlackUsername}`;
    }

    return `${normalizedGithubUsername} (github username since no matching slack username)`;
  }

  return "unknown (github username since no matching slack username)";
}

function isSlackUserId(value) {
  return /^([UW][A-Z0-9]*[0-9][A-Z0-9]*)$/i.test(String(value || "").trim());
}

function isSlackCommunicationProvider(provider) {
  return String(provider || "slack").trim().toLowerCase() === "slack";
}

function formatSlackUserMention(userId) {
  return `<@${userId}>`;
}

function readDeployAvailabilityFromTopic(topicText, deployEnvironment) {
  const rawTopic = String(topicText || "");
  const segment = readEnvironmentTopicSegment(rawTopic, deployEnvironment);
  if (!segment) {
    return "unknown";
  }

  const normalizedSegment = segment.toLowerCase();
  const hasRedStatus = [":red_circle:", ":large_red_circle:", "🔴"].some((token) =>
    normalizedSegment.includes(token.toLowerCase()),
  );
  if (hasRedStatus) {
    return "blocked";
  }

  const hasGreenStatus = [":green_circle:", ":large_green_circle:", "🟢"].some((token) =>
    normalizedSegment.includes(token.toLowerCase()),
  );
  if (hasGreenStatus) {
    return "allowed";
  }

  return "unknown";
}

function readEnvironmentTopicSegment(topicText, deployEnvironment) {
  const normalizedEnvironment = String(deployEnvironment || "").toLowerCase();
  const targetLabel =
    normalizedEnvironment === "prod" ? "(?:prod|production)" : "(?:staging)";
  const otherLabel =
    normalizedEnvironment === "prod" ? "(?:staging)" : "(?:prod|production)";
  const pattern = new RegExp(
    `\\b${targetLabel}\\b\\s*:\\s*(.*?)(?=\\b${otherLabel}\\b\\s*:|$)`,
    "i",
  );
  const match = String(topicText || "").match(pattern);
  return match?.[1] ? String(match[1]).trim() : "";
}

module.exports = {
  DeployCommand,
  buildDeploymentPullRequestSummary,
};
