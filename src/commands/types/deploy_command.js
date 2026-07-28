const { BaseCalypsoCommand } = require("./base_command");
const { formatPullRequestReference } = require("../../util/format");

class DeployCommand extends BaseCalypsoCommand {
  constructor() {
    super("deploy");
  }

  parse({ commandWords }) {
    if (commandWords.length === 1) {
      return this.buildParsedCommand({
        action: "deploy_default",
        deployEnvironment: null,
      });
    }

    const environmentName = (commandWords[1] || "").toLowerCase();
    if (commandWords.length === 2 && environmentName === "list") {
      return this.buildParsedCommand({
        commandName: "status",
        action: "status",
      });
    }

    const hasValidEnvironmentName = environmentName === "prod" || environmentName === "staging";
    const isValidDeployCommand = commandWords.length === 2 && hasValidEnvironmentName;

    if (!isValidDeployCommand) {
      return this.buildRespondParsedCommand(
        [
          "Usage:",
          "`/calypso deploy`",
          "`/calypso deploy staging`",
          "`/calypso deploy prod`",
          "`/calypso deploy list`",
        ].join("\n"),
      );
    }

    return this.buildParsedCommand({
      action: environmentName === "staging" ? "deploy_staging" : "deploy_prod",
      deployEnvironment: environmentName,
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
    if (parsedCommand.action === "respond") {
      return this.buildExecutionResult(parsedCommand.responseText);
    }

    if (!runtime.pool) {
      return this.buildExecutionResult("Deploy command unavailable: database pool is not configured.");
    }

    const deployEnvironment = await this.resolveDeployEnvironment(parsedCommand, runtime);
    const isProductionDeploy = deployEnvironment === "prod";
    const channelTopicGuardDecision = await this.evaluateChannelTopicGuard({
      runtime,
      deployEnvironment,
    });
    if (!channelTopicGuardDecision.isAllowed) {
      return this.buildExecutionResult(channelTopicGuardDecision.reasonText, {
        presentation: {
          tone: "danger",
          title: `${formatEnvironmentLabel(deployEnvironment)} deployment unavailable`,
          summary: channelTopicGuardDecision.reasonText,
          context: "The channel topic currently marks this environment red.",
        },
      });
    }
    let deployGateState = {
      blockingPullRequests: [],
      lastProductionDeploymentAt: null,
    };
    let blockingPullRequestCount = 0;

    if (isProductionDeploy) {
      deployGateState = await this.readDeployGateState(runtime);
      blockingPullRequestCount = deployGateState.blockingPullRequests.length;

      if (blockingPullRequestCount > 0) {
        return this.buildExecutionResult(
          [
            "Deploy blocked due to untested PRs:",
            ...deployGateState.blockingPullRequests.map(
              (pr) =>
                `• ${formatPullRequestReference({ repo: pr.repo, prNumber: pr.pr_number, url: pr.url })} (${pr.status})`,
            ),
          ].join("\n"),
          {
            presentation: buildBlockedDeploymentPresentation(
              deployGateState.blockingPullRequests,
            ),
          },
        );
      }
    }

    const deployConfiguration = this.resolveDeployConfiguration(
      runtime.deployConfig,
      deployEnvironment,
    );
    if (!this.hasDeployConfiguration(deployConfiguration)) {
      if (isProductionDeploy) {
        return this.buildExecutionResult("Deploy gate is clear, but deploy not configured.", {
          presentation: buildDeploymentNotConfiguredPresentation(deployEnvironment),
        });
      }

      return this.buildExecutionResult("Deploy to staging is not configured.", {
        presentation: buildDeploymentNotConfiguredPresentation(deployEnvironment),
      });
    }

    try {
      const productionDeploymentPlan = isProductionDeploy
        ? await this.readProductionDeploymentPlan({
            runtime,
            lastProductionDeploymentAt: deployGateState.lastProductionDeploymentAt,
            includeUntested: false,
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

      if (!isProductionDeploy) {
        return this.buildExecutionResult(
          `Deploy to staging is in progress (id: ${deploymentId}). Triggered by ${deploymentTriggeredBy}.`,
          this.buildDeploymentExecutionFields({
            externalDeploymentId,
            deployProvider,
            shouldNotifyDeploymentCompletion,
            deployConfigOverrides: this.buildDeployConfigOverridesForCompletion(deployConfiguration),
            presentation: buildDeploymentStartedPresentation({
              deployEnvironment,
              deployProvider,
              deploymentId,
              deploymentTriggeredBy,
              shouldNotifyDeploymentCompletion,
            }),
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
          presentation: buildDeploymentStartedPresentation({
            deployEnvironment,
            deployProvider,
            deploymentId,
            deploymentTriggeredBy,
            missingDeploymentIdText,
            plannedPullRequests: productionDeploymentPlan.plannedPullRequests,
            shouldNotifyDeploymentCompletion,
          }),
        }),
      );
    } catch (error) {
      return this.buildExecutionResult(
        `Deploy failed before deployment state was committed: ${error.message}`,
        {
          presentation: {
            tone: "danger",
            title: "Deployment could not start",
            summary: error.message,
            context: "No deployment record or PR status was changed.",
          },
        },
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

  async resolveDeployEnvironment(parsedCommand, runtime) {
    let rawEnvironment = String(parsedCommand.deployEnvironment || "").trim().toLowerCase();
    if (rawEnvironment === "" && typeof runtime.getRuntimeProviderConfigFn === "function") {
      const runtimeConfig = await runtime.getRuntimeProviderConfigFn(runtime.pool);
      rawEnvironment = String(runtimeConfig.deployEnvironment || "").trim().toLowerCase();
    }
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
    presentation,
  }) {
    return {
      deployTriggered: true,
      externalDeploymentId,
      deployProvider: deployProvider || null,
      deployConfigOverrides: deployConfigOverrides || {},
      shouldNotifyDeploymentCompletion,
      shouldFinalizeProductionDeployment: Boolean(productionDeploymentFinalization),
      productionDeploymentFinalization: productionDeploymentFinalization || null,
      presentation: presentation || null,
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

function buildBlockedDeploymentPresentation(blockingPullRequests) {
  const blockers = Array.isArray(blockingPullRequests) ? blockingPullRequests : [];
  const blockerLabel = blockers.length === 1 ? "PR still needs" : "PRs still need";

  return {
    tone: "danger",
    title: "Production deployment blocked",
    summary: `${blockers.length} ${blockerLabel} testing before production can deploy.`,
    facts: [
      {
        label: "Environment",
        value: "Production",
      },
      {
        label: "Blocking PRs",
        value: String(blockers.length),
      },
    ],
    sections: [
      {
        title: "Needs testing",
        items: blockers.map((pullRequest) => ({
          title: [
            `${String(pullRequest?.repo || "").trim()}#${pullRequest?.pr_number}`,
            String(pullRequest?.title || "").trim(),
          ].filter(Boolean).join(" — "),
          url: pullRequest?.url || "",
          description: `Status: ${String(pullRequest?.status || "untested").toLowerCase()}`,
        })),
      },
    ],
    context: "Verify each change, then run `/calypso tested <PR_NUMBER>`.",
  };
}

function buildDeploymentStartedPresentation({
  deployEnvironment,
  deployProvider,
  deploymentId,
  deploymentTriggeredBy,
  missingDeploymentIdText,
  plannedPullRequests,
  shouldNotifyDeploymentCompletion,
}) {
  const environmentLabel = formatEnvironmentLabel(deployEnvironment);
  const pullRequests = Array.isArray(plannedPullRequests) ? plannedPullRequests : [];
  const sections = [];

  if (deployEnvironment === "prod") {
    sections.push({
      title: "Changes included",
      text: pullRequests.length === 0 ? "No tested PRs are queued for this deployment." : "",
      items: pullRequests.map((pullRequest) => ({
        title: String(pullRequest?.title || "").trim()
          || `${pullRequest?.repo}#${pullRequest?.pr_number}`,
        url: pullRequest?.url || "",
        description: `${pullRequest?.repo}#${pullRequest?.pr_number} · ${
          pullRequest?.tested ? "Tested" : "Included"
        }`,
      })),
    });
  }

  return {
    tone: "info",
    title: `${environmentLabel} deployment started`,
    summary: missingDeploymentIdText || `${environmentLabel} is now deploying.`,
    facts: [
      {
        label: "Deployment ID",
        value: String(deploymentId || "n/a"),
      },
      {
        label: "Provider",
        value: formatProviderLabel(deployProvider),
      },
      {
        label: "Triggered by",
        value: deploymentTriggeredBy,
      },
    ],
    sections,
    context: missingDeploymentIdText
      ? "Calypso will not update deployment state automatically."
      : shouldNotifyDeploymentCompletion
        ? "Calypso will post again when the provider reports completion."
        : "The deployment was handed off to the configured provider.",
  };
}

function buildDeploymentNotConfiguredPresentation(deployEnvironment) {
  const environmentLabel = formatEnvironmentLabel(deployEnvironment);
  return {
    tone: "warning",
    title: `${environmentLabel} deployment is not configured`,
    summary: deployEnvironment === "prod"
      ? "The deploy gate is clear, but Calypso cannot start production."
      : "Calypso cannot start a staging deployment.",
    facts: [
      {
        label: "Environment",
        value: environmentLabel,
      },
    ],
    context: "Configure the selected deploy provider and environment target, then try again.",
  };
}

function formatEnvironmentLabel(deployEnvironment) {
  return deployEnvironment === "prod" ? "Production" : "Staging";
}

function formatProviderLabel(provider) {
  const normalizedProvider = String(provider || "").trim().toLowerCase();
  if (normalizedProvider === "digitalocean") {
    return "DigitalOcean";
  }
  if (normalizedProvider === "aws") {
    return "AWS CodePipeline";
  }
  return normalizedProvider || "Unknown";
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
  const testedText = pullRequest.tested ? " (tested)" : "";
  return `• ${pullRequestTitleReference} by ${pullRequestAuthor}${testedText}.`;
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
