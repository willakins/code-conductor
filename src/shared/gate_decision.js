function evaluateDeploymentGate({
  activeDeployment = null,
  blockingPullRequests = [],
  environment = "prod",
  explicitGateState = null,
  topicAvailability = "unknown",
} = {}) {
  const normalizedEnvironment = environment === "staging" ? "staging" : "prod";
  const blockers = normalizedEnvironment === "prod" && Array.isArray(blockingPullRequests)
    ? blockingPullRequests
    : [];
  const reasons = [];
  const explicitStatus = normalizeExplicitStatus(explicitGateState?.status);
  const effectiveAvailability = explicitStatus || normalizeTopicAvailability(topicAvailability);

  if (effectiveAvailability === "closed") {
    reasons.push({
      code: explicitStatus ? "manual_gate_closed" : "channel_topic_blocked",
      message: explicitStatus
        ? explicitGateState.reason || "The deployment gate was closed manually."
        : "The channel topic marks this environment red.",
    });
  }
  if (blockers.length > 0) {
    reasons.push({
      code: "untested_pull_requests",
      message: `${blockers.length} untested pull request(s) block production.`,
    });
  }
  if (activeDeployment) {
    reasons.push({
      code: "deployment_in_progress",
      message: `Deployment run #${activeDeployment.id} is already active.`,
    });
  }

  return {
    allowed: reasons.length === 0,
    activeDeployment,
    blockingPullRequests: blockers,
    environment: normalizedEnvironment,
    gateSource: explicitStatus ? "explicit" : "channel_topic",
    gateStatus: effectiveAvailability,
    reasons,
  };
}

function normalizeExplicitStatus(value) {
  const normalizedValue = String(value || "").toLowerCase();
  if (normalizedValue === "open" || normalizedValue === "closed") {
    return normalizedValue;
  }
  return null;
}

function normalizeTopicAvailability(value) {
  if (value === "blocked") {
    return "closed";
  }
  if (value === "allowed") {
    return "open";
  }
  return "unknown";
}

function readMustTestBlockingPullRequests(pullRequests) {
  return (Array.isArray(pullRequests) ? pullRequests : []).filter((pullRequest) => {
    const status = String(pullRequest?.status || "").trim().toLowerCase();
    return pullRequest?.force_deploy_blocked === true
      && status !== "tested"
      && status !== "deployed";
  });
}

module.exports = {
  evaluateDeploymentGate,
  readMustTestBlockingPullRequests,
};
