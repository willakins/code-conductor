const { BaseCalypsoCommand } = require("./base_command");
const { formatTimestampByTimeFormat } = require("../../util/format");
const {
  readDeployAvailabilityFromTopic,
} = require("../../shared/deploy_availability");

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
    const productionTopicAvailability = await resolveProductionTopicAvailability(runtime);

    const blockerResponseText = runtime.formatStatusResponseFn({
      lastDeployAt: lastProductionDeploymentAt,
      blockers: blockingPullRequests,
      timeFormat,
      timeZone,
    });
    const responseText = buildStatusResponseText({
      blockerResponseText,
      productionTopicAvailability,
    });

    return this.buildExecutionResult(responseText, {
      presentation: buildStatusPresentation({
        lastDeployAt: lastProductionDeploymentAt,
        blockers: blockingPullRequests,
        productionTopicAvailability,
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

function buildStatusResponseText({ blockerResponseText, productionTopicAvailability }) {
  if (productionTopicAvailability !== "blocked") {
    return blockerResponseText;
  }

  const pullRequestGateText = String(blockerResponseText || "")
    .replace(/^No blockers/, "No untested PR blockers");
  return [
    "Production deployment is blocked by the channel topic.",
    pullRequestGateText,
  ].filter(Boolean).join("\n");
}

function buildStatusPresentation({
  lastDeployAt,
  blockers,
  productionTopicAvailability,
  timeFormat,
  timeZone,
}) {
  const blockingPullRequests = Array.isArray(blockers) ? blockers : [];
  const hasPullRequestBlockers = blockingPullRequests.length > 0;
  const isTopicBlocked = productionTopicAvailability === "blocked";
  const isProductionBlocked = hasPullRequestBlockers || isTopicBlocked;

  return {
    tone: isProductionBlocked ? "danger" : "success",
    title: isProductionBlocked ? "Production deploy is blocked" : "Production deploy is clear",
    summary: buildStatusSummary({
      blockingPullRequestCount: blockingPullRequests.length,
      isTopicBlocked,
    }),
    facts: [
      {
        label: "Last production deploy",
        value: formatTimestampByTimeFormat(lastDeployAt, { timeFormat, timeZone }),
      },
      ...buildTopicAvailabilityFacts(productionTopicAvailability),
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
      isTopicBlocked,
    }),
  };
}

function buildStatusSummary({ blockingPullRequestCount, isTopicBlocked }) {
  const hasPullRequestBlockers = blockingPullRequestCount > 0;
  if (isTopicBlocked && hasPullRequestBlockers) {
    const blockerLabel = blockingPullRequestCount === 1 ? "PR needs" : "PRs need";
    return `The channel topic blocks production, and ${blockingPullRequestCount} ${blockerLabel} testing.`;
  }
  if (isTopicBlocked) {
    return "The channel topic blocks production. No untested PRs are waiting.";
  }
  if (hasPullRequestBlockers) {
    const blockerLabel = blockingPullRequestCount === 1 ? "PR needs" : "PRs need";
    return `${blockingPullRequestCount} ${blockerLabel} testing before the next production deploy.`;
  }
  return "No untested pull requests are blocking production.";
}

function buildTopicAvailabilityFacts(productionTopicAvailability) {
  if (productionTopicAvailability === "unknown") {
    return [];
  }

  return [
    {
      label: "Channel topic",
      value: productionTopicAvailability === "blocked" ? "Blocked" : "Available",
    },
  ];
}

function buildStatusContext({ hasPullRequestBlockers, isTopicBlocked }) {
  if (isTopicBlocked) {
    return "Change the channel's Production topic marker from red before deploying.";
  }
  if (hasPullRequestBlockers) {
    return "When verified, mark a PR with `/calypso tested <PR_NUMBER>`.";
  }
  return "The production deploy gate is ready.";
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
