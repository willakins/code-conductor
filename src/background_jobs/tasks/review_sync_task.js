const {
  markStaleOpenPullRequestsClosed,
  upsertOpenPullRequestReviewState,
} = require("../../db");

const REVIEW_SYNC_TASK_NAME = "reviewSync";

function createReviewSyncTask(options = {}) {
  const markStaleOpenPullRequestsClosedFn =
    options.markStaleOpenPullRequestsClosedFn || markStaleOpenPullRequestsClosed;
  const upsertOpenPullRequestReviewStateFn =
    options.upsertOpenPullRequestReviewStateFn || upsertOpenPullRequestReviewState;

  return {
    name: REVIEW_SYNC_TASK_NAME,
    async run(syncContext) {
      const { codeHostClient, repository } = syncContext;
      const { mainBranch, nowFn, pool } = syncContext;

      const openPullRequests = await codeHostClient.listOpenPullRequests({
        repository,
        repositoryFullName: repository,
        baseBranch: mainBranch,
      });

      const syncedAt = nowFn().toISOString();
      const openPrNumbers = [];
      let upsertedCount = 0;
      for (const pullRequest of openPullRequests) {
        const mappedReviewState = await mapOpenPullRequestToReviewState({
          codeHostClient,
          mainBranch,
          pullRequest,
          repository,
        });
        if (!mappedReviewState) {
          continue;
        }

        await upsertOpenPullRequestReviewStateFn(pool, mappedReviewState);
        openPrNumbers.push(mappedReviewState.prNumber);
        upsertedCount += 1;
      }

      const closedCount = await markStaleOpenPullRequestsClosedFn(pool, {
        repo: repository,
        baseBranch: mainBranch,
        openPrNumbers,
        closedAt: syncedAt,
      });

      return {
        closedCount,
        openPullRequestCount: openPullRequests.length,
        upsertedCount,
      };
    },
  };
}

async function mapOpenPullRequestToReviewState({
  codeHostClient,
  mainBranch,
  pullRequest,
  repository,
}) {
  const prNumber = Number(pullRequest?.number);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    return null;
  }

  const baseBranch = String(pullRequest?.base?.ref || "");
  if (baseBranch !== mainBranch) {
    return null;
  }

  const isDraft = Boolean(pullRequest?.draft);
  const openedAt = pullRequest?.created_at || pullRequest?.updated_at || new Date().toISOString();
  const reviews = await codeHostClient.listPullRequestReviews({
    repository,
    repositoryFullName: repository,
    prNumber,
  });
  const codexApproved = await readCodexApproval({
    codeHostClient,
    repository,
    prNumber,
  });

  return {
    repo: repository,
    prNumber,
    title: pullRequest?.title || null,
    url: pullRequest?.html_url || null,
    authorLogin: pullRequest?.user?.login || "unknown",
    baseBranch,
    isDraft,
    lifecycleState: "open",
    reviewState: isDraft ? "waiting" : deriveReviewStateFromReviews(reviews),
    codexApproved,
    openedAt,
    openedForReviewAt: isDraft ? null : openedAt,
    closedAt: null,
    mergedAt: null,
    lastReviewedAt: extractLatestReviewTimestamp(reviews),
    lastModifiedAt: pullRequest?.updated_at || openedAt,
  };
}

function deriveReviewStateFromReviews(reviews) {
  const sortedReviews = [...(Array.isArray(reviews) ? reviews : [])].sort(
    (left, right) => readReviewTimestamp(left) - readReviewTimestamp(right),
  );

  let reviewState = "waiting";
  for (const review of sortedReviews) {
    const mappedState = mapGithubReviewState(review?.state);
    if (mappedState !== undefined) {
      reviewState = mappedState;
    }
  }

  return reviewState;
}

function mapGithubReviewState(rawState) {
  const normalizedState = String(rawState || "").toLowerCase().trim();
  if (normalizedState === "approved") {
    return "approved";
  }
  if (normalizedState === "changes_requested") {
    return "changes_requested";
  }
  if (normalizedState === "dismissed") {
    return "waiting";
  }
  if (normalizedState === "commented") {
    return undefined;
  }
  return undefined;
}

function extractLatestReviewTimestamp(reviews) {
  const validReviews = Array.isArray(reviews) ? reviews : [];
  let latestTimestamp = null;
  let latestValue = Number.NEGATIVE_INFINITY;
  for (const review of validReviews) {
    const timestamp = readReviewTimestamp(review);
    if (Number.isFinite(timestamp) && timestamp > latestValue) {
      latestValue = timestamp;
      latestTimestamp = readReviewTimestampIso(review);
    }
  }

  return latestTimestamp;
}

function readReviewTimestamp(review) {
  const isoTimestamp = readReviewTimestampIso(review);
  const parsedTimestamp = Date.parse(isoTimestamp || "");
  return Number.isNaN(parsedTimestamp) ? Number.NEGATIVE_INFINITY : parsedTimestamp;
}

function readReviewTimestampIso(review) {
  return review?.submitted_at || review?.updated_at || review?.created_at || null;
}

async function readCodexApproval({
  codeHostClient,
  repository,
  prNumber,
}) {
  if (typeof codeHostClient?.isPullRequestCodexApproved !== "function") {
    return false;
  }

  try {
    return await codeHostClient.isPullRequestCodexApproved({
      repository,
      repositoryFullName: repository,
      prNumber,
    });
  } catch (_error) {
    return false;
  }
}

function buildEmptyReviewSyncResult() {
  return {
    closedCount: 0,
    openPullRequestCount: 0,
    upsertedCount: 0,
  };
}

module.exports = {
  buildEmptyReviewSyncResult,
  createReviewSyncTask,
  deriveReviewStateFromReviews,
  REVIEW_SYNC_TASK_NAME,
};
