const { BaseCalypsoCommand } = require("./base_command");
const { TIMEFRAME_DEFINITIONS, isValidTimeframe, timeframeSince } = require("../../shared/timeframes");
const {
  formatPullRequestReference,
  formatReviewListHeader,
  formatReviewListItem,
  formatTimestampByTimeFormat,
} = require("../../util/format");
const { readDeployAvailabilityFromTopic } = require("../../shared/deploy_availability");
const { evaluateDeploymentGate } = require("../../shared/gate_decision");

class TestedCommand extends BaseCalypsoCommand {
  constructor() {
    super("tested");
  }

  parse({ commandWords }) {
    const firstArgument = (commandWords[1] || "").toLowerCase();
    const secondArgument = (commandWords[2] || "").toLowerCase();

    if (commandWords.length === 2 && firstArgument === "all") {
      return this.buildParsedCommand({
        action: "tested_all",
      });
    }

    if (commandWords.length === 3 && firstArgument === "recent") {
      if (!isValidTimeframe(secondArgument)) {
        return this.buildRespondParsedCommand(
          "Usage: `/calypso tested recent <day|week|month>`",
        );
      }

      return this.buildParsedCommand({
        action: "tested_recent",
        timeframe: secondArgument,
      });
    }

    const prNumber = Number(commandWords[1]);
    const hasExactlyOneArgument = commandWords.length === 2;
    const hasValidPrNumber = Number.isInteger(prNumber) && prNumber > 0;
    if (!hasExactlyOneArgument || !hasValidPrNumber) {
      return this.buildRespondParsedCommand(
        [
          "Usage:",
          "`/calypso tested <PR_NUMBER>`",
          "`/calypso tested all`",
          "`/calypso tested recent <day|week|month>`",
        ].join("\n"),
      );
    }

    return this.buildParsedCommand({
      action: "tested_single",
      prNumber,
    });
  }

  async checkCallerAccess({ parsedCommand, runtime }) {
    const requiresElevatedAccess =
      parsedCommand.action === "tested_single" || parsedCommand.action === "tested_all";
    if (!requiresElevatedAccess) {
      return this.allowAccess();
    }

    const deployAccess = await runtime.resolveDeployAccessFn(runtime);
    if (!deployAccess.canDeploy) {
      return this.denyAccess(
        [
          "Tested update denied.",
          "Only workspace admins or whitelisted users can mark PRs as tested.",
          "Ask a workspace admin to run `/calypso whitelist <@USER>`.",
        ].join("\n"),
      );
    }

    return this.allowAccess();
  }

  async execute({ parsedCommand, runtime }) {
    if (!runtime.pool) {
      return this.buildExecutionResult("Tested command unavailable: database pool is not configured.");
    }

    if (parsedCommand.action === "tested_all") {
      const clearedKnownBlocker = runtime.enableGateControl
        ? await hasProductionPullRequestBlockers(runtime)
        : false;
      const markedCount = await runtime.markAllUntestedPullRequestsTestedFn(
        runtime.pool,
        runtime.userId,
      );

      if (markedCount === 0) {
        return this.buildExecutionResult("No untested PRs found.");
      }

      return this.buildTestedMutationResult(
        `Marked ${markedCount} untested PR(s) as tested.`,
        runtime,
        { clearedKnownBlocker, markedCount },
      );
    }

    if (parsedCommand.action === "tested_recent") {
      const timeframeDefinition = TIMEFRAME_DEFINITIONS[parsedCommand.timeframe];
      const sinceTimestamp = timeframeSince(parsedCommand.timeframe, Date.now());
      const recentlyTestedPullRequests = await runtime.listRecentlyTestedPullRequestsFn(
        runtime.pool,
        sinceTimestamp,
      );
      const timeFormat = await runtime.readTimeFormatPreferenceFn(runtime);
      const timeZone = await runtime.readTimeZonePreferenceFn(runtime);
      const testedByNameById = await resolveTestedByNames(recentlyTestedPullRequests, runtime);

      if (recentlyTestedPullRequests.length === 0) {
        return this.buildExecutionResult(
          `No PRs tested in the last ${timeframeDefinition.displayName}.`,
        );
      }

      return this.buildExecutionResult(
        [
          formatReviewListHeader(`PRs tested in the last ${timeframeDefinition.displayName}`),
          ...recentlyTestedPullRequests.map((pullRequest) =>
            formatRecentlyTestedPullRequestLine(pullRequest, testedByNameById, timeFormat, timeZone),
          ),
        ].join("\n"),
      );
    }

    const clearedKnownBlocker = runtime.enableGateControl
      ? await isProductionPullRequestBlocker(runtime, parsedCommand.prNumber)
      : false;
    const testedResult = await runtime.markPullRequestTestedFn(
      runtime.pool,
      parsedCommand.prNumber,
      runtime.userId,
    );

    if (!testedResult.found) {
      return this.buildExecutionResult(`PR #${parsedCommand.prNumber} not found.`);
    }

    if (testedResult.alreadyTested) {
      return this.buildExecutionResult(`PR #${parsedCommand.prNumber} is already marked tested.`);
    }

    return this.buildTestedMutationResult(
      `Marked PR #${parsedCommand.prNumber} as tested.`,
      runtime,
      { clearedKnownBlocker, prNumber: parsedCommand.prNumber },
    );
  }

  async buildTestedMutationResult(responseText, runtime, metadata) {
    if (!runtime.enableGateControl) {
      return this.buildExecutionResult(responseText);
    }
    await runtime.insertAuditEventFn(runtime.pool, {
      actorUserId: runtime.userId,
      environment: "prod",
      eventType: "pull_request_tested",
      metadata,
      summary: responseText,
    });
    const lastDeployAt = await runtime.getLastProdDeployAtFn(runtime.pool);
    const [blockingPullRequests, explicitGateState, activeDeployment, channelTopic] =
      await Promise.all([
        runtime.listBlockingPullRequestsFn(runtime.pool, lastDeployAt),
        runtime.getDeploymentGateStateFn(runtime.pool, "prod"),
        runtime.getActiveDeploymentRunFn(runtime.pool, "prod"),
        runtime.resolveCurrentChannelTopicFn(runtime),
      ]);
    const decision = evaluateDeploymentGate({
      activeDeployment,
      blockingPullRequests,
      environment: "prod",
      explicitGateState,
      topicAvailability: readDeployAvailabilityFromTopic(channelTopic, "prod"),
    });
    const gateBecameReady = metadata.clearedKnownBlocker && decision.allowed;
    return this.buildExecutionResult(
      gateBecameReady ? `${responseText} Production is now ready to deploy.` : responseText,
      {
        gateBecameReady,
        presentation: {
          tone: gateBecameReady ? "success" : "neutral",
          title: gateBecameReady ? "Production is ready" : "Testing confirmation",
          summary: responseText,
          context: gateBecameReady
            ? "The final blocker cleared. Production can now be deployed."
            : decision.allowed
              ? "Production was already ready; no new ready notification was posted."
              : "Other gate conditions still block production.",
          actions: gateBecameReady
            ? [{ id: "deploy_prod", label: "Review deployment", command: "deploy prod", style: "primary" }]
            : [{ id: "refresh_status", label: "View status", command: "status" }],
        },
      },
    );
  }

  resolveResponseType({ executionResult }) {
    return executionResult.gateBecameReady ? "in_channel" : "ephemeral";
  }
}

async function hasProductionPullRequestBlockers(runtime) {
  const lastDeployAt = await runtime.getLastProdDeployAtFn(runtime.pool);
  const blockers = await runtime.listBlockingPullRequestsFn(runtime.pool, lastDeployAt);
  return blockers.length > 0;
}

async function isProductionPullRequestBlocker(runtime, prNumber) {
  const lastDeployAt = await runtime.getLastProdDeployAtFn(runtime.pool);
  const blockers = await runtime.listBlockingPullRequestsFn(runtime.pool, lastDeployAt);
  return blockers.some((pullRequest) => Number(pullRequest.pr_number) === Number(prNumber));
}

async function resolveTestedByNames(recentlyTestedPullRequests, runtime) {
  const testedByUserIds = [...new Set(
    recentlyTestedPullRequests
      .map((pullRequest) => pullRequest.tested_by)
      .filter(Boolean),
  )];
  const testedByNameById = new Map();
  const resolveUserDisplayNameFn = runtime.resolveUserDisplayNameFn;

  for (const userId of testedByUserIds) {
    const testedByName =
      typeof resolveUserDisplayNameFn === "function"
        ? await resolveUserDisplayNameFn(runtime.communicationClient, userId)
        : null;
    if (testedByName) {
      testedByNameById.set(userId, testedByName);
    }
  }

  return testedByNameById;
}

function formatRecentlyTestedPullRequestLine(
  pullRequest,
  testedByNameById,
  timeFormat,
  timeZone,
) {
  const pullRequestReference = formatPullRequestReference({
    repo: pullRequest.repo,
    prNumber: pullRequest.pr_number,
    url: pullRequest.url,
  });
  const testedByUserId = pullRequest.tested_by || null;
  const testedBy =
    (testedByUserId && testedByNameById.get(testedByUserId)) || testedByUserId || "unknown user";
  const testedAt = pullRequest.tested_at
    ? formatTimestampByTimeFormat(pullRequest.tested_at, { timeFormat, timeZone })
    : "at an unknown time";
  const titleSuffix = pullRequest.title ? ` - ${pullRequest.title}` : "";
  return formatReviewListItem(
    `${pullRequestReference}${titleSuffix} (${pullRequest.status}) tested by ${testedBy} ${testedAt}`,
  );
}

module.exports = {
  TestedCommand,
};
