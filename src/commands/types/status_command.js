const { BaseCalypsoCommand } = require("./base_command");
const { formatTimestampByTimeFormat } = require("../../util/format");
const {
  readDeployAvailabilityFromTopic,
} = require("../../shared/deploy_availability");
const {
  evaluateDeploymentGate,
  readMustTestBlockingPullRequests,
} = require("../../shared/gate_decision");

class StatusCommand extends BaseCalypsoCommand {
  constructor() {
    super("status");
  }

  parse() {
    return this.buildParsedCommand({
      action: "status",
    });
  }

  async execute({ runtime }) {
    if (!runtime.pool) {
      return this.buildExecutionResult("Status unavailable: database pool is not configured.");
    }

    const timeFormat = await runtime.readTimeFormatPreferenceFn(runtime);
    const timeZone = await runtime.readTimeZonePreferenceFn(runtime);
    const lastProductionDeploymentAt = await runtime.getLastProdDeployAtFn(runtime.pool);
    const untestedPullRequests = await runtime.listBlockingPullRequestsFn(
      runtime.pool,
      lastProductionDeploymentAt,
    );
    const blockingPullRequests = readMustTestBlockingPullRequests(untestedPullRequests);
    const [productionTopicAvailability, explicitGateState, activeDeployment] = await Promise.all([
      resolveProductionTopicAvailability(runtime),
      runtime.enableGateControl
        ? runtime.getDeploymentGateStateFn(runtime.pool, "prod")
        : null,
      runtime.enableGateControl
        ? runtime.getActiveDeploymentRunFn(runtime.pool, "prod")
        : null,
    ]);
    const gateDecision = evaluateDeploymentGate({
      activeDeployment,
      blockingPullRequests,
      environment: "prod",
      explicitGateState,
      topicAvailability: productionTopicAvailability,
    });

    const blockerResponseText = runtime.formatStatusResponseFn({
      lastDeployAt: lastProductionDeploymentAt,
      blockers: blockingPullRequests,
      timeFormat,
      timeZone,
    });
    const responseText = buildStatusResponseText({
      blockerResponseText,
      gateDecision,
      mustTestPullRequestCount: blockingPullRequests.length,
      untestedPullRequestCount: untestedPullRequests.length,
    });

    return this.buildExecutionResult(responseText, {
      presentation: buildStatusPresentation({
        lastDeployAt: lastProductionDeploymentAt,
        blockingPullRequests,
        gateDecision,
        timeFormat,
        timeZone,
        untestedPullRequests,
      }),
    });
  }
}

async function resolveProductionTopicAvailability(runtime) {
  if (typeof runtime.resolveCurrentChannelTopicFn !== "function") {
    return "unknown";
  }

  const channelTopic = await runtime.resolveCurrentChannelTopicFn(runtime);
  return readDeployAvailabilityFromTopic(channelTopic, "prod");
}

function buildStatusResponseText({
  blockerResponseText,
  gateDecision,
  mustTestPullRequestCount = 0,
  untestedPullRequestCount = 0,
}) {
  const nonPrReasons = gateDecision.reasons.filter(
    (reason) => reason.code !== "untested_pull_requests",
  );
  const ordinaryUntestedCount = Math.max(
    0,
    untestedPullRequestCount - mustTestPullRequestCount,
  );
  const ordinaryUntestedText = ordinaryUntestedCount > 0
    ? `${ordinaryUntestedCount} ordinary untested PR(s) will be included by force deploy.`
    : "";
  if (nonPrReasons.length === 0) {
    return [blockerResponseText, ordinaryUntestedText].filter(Boolean).join("\n");
  }

  const pullRequestGateText = String(blockerResponseText || "")
    .replace(/^No blockers/, "No must-test PR blockers");
  const reasonLead = nonPrReasons.some((reason) => reason.code === "channel_topic_blocked")
    ? "Production deployment is blocked by the channel topic."
    : `Production deployment is blocked: ${nonPrReasons.map((reason) => reason.message).join(" ")}`;
  return [
    reasonLead,
    pullRequestGateText,
    ordinaryUntestedText,
  ].filter(Boolean).join("\n");
}

function buildStatusPresentation({
  blockingPullRequests,
  lastDeployAt,
  gateDecision,
  timeFormat,
  timeZone,
  untestedPullRequests,
}) {
  const mustTestPullRequests = Array.isArray(blockingPullRequests)
    ? blockingPullRequests
    : [];
  const waitingPullRequests = Array.isArray(untestedPullRequests)
    ? untestedPullRequests
    : [];
  const hasMustTestBlockers = mustTestPullRequests.length > 0;
  const hasUntestedPullRequests = waitingPullRequests.length > 0;
  const isTopicBlocked = gateDecision.reasons.some((reason) => reason.code === "channel_topic_blocked");
  const isManualGateBlocked = gateDecision.reasons.some((reason) => reason.code === "manual_gate_closed");
  const isDeploymentActive = gateDecision.reasons.some((reason) => reason.code === "deployment_in_progress");
  const isProductionBlocked = !gateDecision.allowed;

  return {
    tone: isProductionBlocked ? "danger" : "success",
    title: isProductionBlocked ? "Production deploy is blocked" : "Production deploy is clear",
    summary: buildStatusSummary({
      gateBlockDescription: isManualGateBlocked
        ? "The explicit gate blocks production."
        : isTopicBlocked
          ? "The channel topic blocks production."
          : "",
      mustTestPullRequestCount: mustTestPullRequests.length,
      untestedPullRequestCount: waitingPullRequests.length,
    }),
    facts: [
      {
        label: "Last production deploy",
        value: formatTimestampByTimeFormat(lastDeployAt, { timeFormat, timeZone }),
      },
      {
        label: gateDecision.gateSource === "channel_topic" ? "Channel topic" : "Gate",
        value: `${formatGateStatus(gateDecision)} (${gateDecision.gateSource.replace("_", " ")})`,
      },
      {
        label: "Must-test PRs",
        value: String(mustTestPullRequests.length),
      },
      {
        label: "Untested PRs",
        value: String(waitingPullRequests.length),
      },
    ],
    sections: hasUntestedPullRequests
      ? [
          {
            title: "Needs testing",
            items: waitingPullRequests.map(formatPullRequestPresentationItem),
          },
        ]
      : [],
    context: buildStatusContext({
      hasMustTestBlockers,
      hasUntestedPullRequests,
      isTopicBlocked: isTopicBlocked || isManualGateBlocked,
      isDeploymentActive,
    }),
    actions: [
      { id: "refresh_status", label: "Refresh", command: "status" },
      ...(gateDecision.allowed
        ? [{ id: "deploy_prod", label: "Review deployment", command: "deploy prod", style: "primary" }]
        : []),
      { id: "view_history", label: "View history", command: "history prod" },
      ...waitingPullRequests.slice(0, 2).map((pullRequest) => ({
        id: `tested_${pullRequest.pr_number}`,
        label: `Mark #${pullRequest.pr_number} tested`,
        command: `tested ${pullRequest.pr_number}`,
        confirm: `Mark PR #${pullRequest.pr_number} as tested?`,
      })),
    ],
  };
}

function buildStatusSummary({
  gateBlockDescription,
  mustTestPullRequestCount,
  untestedPullRequestCount,
}) {
  if (gateBlockDescription && mustTestPullRequestCount > 0) {
    return `${gateBlockDescription} ${mustTestPullRequestCount} PR(s) are explicitly marked must-test.`;
  }
  if (gateBlockDescription) {
    return untestedPullRequestCount > 0
      ? `${gateBlockDescription} ${untestedPullRequestCount} untested PR(s) will be included by force deploy.`
      : `${gateBlockDescription} No untested PRs are waiting.`;
  }
  if (mustTestPullRequestCount > 0) {
    return `${mustTestPullRequestCount} PR(s) are explicitly marked must-test before production deployment.`;
  }
  if (untestedPullRequestCount > 0) {
    return `${untestedPullRequestCount} untested PR(s) will be included by force deploy.`;
  }
  return "No untested PRs are waiting.";
}

function buildStatusContext({
  hasMustTestBlockers,
  hasUntestedPullRequests,
  isTopicBlocked,
  isDeploymentActive,
}) {
  if (isDeploymentActive) {
    return "A deployment is already in progress. Use `/conductor history prod` for details.";
  }
  if (isTopicBlocked) {
    return "Change the channel's Production topic marker from red before deploying. You can also set an explicit gate with `/conductor gate open prod`.";
  }
  if (hasMustTestBlockers) {
    return "Must-test PRs require `/conductor tested <PR_NUMBER>` before production deployment.";
  }
  if (hasUntestedPullRequests) {
    return "Untested PRs do not block production; mark them tested when verification is complete.";
  }
  return "The production deploy gate is ready.";
}

function capitalize(value) {
  const normalized = String(value || "");
  return normalized ? `${normalized[0].toUpperCase()}${normalized.slice(1)}` : normalized;
}

function formatGateStatus(gateDecision) {
  if (gateDecision.gateSource === "channel_topic") {
    if (gateDecision.gateStatus === "closed") {
      return "Blocked";
    }
    if (gateDecision.gateStatus === "open") {
      return "Available";
    }
  }
  return capitalize(gateDecision.gateStatus);
}

function formatPullRequestPresentationItem(pullRequest) {
  const repo = String(pullRequest?.repo || "").trim();
  const prNumber = pullRequest?.pr_number;
  const title = String(pullRequest?.title || "").trim();

  return {
    title: [`${repo}#${prNumber}`, title].filter(Boolean).join(" — "),
    url: pullRequest?.url || "",
    description: [
      `Status: ${String(pullRequest?.status || "untested").toLowerCase()}`,
      pullRequest?.force_deploy_blocked === true ? "Must test" : "",
    ].filter(Boolean).join(" · "),
  };
}

module.exports = {
  StatusCommand,
};
