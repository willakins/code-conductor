const {
  updatePullRequestReviewSubmission,
  upsertOpenPullRequestReviewState,
  upsertPullRequestAsUntested,
} = require("../../../../db");
const {
  createCodeHostWebhookHandler,
  registerRawJsonWebhookRoutes,
} = require("../shared/webhook_common");
const { verifyBitbucketSignature } = require("./verify_signature");

function registerBitbucketWebhook(httpApp, options) {
  const webhookHandler = createBitbucketWebhookHandler(options);
  registerRawJsonWebhookRoutes(httpApp, {
    paths: options.paths,
    defaultPath: "/bitbucket/webhook",
    handler: webhookHandler,
  });
}

function createBitbucketWebhookHandler(options) {
  const {
    logger = null,
    pool,
    upsertPullRequestAsUntestedFn = upsertPullRequestAsUntested,
    upsertOpenPullRequestReviewStateFn = upsertOpenPullRequestReviewState,
    updatePullRequestReviewSubmissionFn = updatePullRequestReviewSubmission,
  } = options;
  const bitbucketSettings = readBitbucketSettings(options);

  return createCodeHostWebhookHandler({
    providerLabel: "Bitbucket",
    webhookSecret: bitbucketSettings.webhookSecret,
    isRequestSignatureValid,
    readDeliveryId: readBitbucketDeliveryId,
    readEventName: readBitbucketEventName,
    describePayload: (payload) =>
      describeBitbucketWebhookPayload(payload, bitbucketSettings),
    isSupportedEvent: isSupportedBitbucketWebhookEvent,
    isPullRequestForTrackedMain: (payload) =>
      isPullRequestForTrackedMain(payload, bitbucketSettings),
    processEvent: ({ eventName, payload }) =>
      processWebhookEvent({
        eventName,
        payload,
        pool,
        upsertPullRequestAsUntestedFn,
        upsertOpenPullRequestReviewStateFn,
        updatePullRequestReviewSubmissionFn,
      }),
    logger,
  });
}

async function processWebhookEvent({
  eventName,
  payload,
  pool,
  upsertPullRequestAsUntestedFn,
  upsertOpenPullRequestReviewStateFn,
  updatePullRequestReviewSubmissionFn,
}) {
  if (eventName.startsWith("pullrequest:")) {
    return processPullRequestWebhookEvent({
      eventName,
      payload,
      pool,
      upsertPullRequestAsUntestedFn,
      upsertOpenPullRequestReviewStateFn,
      updatePullRequestReviewSubmissionFn,
    });
  }

  return { ignored: true };
}

async function processPullRequestWebhookEvent({
  eventName,
  payload,
  pool,
  upsertPullRequestAsUntestedFn,
  upsertOpenPullRequestReviewStateFn,
  updatePullRequestReviewSubmissionFn,
}) {
  if (eventName === "pullrequest:approved" || eventName === "pullrequest:unapproved") {
    const reviewSubmission = mapPullRequestReviewSubmission({
      eventName,
      payload,
    });
    if (!reviewSubmission) {
      return { ignored: true };
    }

    const updatedReviewRecord = await updatePullRequestReviewSubmissionFn(pool, reviewSubmission);
    return {
      review_tracking_updated: Boolean(updatedReviewRecord),
      pr_number: reviewSubmission.prNumber,
      review_state: updatedReviewRecord?.review_state || null,
    };
  }

  const mappedReviewState = mapPullRequestLifecyclePayload(payload);
  let savedReviewState = null;
  if (mappedReviewState) {
    savedReviewState = await upsertOpenPullRequestReviewStateFn(pool, mappedReviewState);
  }

  let savedPullRequest = null;
  if (isMergedPullRequestEvent({ eventName, payload })) {
    const pullRequestRecord = mapPayloadToPullRequestRecord(payload);
    savedPullRequest = await upsertPullRequestAsUntestedFn(pool, pullRequestRecord);
  }

  if (savedPullRequest) {
    return {
      pr_number: savedPullRequest.pr_number,
      status: savedPullRequest.status,
    };
  }

  if (savedReviewState) {
    return {
      review_tracking_updated: true,
      pr_number: savedReviewState.pr_number,
      review_state: savedReviewState.review_state,
    };
  }

  return { ignored: true };
}

function readBitbucketSettings(options) {
  if (options.bitbucket) {
    return {
      mainBranch: options.bitbucket.mainBranch,
      repositoryFullName: options.bitbucket.repositoryFullName,
      webhookSecret: options.bitbucket.webhookSecret,
    };
  }

  const config = options.config || {};
  return {
    mainBranch: config.codeHostMainBranch,
    repositoryFullName: config.codeHostRepository,
    webhookSecret: config.codeHostWebhookSecret,
  };
}

function isRequestSignatureValid(request, webhookSecret) {
  return verifyBitbucketSignature({
    payloadBuffer: request.body,
    signatureHeader: request.get("x-hub-signature"),
    secret: webhookSecret,
  });
}

function readBitbucketEventName(request) {
  return String(request.get("x-event-key") || "").toLowerCase();
}

function readBitbucketDeliveryId(request) {
  return String(request.get("x-request-uuid") || "").trim() || null;
}

function isSupportedBitbucketWebhookEvent(eventName) {
  return (
    eventName === "pullrequest:created" ||
    eventName === "pullrequest:updated" ||
    eventName === "pullrequest:approved" ||
    eventName === "pullrequest:unapproved" ||
    eventName === "pullrequest:fulfilled" ||
    eventName === "pullrequest:rejected"
  );
}

function describeBitbucketWebhookPayload(payload, bitbucketSettings) {
  const pullRequest = payload.pullrequest || {};
  const repo = payload.repository?.full_name || null;
  const baseBranch = pullRequest.destination?.branch?.name || null;

  return {
    repo,
    expected_repo: bitbucketSettings.repositoryFullName,
    repo_matches: repo === bitbucketSettings.repositoryFullName,
    pr_number: pullRequest.id || null,
    base_branch: baseBranch,
    expected_base_branch: bitbucketSettings.mainBranch,
    base_branch_matches: baseBranch === bitbucketSettings.mainBranch,
    pull_request_state: pullRequest.state || null,
    merged: isMergedPullRequestEvent({ eventName: "", payload }),
  };
}

function isPullRequestForTrackedMain(payload, bitbucketSettings) {
  return (
    payload.pullrequest &&
    payload.pullrequest.destination &&
    payload.pullrequest.destination.branch &&
    payload.pullrequest.destination.branch.name === bitbucketSettings.mainBranch &&
    payload.repository &&
    payload.repository.full_name === bitbucketSettings.repositoryFullName
  );
}

function isMergedPullRequestEvent({ eventName, payload }) {
  if (eventName === "pullrequest:fulfilled") {
    return true;
  }

  const normalizedState = String(payload.pullrequest?.state || "").toUpperCase();
  return normalizedState === "MERGED";
}

function mapPayloadToPullRequestRecord(payload) {
  return {
    repo: payload.repository.full_name,
    prNumber: payload.pullrequest.id,
    title: payload.pullrequest.title || null,
    url: payload.pullrequest.links?.html?.href || null,
    mergedAt: payload.pullrequest.updated_on,
  };
}

function mapPullRequestLifecyclePayload(payload) {
  const pullRequest = payload.pullrequest;
  if (!pullRequest || !payload.repository) {
    return null;
  }

  const normalizedState = String(pullRequest.state || "").toUpperCase();
  const isDraft = Boolean(pullRequest.draft);
  const createdAt = pullRequest.created_on || pullRequest.updated_on || null;
  const updatedAt = pullRequest.updated_on || createdAt;

  const baseState = {
    repo: payload.repository.full_name,
    prNumber: pullRequest.id,
    title: pullRequest.title || null,
    url: pullRequest.links?.html?.href || null,
    authorLogin: readBitbucketUserLogin(pullRequest.author?.user),
    baseBranch: pullRequest.destination?.branch?.name || "",
    openedAt: createdAt,
    lastModifiedAt: updatedAt,
    lastReviewedAt: null,
  };

  if (normalizedState === "MERGED") {
    return {
      ...baseState,
      isDraft,
      lifecycleState: "merged",
      reviewState: "waiting",
      openedForReviewAt: isDraft ? null : updatedAt,
      closedAt: null,
      mergedAt: updatedAt,
    };
  }

  if (normalizedState === "DECLINED" || normalizedState === "SUPERSEDED") {
    return {
      ...baseState,
      isDraft,
      lifecycleState: "closed",
      reviewState: "waiting",
      openedForReviewAt: isDraft ? null : updatedAt,
      closedAt: updatedAt,
      mergedAt: null,
    };
  }

  return {
    ...baseState,
    isDraft,
    lifecycleState: "open",
    reviewState: "waiting",
    openedForReviewAt: isDraft ? null : createdAt,
    closedAt: null,
    mergedAt: null,
  };
}

function mapPullRequestReviewSubmission({ eventName, payload }) {
  const reviewState = mapBitbucketReviewState(eventName);
  if (reviewState === undefined) {
    return null;
  }

  return {
    repo: payload.repository.full_name,
    prNumber: payload.pullrequest.id,
    reviewState,
    lastReviewedAt: payload.pullrequest.updated_on || null,
  };
}

function mapBitbucketReviewState(eventName) {
  if (eventName === "pullrequest:approved") {
    return "approved";
  }

  if (eventName === "pullrequest:unapproved") {
    return "waiting";
  }

  return undefined;
}

function readBitbucketUserLogin(user) {
  return (
    user?.nickname ||
    user?.username ||
    user?.display_name ||
    user?.account_id ||
    "unknown"
  );
}

module.exports = {
  createBitbucketWebhookHandler,
  registerBitbucketWebhook,
};
