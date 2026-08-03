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
    const [
      productionTopicAvailability,
      explicitGateState,
      activeDeployment,
      environmentStatus,
      pendingPullRequests,
    ] = await Promise.all([
      resolveProductionTopicAvailability(runtime),
      runtime.enableGateControl
        ? runtime.getDeploymentGateStateFn(runtime.pool, "prod")
        : null,
      runtime.enableGateControl
        ? runtime.getActiveDeploymentRunFn(runtime.pool, "prod")
        : null,
      runtime.getEnvironmentStatusConfigFn(runtime.pool),
      runtime.listDeployablePullRequestsForDeploymentFn(
        runtime.pool,
        lastProductionDeploymentAt,
        new Date(),
        { includeUntested: true },
      ),
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
        environmentStatus,
        gateDecision,
        timeFormat,
        timeZone,
        untestedPullRequests,
        pendingPullRequests,
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
  environmentStatus,
  lastDeployAt,
  gateDecision,
  pendingPullRequests,
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
  const normalizedPendingPullRequests = Array.isArray(pendingPullRequests)
    ? pendingPullRequests
    : [];
  const queuedPullRequests = normalizedPendingPullRequests.length > 0
    ? normalizedPendingPullRequests
    : waitingPullRequests;
  const hasMustTestBlockers = mustTestPullRequests.length > 0;
  const hasUntestedPullRequests = waitingPullRequests.length > 0;
  const isTopicBlocked = gateDecision.reasons.some((reason) => reason.code === "channel_topic_blocked");
  const isManualGateBlocked = gateDecision.reasons.some((reason) => reason.code === "manual_gate_closed");
  const isDeploymentActive = gateDecision.reasons.some((reason) => reason.code === "deployment_in_progress");
  const isProductionBlocked = !gateDecision.allowed;
  const firstMustTestPullRequest = mustTestPullRequests[0];
  const hasViewableMustTestBlocker = isProductionBlocked
    && Boolean(firstMustTestPullRequest?.url);

  return {
    tone: isProductionBlocked ? "danger" : "success",
    title: "Production readiness",
    showHeaderIcon: true,
    status: {
      ...buildReadinessStatus({
        isDeploymentActive,
        isManualGateBlocked,
        isProductionBlocked,
        isTopicBlocked,
        mustTestPullRequestCount: mustTestPullRequests.length,
        queuedPullRequestCount: queuedPullRequests.length,
      }),
      showIcon: false,
    },
    facts: [
      buildEnvironmentHealthFact(environmentStatus),
      {
        label: "Last deployment",
        value: `🕒 ${formatTimestampByTimeFormat(lastDeployAt, { timeFormat, timeZone })}`,
      },
    ],
    factsSeparator: true,
    factsPosition: "after_sections",
    sections: queuedPullRequests.length > 0
      ? [
          {
            layout: "rows",
            title: "Changes since last deploy",
            items: queuedPullRequests.map(formatPullRequestPresentationItem),
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
      ...(gateDecision.allowed
        ? [{ id: "deploy_prod", label: "Review deployment", command: "deploy prod", style: "primary" }]
        : []),
      ...(hasViewableMustTestBlocker
        ? [{
            id: `view_pr_${firstMustTestPullRequest.pr_number}`,
            label: `View PR #${firstMustTestPullRequest.pr_number}`,
            url: firstMustTestPullRequest.url,
          }]
        : []),
      { id: "view_history", label: "Deployment history", command: "history prod" },
      ...waitingPullRequests.slice(0, 2).map((pullRequest) => ({
        id: `tested_${pullRequest.pr_number}`,
        label: `Mark #${pullRequest.pr_number} tested`,
        command: `tested ${pullRequest.pr_number}`,
        confirm: `Mark PR #${pullRequest.pr_number} as tested?`,
      })),
      { id: "refresh_status", label: "Refresh", command: "status" },
    ],
  };
}

function buildReadinessStatus({
  isDeploymentActive,
  isManualGateBlocked,
  isProductionBlocked,
  isTopicBlocked,
  mustTestPullRequestCount,
  queuedPullRequestCount,
}) {
  if (!isProductionBlocked) {
    return {
      detail: formatCount(queuedPullRequestCount, "change", "changes", "queued"),
      label: "Ready to deploy",
      tone: "success",
    };
  }

  if (mustTestPullRequestCount > 0) {
    return {
      detail: formatCount(mustTestPullRequestCount, "required test", "required tests"),
      label: "Blocked",
      tone: "danger",
    };
  }

  if (isDeploymentActive) {
    return { detail: "Deployment in progress", label: "Blocked", tone: "danger" };
  }

  if (isManualGateBlocked || isTopicBlocked) {
    return { detail: "Deployment gate closed", label: "Blocked", tone: "danger" };
  }

  return { detail: "Action required", label: "Blocked", tone: "danger" };
}

function buildEnvironmentHealthFact(environmentStatus) {
  const normalizedState = String(environmentStatus?.lastObservedState || "unknown").toLowerCase();
  const httpStatus = environmentStatus?.lastHttpStatus
    ? ` · HTTP ${environmentStatus.lastHttpStatus}`
    : "";

  if (!environmentStatus) {
    return { label: "Production app", value: "⚠️ Status unavailable" };
  }
  if (!environmentStatus.enabled) {
    return { label: "Production app", value: "🎛️ Monitoring off" };
  }
  if (normalizedState === "healthy") {
    return { label: "Production app", value: `✅ Healthy at last check${httpStatus}` };
  }
  if (normalizedState === "unhealthy") {
    return { label: "Production app", value: `⛔ Unhealthy at last check${httpStatus}` };
  }
  return { label: "Production app", value: "⚠️ Awaiting first check" };
}

function formatCount(count, singular, plural, suffix = "") {
  const normalizedCount = Number(count) || 0;
  const label = normalizedCount === 1 ? singular : plural;
  return [normalizedCount, label, suffix].filter((value) => value !== "").join(" ");
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

function formatPullRequestPresentationItem(pullRequest) {
  const repo = String(pullRequest?.repo || "").trim();
  const prNumber = pullRequest?.pr_number;
  const title = String(pullRequest?.title || "").trim();

  const normalizedStatus = String(pullRequest?.status || "untested").toLowerCase();
  const requiresTesting = pullRequest?.force_deploy_blocked === true;
  const status = normalizedStatus === "tested"
    ? "Tested"
    : requiresTesting
      ? "Must test"
      : "Untested";

  return {
    icon: "🔀",
    title: [`#${prNumber}`, title || `${repo} change`].filter(Boolean).join("  "),
    url: pullRequest?.url || "",
    description: repo,
    status,
    statusTone: normalizedStatus === "tested"
      ? "success"
      : requiresTesting
        ? "warning"
        : "neutral",
  };
}

module.exports = {
  StatusCommand,
};
