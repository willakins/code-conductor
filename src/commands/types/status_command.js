const { BaseCalypsoCommand } = require("./base_command");
const { formatTimestampByTimeFormat } = require("../../util/format");
const {
  readDeployAvailabilityFromTopic,
} = require("../../shared/deploy_availability");
const { evaluateDeploymentGate } = require("../../shared/gate_decision");

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
    const blockingPullRequests = await runtime.listBlockingPullRequestsFn(
      runtime.pool,
      lastProductionDeploymentAt,
    );
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
    });

    return this.buildExecutionResult(responseText, {
      presentation: buildStatusPresentation({
        lastDeployAt: lastProductionDeploymentAt,
        blockers: blockingPullRequests,
        gateDecision,
        timeFormat,
        timeZone,
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

function buildStatusResponseText({ blockerResponseText, gateDecision }) {
  const nonPrReasons = gateDecision.reasons.filter(
    (reason) => reason.code !== "untested_pull_requests",
  );
  if (nonPrReasons.length === 0) {
    return blockerResponseText;
  }

  const pullRequestGateText = String(blockerResponseText || "")
    .replace(/^No blockers/, "No untested PR blockers");
  const reasonLead = nonPrReasons.some((reason) => reason.code === "channel_topic_blocked")
    ? "Production deployment is blocked by the channel topic."
    : `Production deployment is blocked: ${nonPrReasons.map((reason) => reason.message).join(" ")}`;
  return [
    reasonLead,
    pullRequestGateText,
  ].filter(Boolean).join("\n");
}

function buildStatusPresentation({
  lastDeployAt,
  blockers,
  gateDecision,
  timeFormat,
  timeZone,
}) {
  const blockingPullRequests = Array.isArray(blockers) ? blockers : [];
  const hasPullRequestBlockers = blockingPullRequests.length > 0;
  const isTopicBlocked = gateDecision.reasons.some((reason) => reason.code === "channel_topic_blocked");
  const isManualGateBlocked = gateDecision.reasons.some((reason) => reason.code === "manual_gate_closed");
  const isDeploymentActive = gateDecision.reasons.some((reason) => reason.code === "deployment_in_progress");
  const isProductionBlocked = !gateDecision.allowed;

  return {
    tone: isProductionBlocked ? "danger" : "success",
    title: isProductionBlocked ? "Production deploy is blocked" : "Production deploy is clear",
    summary: buildStatusSummary({
      blockingPullRequestCount: blockingPullRequests.length,
      gateBlockDescription: isManualGateBlocked
        ? "The explicit gate blocks production."
        : isTopicBlocked
          ? "The channel topic blocks production."
          : "",
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
        label: "Blocking PRs",
        value: String(blockingPullRequests.length),
      },
    ],
    sections: hasPullRequestBlockers
      ? [
          {
            title: "Needs testing",
            items: blockingPullRequests.map(formatPullRequestPresentationItem),
          },
        ]
      : [],
    context: buildStatusContext({
      hasPullRequestBlockers,
      isTopicBlocked: isTopicBlocked || isManualGateBlocked,
      isDeploymentActive,
    }),
    actions: [
      { id: "refresh_status", label: "Refresh", command: "status" },
      ...(gateDecision.allowed
        ? [{ id: "deploy_prod", label: "Review deployment", command: "deploy prod", style: "primary" }]
        : []),
      { id: "view_history", label: "View history", command: "history prod" },
      ...blockingPullRequests.slice(0, 2).map((pullRequest) => ({
        id: `tested_${pullRequest.pr_number}`,
        label: `Mark #${pullRequest.pr_number} tested`,
        command: `tested ${pullRequest.pr_number}`,
        confirm: `Mark PR #${pullRequest.pr_number} as tested?`,
      })),
    ],
  };
}

function buildStatusSummary({ blockingPullRequestCount, gateBlockDescription }) {
  const hasPullRequestBlockers = blockingPullRequestCount > 0;
  if (gateBlockDescription && hasPullRequestBlockers) {
    const blockerLabel = blockingPullRequestCount === 1 ? "PR needs" : "PRs need";
    return `${gateBlockDescription} ${blockingPullRequestCount} ${blockerLabel} testing.`;
  }
  if (gateBlockDescription) {
    return `${gateBlockDescription} No untested PRs are waiting.`;
  }
  if (hasPullRequestBlockers) {
    const blockerLabel = blockingPullRequestCount === 1 ? "PR needs" : "PRs need";
    return `${blockingPullRequestCount} ${blockerLabel} testing before the next production deploy.`;
  }
  return "No untested pull requests are blocking production.";
}

function buildStatusContext({ hasPullRequestBlockers, isTopicBlocked, isDeploymentActive }) {
  if (isDeploymentActive) {
    return "A deployment is already in progress. Use `/calypso history prod` for details.";
  }
  if (isTopicBlocked) {
    return "Change the channel's Production topic marker from red before deploying. You can also set an explicit gate with `/calypso gate open prod`.";
  }
  if (hasPullRequestBlockers) {
    return "When verified, mark a PR with `/calypso tested <PR_NUMBER>`.";
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
    description: `Status: ${String(pullRequest?.status || "untested").toLowerCase()}`,
  };
}

module.exports = {
  StatusCommand,
};
