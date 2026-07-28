const { BaseCalypsoCommand } = require("./base_command");
const { isValidTimeframe, timeframeSince } = require("../../shared/timeframes");
const {
  formatReviewListHeader,
  formatReviewPullRequestLine,
  sortPullRequestsByMostRecent,
} = require("../../util/format");

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;
const LAST_MONTH_WINDOW_MILLISECONDS = 30 * DAY_IN_MILLISECONDS;
const LAST_THREE_MONTHS_WINDOW_MILLISECONDS = 90 * DAY_IN_MILLISECONDS;
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

    for (const argument of argumentsList) {
      const normalizedArgument = String(argument || "").trim();
      const lowerCasedArgument = normalizedArgument.toLowerCase();

      if (lowerCasedArgument === "recent") {
        sawRecentKeyword = true;
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

    return this.buildParsedCommand({
      action: "reviews_list",
      githubUser,
      timeframe,
    });
  }

  async execute({ parsedCommand, runtime }) {
    if (!runtime.pool) {
      return this.buildExecutionResult("Reviews command unavailable: database pool is not configured.");
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
          tone: "neutral",
          title: "Pull requests waiting on review",
          summary: `${sortedPullRequests.length} open pull request(s) need reviewer attention.`,
          facts: [
            { label: "PRs waiting", value: String(sortedPullRequests.length) },
            { label: "Scope", value: parsedCommand.timeframe || "all open PRs" },
          ],
          sections: pullRequestSections.map((section) => ({
            title: section.title,
            items: section.pullRequests.map((pullRequest) => ({
              title: `${pullRequest.repo}#${pullRequest.pr_number} — ${pullRequest.title || "(untitled)"}`,
              url: pullRequest.url || "",
              description: `Author: ${pullRequest.author_login || "unknown"} · Review: ${pullRequest.review_state || "waiting"}`,
            })),
          })),
          actions: [{ id: "refresh_reviews", label: "Refresh", command: "reviews" }],
        },
      },
    );
  }
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
    "`/calypso reviews`",
    "`/calypso reviews <GITHUB_USER>`",
    "`/calypso reviews <day|week|month>`",
    "`/calypso reviews recent <day|week|month>`",
    "`/calypso reviews <GITHUB_USER> <day|week|month>`",
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
  const lastModifiedTimestamp = readPullRequestLastModifiedTimestamp(pullRequest);
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

function readPullRequestLastModifiedTimestamp(pullRequest) {
  const lastModifiedAt = pullRequest?.last_modified_at
    || pullRequest?.last_reviewed_at
    || pullRequest?.opened_for_review_at
    || pullRequest?.opened_at
    || null;
  if (!lastModifiedAt) {
    return Number.NEGATIVE_INFINITY;
  }

  const parsedDate = lastModifiedAt instanceof Date ? lastModifiedAt : new Date(lastModifiedAt);
  const timestamp = parsedDate.getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

module.exports = {
  ReviewsCommand,
};
