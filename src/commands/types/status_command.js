const { BaseCalypsoCommand } = require("./base_command");
const { formatTimestampByTimeFormat } = require("../../util/format");

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

    const responseText = runtime.formatStatusResponseFn({
      lastDeployAt: lastProductionDeploymentAt,
      blockers: blockingPullRequests,
      timeFormat,
      timeZone,
    });

    return this.buildExecutionResult(responseText, {
      presentation: buildStatusPresentation({
        lastDeployAt: lastProductionDeploymentAt,
        blockers: blockingPullRequests,
        timeFormat,
        timeZone,
      }),
    });
  }
}

function buildStatusPresentation({ lastDeployAt, blockers, timeFormat, timeZone }) {
  const blockingPullRequests = Array.isArray(blockers) ? blockers : [];
  const hasBlockers = blockingPullRequests.length > 0;
  const blockerLabel = blockingPullRequests.length === 1 ? "PR needs" : "PRs need";

  return {
    tone: hasBlockers ? "danger" : "success",
    title: hasBlockers ? "Production deploy is blocked" : "Production deploy is clear",
    summary: hasBlockers
      ? `${blockingPullRequests.length} ${blockerLabel} testing before the next production deploy.`
      : "No untested pull requests are blocking production.",
    facts: [
      {
        label: "Last production deploy",
        value: formatTimestampByTimeFormat(lastDeployAt, { timeFormat, timeZone }),
      },
      {
        label: "Blocking PRs",
        value: String(blockingPullRequests.length),
      },
    ],
    sections: hasBlockers
      ? [
          {
            title: "Needs testing",
            items: blockingPullRequests.map(formatPullRequestPresentationItem),
          },
        ]
      : [],
    context: hasBlockers
      ? "When verified, mark a PR with `/calypso tested <PR_NUMBER>`."
      : "The production deploy gate is ready.",
  };
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
