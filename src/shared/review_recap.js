const REVIEW_RECAP_BACKBURNER_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const REVIEW_RECAP_CATEGORY_KEYS = Object.freeze({
  approved: "approved",
  waitingHuman: "waiting_human",
  unapproved: "unapproved",
  backburner: "backburner",
});

function categorizeReviewRecapPullRequests({ pullRequests, now = new Date() }) {
  const pullRequestsByCategory = Object.fromEntries(
    Object.values(REVIEW_RECAP_CATEGORY_KEYS).map((key) => [key, []]),
  );
  const nowTimestamp = readTimestamp(now);

  for (const pullRequest of Array.isArray(pullRequests) ? pullRequests : []) {
    if (isBackburnerPullRequest(pullRequest, nowTimestamp)) {
      pullRequestsByCategory[REVIEW_RECAP_CATEGORY_KEYS.backburner].push(pullRequest);
    } else if (isHumanApprovedPullRequest(pullRequest)) {
      pullRequestsByCategory[REVIEW_RECAP_CATEGORY_KEYS.approved].push(pullRequest);
    } else if (pullRequest?.codex_approved === true) {
      pullRequestsByCategory[REVIEW_RECAP_CATEGORY_KEYS.waitingHuman].push(pullRequest);
    } else {
      pullRequestsByCategory[REVIEW_RECAP_CATEGORY_KEYS.unapproved].push(pullRequest);
    }
  }

  return pullRequestsByCategory;
}

function computeReviewRecapSinceTimestamp({ now, reviewScope, recencyValue, recencyUnit }) {
  const nowTimestamp = now instanceof Date ? now : new Date(now);
  const normalizedReviewScope = normalizeReviewRecapScope(reviewScope);
  const daysByScope = { day: 1, week: 7, month: 30 };
  if (daysByScope[normalizedReviewScope]) {
    return new Date(
      nowTimestamp.getTime() - daysByScope[normalizedReviewScope] * 24 * 60 * 60 * 1000,
    );
  }
  if (normalizedReviewScope !== "legacy") {
    return new Date(0);
  }

  const parsedRecencyValue = Number(recencyValue);
  const normalizedRecencyValue = Number.isInteger(parsedRecencyValue) && parsedRecencyValue > 0
    ? parsedRecencyValue
    : 1;
  const durationDays = String(recencyUnit || "").toLowerCase().trim() === "d"
    ? normalizedRecencyValue
    : normalizedRecencyValue * 7;
  return new Date(nowTimestamp.getTime() - durationDays * 24 * 60 * 60 * 1000);
}

function normalizeReviewRecapScope(reviewScope) {
  const normalizedScope = String(reviewScope || "").toLowerCase().trim();
  return ["all", "day", "week", "month", "legacy"].includes(normalizedScope)
    ? normalizedScope
    : "all";
}

function readReviewPullRequestLastModifiedAt(pullRequest) {
  return pullRequest?.last_modified_at
    || pullRequest?.last_reviewed_at
    || pullRequest?.opened_for_review_at
    || pullRequest?.opened_at
    || null;
}

function readReviewPullRequestLastModifiedTimestamp(pullRequest) {
  return readTimestamp(readReviewPullRequestLastModifiedAt(pullRequest));
}

function isBackburnerPullRequest(pullRequest, nowTimestamp) {
  const lastModifiedTimestamp = readReviewPullRequestLastModifiedTimestamp(pullRequest);
  return Number.isFinite(nowTimestamp)
    && Number.isFinite(lastModifiedTimestamp)
    && nowTimestamp - lastModifiedTimestamp > REVIEW_RECAP_BACKBURNER_AGE_MS;
}

function isHumanApprovedPullRequest(pullRequest) {
  return String(pullRequest?.review_state || "").toLowerCase().trim() === "approved";
}

function readTimestamp(value) {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }

  const parsedDate = value instanceof Date ? value : new Date(value);
  const timestamp = parsedDate.getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

module.exports = {
  REVIEW_RECAP_BACKBURNER_AGE_MS,
  REVIEW_RECAP_CATEGORY_KEYS,
  categorizeReviewRecapPullRequests,
  computeReviewRecapSinceTimestamp,
  readReviewPullRequestLastModifiedAt,
  readReviewPullRequestLastModifiedTimestamp,
};
