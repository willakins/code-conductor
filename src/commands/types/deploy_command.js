const { randomUUID } = require("node:crypto");

const { BaseCalypsoCommand } = require("./base_command");
const { formatPullRequestReference } = require("../../util/format");
const {
  readDeployAvailabilityFromTopic,
} = require("../../shared/deploy_availability");
const {
  evaluateDeploymentGate,
  readMustTestBlockingPullRequests,
} = require("../../shared/gate_decision");

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
    if (
      commandWords.length === 4
      && (environmentName === "prod" || environmentName === "staging")
      && String(commandWords[2] || "").toLowerCase() === "confirm"
      && String(commandWords[3] || "").trim()
    ) {
      return this.buildParsedCommand({
        action: "deploy_confirm",
        confirmationToken: commandWords[3],
        deployEnvironment: environmentName,
      });
    }
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
          "`/conductor deploy`",
          "`/conductor deploy staging`",
          "`/conductor deploy prod`",
          "`/conductor deploy list`",
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
          "Ask a workspace admin to run `/conductor whitelist <@USER>`.",
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
    let deployGateState = {
      blockingPullRequests: [],
      lastProductionDeploymentAt: null,
    };
    if (isProductionDeploy) {
      deployGateState = await this.readDeployGateState(runtime);
    }
    const deploymentBlockingPullRequests = isProductionDeploy
      ? readMustTestBlockingPullRequests(deployGateState.blockingPullRequests)
      : [];
    const gateDecision = await this.readGateDecision({
      blockingPullRequests: deploymentBlockingPullRequests,
      deployEnvironment,
      runtime,
    });
    if (!gateDecision.allowed) {
      return this.buildBlockedDeploymentResult({
        blockingPullRequests: deploymentBlockingPullRequests,
        deployEnvironment,
        gateDecision,
      });
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

    if (runtime.enableGateControl && parsedCommand.action !== "deploy_confirm") {
      const productionDeploymentPlan = isProductionDeploy
        ? await this.readProductionDeploymentPlan({
            runtime,
            lastProductionDeploymentAt: deployGateState.lastProductionDeploymentAt,
            includeUntested: true,
          })
        : { mustTestBlockingPullRequests: [], plannedPullRequests: [] };
      const plannedMustTestBlock = this.buildPlannedMustTestBlockResult(
        productionDeploymentPlan.mustTestBlockingPullRequests,
      );
      if (plannedMustTestBlock) {
        return plannedMustTestBlock;
      }
      const confirmation = await runtime.createDeploymentConfirmationFn(runtime.pool, {
        environment: deployEnvironment,
        requestedBy: runtime.userId,
        token: randomUUID(),
      });
      return this.buildExecutionResult(
        `${formatEnvironmentLabel(deployEnvironment)} deployment is ready for confirmation.`,
        {
          presentation: buildDeploymentConfirmationPresentation({
            confirmation,
            deployEnvironment,
            plannedPullRequests: productionDeploymentPlan.plannedPullRequests,
          }),
        },
      );
    }

    if (runtime.enableGateControl) {
      const confirmation = await runtime.consumeDeploymentConfirmationFn(runtime.pool, {
        environment: deployEnvironment,
        requestedBy: runtime.userId,
        token: parsedCommand.confirmationToken,
      });
      if (!confirmation) {
        return this.buildExecutionResult(
          "Deployment confirmation is invalid, expired, already used, or belongs to another user. Run the deploy command again.",
        );
      }
    }

    let deploymentRun = null;
    let deployProvider = deployConfiguration.deployProvider || "digitalocean";
    let externalDeploymentId = null;
    let productionDeploymentPlan = null;
    let providerTriggered = false;
    try {
      productionDeploymentPlan = isProductionDeploy
        ? await this.readProductionDeploymentPlan({
            runtime,
            lastProductionDeploymentAt: deployGateState.lastProductionDeploymentAt,
            includeUntested: true,
          })
        : null;
      const plannedMustTestBlock = this.buildPlannedMustTestBlockResult(
        productionDeploymentPlan?.mustTestBlockingPullRequests,
      );
      if (plannedMustTestBlock) {
        return plannedMustTestBlock;
      }
      const reservation = runtime.enableGateControl
        ? await runtime.reserveDeploymentRunFn(runtime.pool, {
            actorUserId: runtime.userId,
            environment: deployEnvironment,
            provider: deployConfiguration.deployProvider,
          })
        : { acquired: true, run: { id: null, environment: deployEnvironment } };
      if (!reservation.acquired) {
        return this.buildExecutionResult(
          `Cannot deploy to ${deployEnvironment}: deployment run #${reservation.run?.id || "unknown"} is already active.`,
        );
      }
      deploymentRun = reservation.run;
      if (runtime.enableGateControl) await runtime.insertAuditEventFn(runtime.pool, {
        actorUserId: runtime.userId,
        environment: deployEnvironment,
        eventType: "deployment_reserved",
        metadata: { runId: deploymentRun.id },
        summary: `${formatEnvironmentLabel(deployEnvironment)} deployment run #${deploymentRun.id} reserved.`,
      });

      const deployResult = await runtime.triggerProdDeployFn(deployConfiguration);
      providerTriggered = true;
      deployProvider =
        deployResult.deployProvider || deployConfiguration.deployProvider || "digitalocean";
      externalDeploymentId = deployResult.externalDeployId || null;
      const deploymentTriggeredBy = await this.resolveDeploymentTriggeredBy(runtime);
      if (runtime.enableGateControl) await runtime.markDeploymentRunTriggeredFn(runtime.pool, deploymentRun.id, {
        externalDeploymentId,
        provider: deployProvider,
      });
      if (runtime.enableGateControl) await runtime.insertAuditEventFn(runtime.pool, {
        actorUserId: runtime.userId,
        environment: deployEnvironment,
        eventType: "deployment_triggered",
        metadata: { externalDeploymentId, runId: deploymentRun.id },
        summary: `${formatEnvironmentLabel(deployEnvironment)} deployment run #${deploymentRun.id} triggered.`,
      });
      if (runtime.enableGateControl && !externalDeploymentId) {
        await runtime.completeDeploymentRunFn(runtime.pool, deploymentRun.id, {
          status: "untracked",
        });
        await runtime.insertAuditEventFn(runtime.pool, {
          actorUserId: runtime.userId,
          environment: deployEnvironment,
          eventType: "deployment_untracked",
          metadata: { runId: deploymentRun.id },
          summary: `${formatEnvironmentLabel(deployEnvironment)} deployment run #${deploymentRun.id} was accepted without a provider ID; completion cannot be monitored.`,
        });
      }
      const deploymentId = externalDeploymentId || "n/a";
      const shouldNotifyDeploymentCompletion =
        runtime.enableDeploymentCompletionNotifications &&
        Boolean(externalDeploymentId);
      const slackUsernameByGithubUsername = isProductionDeploy
        ? await resolveSlackUsernameMappingsForPullRequests({
            runtime,
            pullRequests: productionDeploymentPlan.plannedPullRequests,
          })
        : new Map();
      const plannedPullRequestSummaryText = isProductionDeploy
        ? await this.buildPlannedPullRequestSummary({
            runtime,
            plannedPullRequests: productionDeploymentPlan.plannedPullRequests,
            slackUsernameByGithubUsername,
          })
        : "";
      const missingDeploymentIdText =
        isProductionDeploy && !externalDeploymentId
          ? "Code Conductor will not mark PRs deployed automatically because the deploy provider did not return a deployment id."
          : "";

      if (!isProductionDeploy) {
        return this.buildExecutionResult(
          `Deploy to staging is in progress (id: ${deploymentId}). Triggered by ${deploymentTriggeredBy}.`,
          this.buildDeploymentExecutionFields({
            deploymentRunId: deploymentRun.id,
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
          deploymentRunId: deploymentRun.id,
          externalDeploymentId,
          deployProvider,
          shouldNotifyDeploymentCompletion,
          deployConfigOverrides: this.buildDeployConfigOverridesForCompletion(deployConfiguration),
          productionDeploymentFinalization: this.buildProductionDeploymentFinalization({
            deploymentRunId: deploymentRun.id,
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
            slackUsernameByGithubUsername,
            shouldNotifyDeploymentCompletion,
          }),
        }),
      );
    } catch (error) {
      if (providerTriggered) {
        return this.buildExecutionResult(
          [
            `Deploy to ${deployEnvironment} was accepted by the provider`,
            externalDeploymentId ? `(id: ${externalDeploymentId}).` : "without a deployment id.",
            `Code Conductor hit a post-trigger tracking error: ${error.message}`,
          ].join(" "),
          this.buildDeploymentExecutionFields({
            deploymentRunId: deploymentRun?.id || null,
            deployConfigOverrides: this.buildDeployConfigOverridesForCompletion(deployConfiguration),
            deployProvider,
            externalDeploymentId,
            productionDeploymentFinalization:
              isProductionDeploy && externalDeploymentId && productionDeploymentPlan
                ? this.buildProductionDeploymentFinalization({
                    deploymentRunId: deploymentRun?.id || null,
                    deployProvider,
                    externalDeploymentId,
                    isProductionDeploy,
                    productionDeploymentPlan,
                  })
                : null,
            shouldNotifyDeploymentCompletion:
              runtime.enableDeploymentCompletionNotifications && Boolean(externalDeploymentId),
            presentation: {
              tone: "warning",
              title: `${formatEnvironmentLabel(deployEnvironment)} deployment accepted`,
              summary: "The provider accepted the deployment, but Code Conductor could not finish post-trigger bookkeeping.",
              facts: [
                { label: "Deployment ID", value: externalDeploymentId || "not returned" },
                { label: "Run", value: String(deploymentRun?.id || "reserved") },
              ],
              context: "Concurrency protection remains active while Code Conductor monitors or the reservation lease expires.",
            },
          }),
        );
      }
      if (runtime.enableGateControl && deploymentRun?.id) {
        await runtime.completeDeploymentRunFn(runtime.pool, deploymentRun.id, {
          failureMessage: error.message,
          status: "failed",
        });
        try {
          await runtime.insertAuditEventFn(runtime.pool, {
            actorUserId: runtime.userId,
            environment: deployEnvironment,
            eventType: "deployment_failed",
            metadata: { failureMessage: error.message, runId: deploymentRun.id },
            summary: `${formatEnvironmentLabel(deployEnvironment)} deployment run #${deploymentRun.id} failed before completion: ${error.message}`,
          });
        } catch (_auditError) {
          // Preserve the provider failure as the user-facing error.
        }
      }
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

  buildBlockedDeploymentResult({
    blockingPullRequests,
    deployEnvironment,
    gateDecision,
  }) {
    const onlyPullRequestBlockers = gateDecision.reasons.every(
      (reason) => reason.code === "untested_pull_requests",
    );
    const topicBlocked = gateDecision.reasons.some(
      (reason) => reason.code === "channel_topic_blocked",
    );
    const responseLead = onlyPullRequestBlockers
      ? "Force deploy blocked."
      : topicBlocked
        ? `Cannot deploy to ${deployEnvironment} from this channel right now.`
        : `Cannot deploy to ${deployEnvironment}:`;
    return this.buildExecutionResult(
      [
        responseLead,
        ...gateDecision.reasons.map((reason) =>
          reason.code === "channel_topic_blocked"
            ? "• Channel topic indicates deploy is not allowed for that environment (red status)."
            : reason.code === "untested_pull_requests"
              ? "• These PRs are marked as must-test and cannot be bypassed:"
              : `• ${reason.message}`),
        ...(onlyPullRequestBlockers
          ? blockingPullRequests.map(
              (pr) =>
                `• ${formatPullRequestReference({ repo: pr.repo, prNumber: pr.pr_number, url: pr.url })} (${pr.status})`,
            )
          : []),
        ...(onlyPullRequestBlockers
          ? ["Mark them tested with `/conductor tested <PR_NUMBER>` or clear the requirement with `/conductor must-test off <PR_NUMBER>`."]
          : []),
      ].join("\n"),
      {
        presentation: buildBlockedDeploymentPresentation(
          blockingPullRequests,
          gateDecision,
        ),
      },
    );
  }

  buildPlannedMustTestBlockResult(plannedPullRequests) {
    const blockers = readMustTestBlockingPullRequests(plannedPullRequests);
    if (blockers.length === 0) {
      return null;
    }

    return this.buildBlockedDeploymentResult({
      blockingPullRequests: blockers,
      deployEnvironment: "prod",
      gateDecision: evaluateDeploymentGate({
        blockingPullRequests: blockers,
        environment: "prod",
      }),
    });
  }

  async readDeployGateState(runtime) {
    if (!runtime.pool || typeof runtime.pool.query !== "function") {
      const lastProductionDeploymentAt = await runtime.getLastProdDeployAtFn(runtime.pool);
      const blockingPullRequests = await runtime.listBlockingPullRequestsFn(
        runtime.pool,
        lastProductionDeploymentAt,
      );
      return { blockingPullRequests, lastProductionDeploymentAt };
    }
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
      mustTestBlockingPullRequests: readMustTestBlockingPullRequests(plannedPullRequests),
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

  async readGateDecision({ blockingPullRequests, deployEnvironment, runtime }) {
    const [channelTopic, explicitGateState, activeDeployment] = await Promise.all([
      typeof runtime.resolveCurrentChannelTopicFn === "function"
        ? runtime.resolveCurrentChannelTopicFn(runtime)
        : null,
      runtime.enableGateControl
        ? runtime.getDeploymentGateStateFn(runtime.pool, deployEnvironment)
        : null,
      runtime.enableGateControl
        ? runtime.getActiveDeploymentRunFn(runtime.pool, deployEnvironment)
        : null,
    ]);
    return evaluateDeploymentGate({
      activeDeployment,
      blockingPullRequests,
      environment: deployEnvironment,
      explicitGateState,
      topicAvailability: readDeployAvailabilityFromTopic(channelTopic, deployEnvironment),
    });
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

  async buildPlannedPullRequestSummary({
    runtime,
    plannedPullRequests,
    slackUsernameByGithubUsername,
  }) {
    return buildDeploymentPullRequestSummary({
      runtime,
      heading: "PRs to deploy:",
      pullRequestCount: plannedPullRequests.length,
      pullRequests: plannedPullRequests,
      detailsUnavailableText: "PR(s) planned for deployment (details unavailable).",
      slackUsernameByGithubUsername,
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
    deploymentRunId,
    externalDeploymentId,
    deployProvider,
    shouldNotifyDeploymentCompletion,
    deployConfigOverrides,
    productionDeploymentFinalization,
    presentation,
  }) {
    return {
      deploymentRunId,
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
    deploymentRunId,
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
      deploymentRunId,
      deployProvider,
      deploymentCutoffAt: productionDeploymentPlan.deploymentCutoffAt,
      plannedPullRequests: productionDeploymentPlan.plannedPullRequests,
    };
  }
}

function buildBlockedDeploymentPresentation(blockingPullRequests, gateDecision) {
  const blockers = Array.isArray(blockingPullRequests) ? blockingPullRequests : [];
  const environmentLabel = formatEnvironmentLabel(gateDecision?.environment);
  const hasMustTestBlockers = gateDecision.reasons.some(
    (reason) => reason.code === "untested_pull_requests",
  );

  return {
    tone: "danger",
    title: gateDecision.reasons.some((reason) => reason.code === "channel_topic_blocked")
      ? `${environmentLabel} deployment unavailable`
      : `${environmentLabel} deployment blocked`,
    summary: gateDecision.reasons.map((reason) =>
      reason.code === "untested_pull_requests"
        ? `${blockers.length} PR(s) explicitly require testing before production deployment.`
        : reason.message,
    ).join(" "),
    facts: [
      {
        label: "Environment",
        value: environmentLabel,
      },
      {
        label: "Blocking PRs",
        value: String(blockers.length),
      },
    ],
    sections: blockers.length > 0 ? [
      {
        title: hasMustTestBlockers ? "Must test" : "Needs testing",
        items: blockers.map((pullRequest) => ({
          title: [
            `${String(pullRequest?.repo || "").trim()}#${pullRequest?.pr_number}`,
            String(pullRequest?.title || "").trim(),
          ].filter(Boolean).join(" — "),
          url: pullRequest?.url || "",
          description: `Status: ${String(pullRequest?.status || "untested").toLowerCase()}`,
        })),
      },
    ] : [],
    context: hasMustTestBlockers
      ? "Mark these PRs tested, or clear their must-test requirement, then retry."
      : "Resolve the listed gate reasons, then refresh status.",
    actions: [
      { id: "refresh_status", label: "Refresh status", command: "status" },
      { id: "view_history", label: "View history", command: `history ${gateDecision.environment}` },
    ],
  };
}

function buildDeploymentStartedPresentation({
  deployEnvironment,
  deployProvider,
  deploymentId,
  deploymentTriggeredBy,
  missingDeploymentIdText,
  plannedPullRequests,
  slackUsernameByGithubUsername,
  shouldNotifyDeploymentCompletion,
}) {
  const environmentLabel = formatEnvironmentLabel(deployEnvironment);
  const pullRequests = Array.isArray(plannedPullRequests) ? plannedPullRequests : [];
  const sections = [];

  if (deployEnvironment === "prod") {
    sections.push({
      layout: "rows",
      title: "Changes included",
      text: pullRequests.length === 0 ? "No tested PRs are queued for this deployment." : "",
      items: pullRequests.map((pullRequest) => ({
        icon: "🔀",
        title: String(pullRequest?.title || "").trim()
          || `${pullRequest?.repo}#${pullRequest?.pr_number}`,
        url: pullRequest?.url || "",
        description: `by ${formatDeployedPullRequestAuthor({
          pullRequest,
          slackUsernameByGithubUsername:
            slackUsernameByGithubUsername instanceof Map
              ? slackUsernameByGithubUsername
              : new Map(),
        })} · ${pullRequest?.repo}#${pullRequest?.pr_number}`,
        status: pullRequest?.tested ? "Tested" : "Included",
        statusTone: pullRequest?.tested ? "success" : "info",
      })),
    });
  }

  return {
    tone: "info",
    title: `${environmentLabel} deployment started`,
    status: {
      detail: `${formatProviderLabel(deployProvider)}  •  ${String(deploymentId || "ID pending")}`,
      label: "In progress",
      tone: "info",
    },
    summary: missingDeploymentIdText || "",
    facts: [
      {
        label: "Triggered by",
        tone: "info",
        value: deploymentTriggeredBy,
      },
      {
        label: "Changes",
        tone: "info",
        value: deployEnvironment === "prod" ? String(pullRequests.length) : "Staging build",
      },
    ],
    sections,
    context: missingDeploymentIdText
      ? "Code Conductor will not update deployment state automatically."
      : shouldNotifyDeploymentCompletion
        ? "Code Conductor will post again when the provider reports completion."
        : "The deployment was handed off to the configured provider.",
  };
}

function buildDeploymentConfirmationPresentation({
  confirmation,
  deployEnvironment,
  plannedPullRequests,
}) {
  const environmentLabel = formatEnvironmentLabel(deployEnvironment);
  const pullRequests = Array.isArray(plannedPullRequests) ? plannedPullRequests : [];
  return {
    tone: "warning",
    title: `Confirm ${environmentLabel.toLowerCase()} deployment`,
    summary: `Review this deployment, then confirm within 10 minutes. Only the requesting user can confirm it.`,
    facts: [
      { label: "Environment", value: environmentLabel },
      { label: "PRs planned", value: String(pullRequests.length) },
    ],
    sections: pullRequests.length > 0
      ? [{
          title: "Planned changes",
          items: pullRequests.map((pullRequest) => ({
            title: `${pullRequest.repo}#${pullRequest.pr_number} — ${pullRequest.title || "(untitled)"}`,
            url: pullRequest.url || "",
          })),
        }]
      : [],
    actions: [{
      id: `confirm_${deployEnvironment}`,
      label: `Confirm ${environmentLabel.toLowerCase()} deploy`,
      command: `deploy ${deployEnvironment} confirm ${confirmation.token}`,
      style: "danger",
      confirm: `Trigger the ${environmentLabel.toLowerCase()} deployment now?`,
    }],
    context: `Confirmation expires at ${confirmation.expires_at || "approximately 10 minutes from now"}.`,
  };
}

function buildDeploymentNotConfiguredPresentation(deployEnvironment) {
  const environmentLabel = formatEnvironmentLabel(deployEnvironment);
  return {
    tone: "warning",
    title: `${environmentLabel} deployment is not configured`,
    summary: deployEnvironment === "prod"
      ? "The deploy gate is clear, but Code Conductor cannot start production."
      : "Code Conductor cannot start a staging deployment.",
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
  slackUsernameByGithubUsername,
}) {
  const normalizedDeployedPullRequests = normalizeDeployedPullRequests(pullRequests);
  if (normalizedDeployedPullRequests.length === 0) {
    const parsedPullRequestCount = Number(pullRequestCount);
    if (Number.isFinite(parsedPullRequestCount) && parsedPullRequestCount > 0) {
      return `${heading}\n• ${parsedPullRequestCount} ${detailsUnavailableText}`;
    }
    return `${heading}\n• none.`;
  }

  const resolvedSlackUsernameByGithubUsername =
    slackUsernameByGithubUsername instanceof Map
      ? slackUsernameByGithubUsername
      : await resolveSlackUsernameMappingsForPullRequests({
          runtime,
          pullRequests: normalizedDeployedPullRequests,
        });

  return [
    heading,
    ...normalizedDeployedPullRequests.map((pullRequest) =>
      formatDeployedPullRequestLine({
        pullRequest,
        slackUsernameByGithubUsername: resolvedSlackUsernameByGithubUsername,
      }),
    ),
  ].join("\n");
}

async function resolveSlackUsernameMappingsForPullRequests({ runtime, pullRequests }) {
  const githubUsernames = [...new Set(
    normalizeDeployedPullRequests(pullRequests)
      .map((pullRequest) => normalizeGithubUsername(pullRequest.author_login))
      .filter(Boolean),
  )];
  return resolveSlackUsernameByGithubUsername({
    runtime,
    githubUsernames,
  });
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

module.exports = {
  DeployCommand,
  buildDeploymentPullRequestSummary,
};
