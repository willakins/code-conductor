const { BaseCalypsoCommand } = require("./base_command");
const { isValidTimeframe, timeframeSince } = require("../../shared/timeframes");
const {
  buildReviewRecapPresentation,
  formatReviewListHeader,
  formatReviewPullRequestLine,
  formatReviewRecapResponse,
  sortPullRequestsByMostRecent,
} = require("../../util/format");
const {
  REVIEW_RECAP_BACKBURNER_AGE_MS,
  REVIEW_RECAP_CATEGORY_KEYS,
  computeReviewRecapSinceTimestamp,
  readReviewPullRequestLastModifiedTimestamp,
} = require("../../shared/review_recap");

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;
const LAST_MONTH_WINDOW_MILLISECONDS = 30 * DAY_IN_MILLISECONDS;
const LAST_THREE_MONTHS_WINDOW_MILLISECONDS = 90 * DAY_IN_MILLISECONDS;
const REVIEW_RECAP_TAB_KEYS = new Set([
  "summary",
  ...Object.values(REVIEW_RECAP_CATEGORY_KEYS),
]);
const LAST_MODIFIED_SECTION_DEFINITIONS = Object.freeze([
  {
    key: "last_month",
    title: "Modified in the last month",
  },
  {
    key: "last_three_months",
    title: "Modified in the last 3 months",
  },
  {
    key: "three_plus_months",
    title: "Modified 3+ months ago",
  },
]);

class ReviewsCommand extends BaseCalypsoCommand {
  constructor() {
    super("reviews");
  }

  parse({ commandWords }) {
    const argumentsList = commandWords.slice(1);
    if (argumentsList.length > 3) {
      return this.buildRespondParsedCommand(buildUsageMessage());
    }

    let sawRecentKeyword = false;
    let timeframe = null;
    let githubUser = null;
    let reviewRecapTabKey = null;
    let reviewRecapPage = 1;
    let sawReviewRecapPage = false;

    for (const argument of argumentsList) {
      const normalizedArgument = String(argument || "").trim();
      const lowerCasedArgument = normalizedArgument.toLowerCase();

      if (lowerCasedArgument === "recent") {
        sawRecentKeyword = true;
        continue;
      }

      if (lowerCasedArgument.startsWith("tab:")) {
        const requestedTabKey = lowerCasedArgument.slice("tab:".length);
        if (reviewRecapTabKey || !REVIEW_RECAP_TAB_KEYS.has(requestedTabKey)) {
          return this.buildRespondParsedCommand(buildUsageMessage());
        }
        reviewRecapTabKey = requestedTabKey;
        continue;
      }

      if (lowerCasedArgument.startsWith("page:")) {
        const requestedPage = Number(lowerCasedArgument.slice("page:".length));
        if (sawReviewRecapPage || !Number.isInteger(requestedPage) || requestedPage <= 0) {
          return this.buildRespondParsedCommand(buildUsageMessage());
        }
        reviewRecapPage = requestedPage;
        sawReviewRecapPage = true;
        continue;
      }

      if (isValidTimeframe(lowerCasedArgument)) {
        if (timeframe) {
          return this.buildRespondParsedCommand(buildUsageMessage());
        }
        timeframe = lowerCasedArgument;
        continue;
      }

      const normalizedGithubUser = normalizeGithubUser(normalizedArgument);
      if (!normalizedGithubUser || githubUser) {
        return this.buildRespondParsedCommand(buildUsageMessage());
      }
      githubUser = normalizedGithubUser;
    }

    if (sawRecentKeyword && !timeframe) {
      return this.buildRespondParsedCommand(buildUsageMessage());
    }
    if (
      (sawReviewRecapPage && !reviewRecapTabKey)
      || (reviewRecapTabKey && (githubUser || timeframe || sawRecentKeyword))
    ) {
      return this.buildRespondParsedCommand(buildUsageMessage());
    }

    return this.buildParsedCommand({
      action: "reviews_list",
      githubUser,
      reviewRecapPage,
      reviewRecapTabKey,
      timeframe,
    });
  }

  async execute({ parsedCommand, runtime }) {
    if (!runtime.pool) {
      return this.buildExecutionResult("Reviews command unavailable: database pool is not configured.");
    }

    if (parsedCommand.reviewRecapTabKey) {
      return executeReviewRecapTab({ parsedCommand, runtime });
    }

    const sinceTimestamp = parsedCommand.timeframe
      ? timeframeSince(parsedCommand.timeframe, Date.now())
      : new Date(0);
    const waitingPullRequests = await runtime.listOpenPullRequestsWaitingOnReviewSinceFn(
      runtime.pool,
      sinceTimestamp,
    );
    const filteredPullRequests = parsedCommand.githubUser
      ? waitingPullRequests.filter(
        (pullRequest) =>
          String(pullRequest.author_login || "").toLowerCase() === parsedCommand.githubUser,
      )
      : waitingPullRequests;
    const sortedPullRequests = sortPullRequestsByMostRecent(filteredPullRequests);

    if (sortedPullRequests.length === 0) {
      return this.buildExecutionResult(
        buildNoResultsMessage({
          githubUser: parsedCommand.githubUser,
          timeframe: parsedCommand.timeframe,
        }),
      );
    }

    const timeZone = await runtime.readTimeZonePreferenceFn(runtime);
    const pullRequestSections = buildLastModifiedSections(sortedPullRequests);
    return this.buildExecutionResult(
      [
        buildResultsHeader({
          githubUser: parsedCommand.githubUser,
          timeframe: parsedCommand.timeframe,
        }),
        ...pullRequestSections.flatMap((section, index) => [
          ...(index === 0 ? [] : [""]),
          `*${section.title}*`,
          ...section.pullRequests.map((pullRequest) =>
            formatReviewPullRequestLine({ pullRequest, timeZone }),
          ),
        ]),
      ].join("\n"),
      {
        presentation: {
          tone: "info",
          title: "Pull request review queue",
          status: {
            detail: `${sortedPullRequests.length} ${sortedPullRequests.length === 1
              ? "needs attention"
              : "need attention"}`,
            label: `${sortedPullRequests.length} open`,
            tone: "warning",
          },
          facts: [
            {
              label: "Scope",
              tone: "info",
              value: parsedCommand.timeframe || "All open PRs",
            },
          ],
          sections: pullRequestSections.map((section) => ({
            layout: "rows",
            title: section.title,
            items: section.pullRequests.map((pullRequest) => ({
              icon: "🔀",
              title: `#${pullRequest.pr_number}  ${pullRequest.title || "(untitled)"}`,
              url: pullRequest.url || "",
              description: `${pullRequest.repo} · by ${pullRequest.author_login || "unknown"}`,
              status: formatReviewStatus(pullRequest.review_state),
              statusTone: pullRequest.review_state === "changes_requested"
                ? "danger"
                : "warning",
            })),
          })),
          actions: [{ id: "refresh_reviews", label: "Refresh", command: "reviews" }],
        },
      },
    );
  }
}

async function executeReviewRecapTab({ parsedCommand, runtime }) {
  const now = new Date();
  const recapConfig = await runtime.getReviewRecapConfigFn(runtime.pool);
  const sinceTimestamp = computeReviewRecapSinceTimestamp({
    now,
    reviewScope: recapConfig.reviewScope,
    recencyValue: recapConfig.recencyValue,
    recencyUnit: recapConfig.recencyUnit,
  });
  const pullRequests = await runtime.listOpenPullRequestsForReviewRecapSinceFn(
    runtime.pool,
    sinceTimestamp,
    new Date(now.getTime() - REVIEW_RECAP_BACKBURNER_AGE_MS),
  );
  const timeZone = recapConfig.timeZone || await runtime.readTimeZonePreferenceFn(runtime);
  const selectedTabKey = parsedCommand.reviewRecapTabKey === "summary"
    ? null
    : parsedCommand.reviewRecapTabKey;
  const recapOptions = {
    now,
    page: parsedCommand.reviewRecapPage,
    pullRequests,
    recencyUnit: recapConfig.recencyUnit,
    recencyValue: recapConfig.recencyValue,
    reviewScope: recapConfig.reviewScope,
    selectedTabKey,
    timeZone,
  };

  return {
    responseText: formatReviewRecapResponse(recapOptions),
    presentation: buildReviewRecapPresentation(recapOptions),
  };
}

function formatReviewStatus(reviewState) {
  return reviewState === "changes_requested" ? "Changes requested" : "Review requested";
}

function normalizeGithubUser(rawGithubUser) {
  const trimmedGithubUser = String(rawGithubUser || "").trim();
  const withoutAtSign = trimmedGithubUser.replace(/^@/, "");
  if (withoutAtSign === "") {
    return null;
  }

  return /^[a-zA-Z0-9-]+$/.test(withoutAtSign) ? withoutAtSign.toLowerCase() : null;
}

function buildUsageMessage() {
  return [
    "Usage:",
    "`/conductor reviews`",
    "`/conductor reviews <GITHUB_USER>`",
    "`/conductor reviews <day|week|month>`",
    "`/conductor reviews recent <day|week|month>`",
    "`/conductor reviews <GITHUB_USER> <day|week|month>`",
  ].join("\n");
}

function buildResultsHeader({ githubUser, timeframe }) {
  const timeScopeSuffix = timeframe ? ` in the last ${timeframe}` : "";
  const githubUserSuffix = githubUser ? ` for github user ${githubUser}` : "";
  return formatReviewListHeader(`Open PRs waiting on review${timeScopeSuffix}${githubUserSuffix}`);
}

function buildNoResultsMessage({ githubUser, timeframe }) {
  const timeScopeSuffix = timeframe ? ` in the last ${timeframe}` : "";
  const githubUserSuffix = githubUser ? ` for github user ${githubUser}` : "";
  return `No open PRs waiting on review${timeScopeSuffix}${githubUserSuffix}.`;
}

function buildLastModifiedSections(sortedPullRequests) {
  const nowTimestamp = Date.now();
  const pullRequestsBySectionKey = {
    last_month: [],
    last_three_months: [],
    three_plus_months: [],
  };

  for (const pullRequest of sortedPullRequests) {
    const sectionKey = mapPullRequestToLastModifiedSectionKey(pullRequest, nowTimestamp);
    pullRequestsBySectionKey[sectionKey].push(pullRequest);
  }

  return LAST_MODIFIED_SECTION_DEFINITIONS
    .map((sectionDefinition) => ({
      title: sectionDefinition.title,
      pullRequests: pullRequestsBySectionKey[sectionDefinition.key],
    }))
    .filter((section) => section.pullRequests.length > 0);
}

function mapPullRequestToLastModifiedSectionKey(pullRequest, nowTimestamp) {
  const lastModifiedTimestamp = readReviewPullRequestLastModifiedTimestamp(pullRequest);
  if (!Number.isFinite(lastModifiedTimestamp)) {
    return "three_plus_months";
  }

  const ageInMilliseconds = nowTimestamp - lastModifiedTimestamp;
  if (ageInMilliseconds < LAST_MONTH_WINDOW_MILLISECONDS) {
    return "last_month";
  }
  if (ageInMilliseconds < LAST_THREE_MONTHS_WINDOW_MILLISECONDS) {
    return "last_three_months";
  }

  return "three_plus_months";
}

module.exports = {
  ReviewsCommand,
};
