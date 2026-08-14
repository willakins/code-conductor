const {
  updatePullRequestCodexApproval,
  updatePullRequestReviewSubmission,
  upsertOpenPullRequestReviewState,
  upsertPullRequestAsUntested,
} = require("../../../../db");
const {
  createCodeHostWebhookHandler,
  registerRawJsonWebhookRoutes,
} = require("../shared/webhook_common");
const { verifyGithubSignature } = require("./verify_signature");

function registerGithubWebhook(httpApp, options) {
  const webhookHandler = createGithubWebhookHandler(options);
  registerRawJsonWebhookRoutes(httpApp, {
    paths: options.paths,
    defaultPath: "/codehost/webhook",
    handler: webhookHandler,
  });
}

function createGithubWebhookHandler(options) {
  const {
    logger = null,
    pool,
    upsertPullRequestAsUntestedFn = upsertPullRequestAsUntested,
    upsertOpenPullRequestReviewStateFn = upsertOpenPullRequestReviewState,
    updatePullRequestReviewSubmissionFn = updatePullRequestReviewSubmission,
    updatePullRequestCodexApprovalFn = updatePullRequestCodexApproval,
  } = options;
  const githubSettings = readGithubSettings(options);

  return createCodeHostWebhookHandler({
    providerLabel: "GitHub",
    webhookSecret: githubSettings.webhookSecret,
    isRequestSignatureValid,
    readDeliveryId: readGithubDeliveryId,
    readEventName: readGithubEventName,
    describePayload: (payload, eventName) =>
      describeGithubWebhookPayload(payload, eventName, githubSettings),
    isSupportedEvent: isSupportedGithubWebhookEvent,
    isPullRequestForTrackedMain: (payload, eventName) =>
      isPullRequestForTrackedMain(payload, githubSettings, eventName),
    processEvent: ({ eventName, payload }) =>
      processWebhookEvent({
        eventName,
        payload,
        pool,
        upsertPullRequestAsUntestedFn,
        upsertOpenPullRequestReviewStateFn,
        updatePullRequestReviewSubmissionFn,
        updatePullRequestCodexApprovalFn,
        githubSettings,
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
  updatePullRequestCodexApprovalFn,
  githubSettings,
}) {
  if (eventName === "pull_request") {
    return processPullRequestWebhookEvent({
      payload,
      pool,
      upsertPullRequestAsUntestedFn,
      upsertOpenPullRequestReviewStateFn,
    });
  }

  if (eventName === "pull_request_review") {
    return processPullRequestReviewWebhookEvent({
      payload,
      pool,
      updatePullRequestReviewSubmissionFn,
    });
  }

  if (eventName === "reaction") {
    return processReactionWebhookEvent({
      payload,
      pool,
      updatePullRequestCodexApprovalFn,
      codexUserLogins: githubSettings.codexUserLogins,
    });
  }

  return { ignored: true };
}

async function processPullRequestWebhookEvent({
  payload,
  pool,
  upsertPullRequestAsUntestedFn,
  upsertOpenPullRequestReviewStateFn,
}) {
  let savedReviewState = null;
  const mappedReviewState = mapPullRequestLifecyclePayload(payload);
  if (mappedReviewState) {
    savedReviewState = await upsertOpenPullRequestReviewStateFn(pool, mappedReviewState);
  }

  let savedPullRequest = null;
  if (isMergedPullRequestPayload(payload)) {
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

async function processPullRequestReviewWebhookEvent({
  payload,
  pool,
  updatePullRequestReviewSubmissionFn,
}) {
  if (String(payload.action || "").toLowerCase() !== "submitted") {
    return { ignored: true };
  }

  const mappedReviewSubmission = mapPullRequestReviewSubmission(payload);
  if (!mappedReviewSubmission) {
    return { ignored: true };
  }

  const updatedReviewRecord = await updatePullRequestReviewSubmissionFn(pool, mappedReviewSubmission);
  return {
    review_tracking_updated: Boolean(updatedReviewRecord),
    pr_number: mappedReviewSubmission.prNumber,
    review_state: updatedReviewRecord?.review_state || null,
  };
}

async function processReactionWebhookEvent({
  payload,
  pool,
  updatePullRequestCodexApprovalFn,
  codexUserLogins,
}) {
  const mappedApprovalUpdate = mapCodexApprovalReactionPayload(payload, codexUserLogins);
  if (!mappedApprovalUpdate) {
    return { ignored: true };
  }

  const updatedReviewRecord = await updatePullRequestCodexApprovalFn(pool, mappedApprovalUpdate);
  return {
    review_tracking_updated: Boolean(updatedReviewRecord),
    pr_number: mappedApprovalUpdate.prNumber,
    codex_approved: updatedReviewRecord?.codex_approved || false,
  };
}

function readGithubSettings(options) {
  if (options.github) {
    return {
      mainBranch: options.github.mainBranch,
      repositoryFullName: options.github.repositoryFullName,
      webhookSecret: options.github.webhookSecret,
      codexUserLogins: normalizeCodexUserLogins(options.github.codexUserLogins),
    };
  }

  const legacyConfig = options.config || {};
  return {
    mainBranch: legacyConfig.codeHostMainBranch || legacyConfig.githubMainBranch,
    repositoryFullName: legacyConfig.codeHostRepository || legacyConfig.githubRepo,
    webhookSecret: legacyConfig.codeHostWebhookSecret || legacyConfig.githubWebhookSecret,
    codexUserLogins: normalizeCodexUserLogins(legacyConfig.codeHostCodexUserLogins),
  };
}

function isRequestSignatureValid(request, webhookSecret) {
  return verifyGithubSignature({
    payloadBuffer: request.body,
    signatureHeader: request.get("x-hub-signature-256"),
    secret: webhookSecret,
  });
}

function readGithubEventName(request) {
  return String(request.get("x-github-event") || "").toLowerCase();
}

function readGithubDeliveryId(request) {
  return String(request.get("x-github-delivery") || "").trim() || null;
}

function isSupportedGithubWebhookEvent(eventName) {
  return eventName === "pull_request" || eventName === "pull_request_review" || eventName === "reaction";
}

function describeGithubWebhookPayload(payload, eventName, githubSettings) {
  const pullRequest = payload.pull_request || {};
  const repo = payload.repository?.full_name || null;
  const baseBranch = pullRequest.base?.ref || null;
  const prNumber = pullRequest.number || payload.issue?.number || null;

  return {
    action: payload.action || null,
    repo,
    expected_repo: githubSettings.repositoryFullName,
    repo_matches: repo === githubSettings.repositoryFullName,
    pr_number: prNumber,
    base_branch: baseBranch,
    expected_base_branch: eventName === "reaction" ? null : githubSettings.mainBranch,
    base_branch_matches:
      eventName === "reaction" ? null : baseBranch === githubSettings.mainBranch,
    merged: pullRequest.merged,
    is_pull_request_description_reaction:
      eventName === "reaction" ? isPullRequestDescriptionReaction(payload) : null,
  };
}

function isPullRequestForTrackedMain(payload, githubSettings, eventName) {
  if (eventName === "reaction") {
    return (
      payload.repository &&
      payload.repository.full_name === githubSettings.repositoryFullName &&
      isPullRequestDescriptionReaction(payload)
    );
  }

  return (
    payload.pull_request &&
    payload.pull_request.base &&
    payload.pull_request.base.ref === githubSettings.mainBranch &&
    payload.repository &&
    payload.repository.full_name === githubSettings.repositoryFullName
  );
}

function isMergedPullRequestPayload(payload) {
  return String(payload.action || "").toLowerCase() === "closed" && payload.pull_request?.merged === true;
}

function mapPayloadToPullRequestRecord(payload) {
  return {
    repo: payload.repository.full_name,
    prNumber: payload.pull_request.number,
    title: payload.pull_request.title || null,
    url: payload.pull_request.html_url || null,
    mergedAt: payload.pull_request.merged_at,
  };
}

function mapPullRequestLifecyclePayload(payload) {
  const action = String(payload.action || "").toLowerCase();
  const pullRequest = payload.pull_request;
  if (!pullRequest || !payload.repository) {
    return null;
  }

  const baseState = {
    repo: payload.repository.full_name,
    prNumber: pullRequest.number,
    title: pullRequest.title || null,
    url: pullRequest.html_url || null,
    authorLogin: pullRequest.user?.login || "unknown",
    baseBranch: pullRequest.base?.ref || "",
    openedAt: pullRequest.created_at,
    lastModifiedAt: pullRequest.updated_at || pullRequest.created_at,
    lastReviewedAt: null,
  };

  if (action === "opened") {
    const isDraft = Boolean(pullRequest.draft);
    return {
      ...baseState,
      isDraft,
      lifecycleState: "open",
      reviewState: "waiting",
      openedForReviewAt: isDraft ? null : pullRequest.created_at,
      closedAt: null,
      mergedAt: null,
    };
  }

  if (action === "ready_for_review") {
    return {
      ...baseState,
      isDraft: false,
      lifecycleState: "open",
      reviewState: "waiting",
      openedForReviewAt: pullRequest.updated_at,
      closedAt: null,
      mergedAt: null,
    };
  }

  if (action === "converted_to_draft") {
    return {
      ...baseState,
      isDraft: true,
      lifecycleState: "open",
      reviewState: "waiting",
      openedForReviewAt: null,
      closedAt: null,
      mergedAt: null,
    };
  }

  if (action === "synchronize" || action === "review_requested" || action === "reopened") {
    const isDraft = Boolean(pullRequest.draft);
    return {
      ...baseState,
      isDraft,
      lifecycleState: "open",
      reviewState: "waiting",
      openedForReviewAt: isDraft ? null : pullRequest.updated_at,
      closedAt: null,
      mergedAt: null,
    };
  }

  if (action === "closed") {
    const isMerged = Boolean(pullRequest.merged);
    return {
      ...baseState,
      isDraft: Boolean(pullRequest.draft),
      lifecycleState: isMerged ? "merged" : "closed",
      reviewState: "waiting",
      openedForReviewAt: Boolean(pullRequest.draft) ? null : pullRequest.updated_at,
      closedAt: isMerged ? null : pullRequest.closed_at || pullRequest.updated_at,
      mergedAt: isMerged ? pullRequest.merged_at : null,
    };
  }

  return null;
}

function mapPullRequestReviewSubmission(payload) {
  const reviewState = mapPullRequestReviewState(payload.review?.state);
  if (reviewState === undefined) {
    return null;
  }

  return {
    repo: payload.repository.full_name,
    prNumber: payload.pull_request.number,
    reviewState,
    lastReviewedAt: payload.review?.submitted_at || payload.review?.updated_at || null,
  };
}

function mapPullRequestReviewState(rawReviewState) {
  const normalizedReviewState = String(rawReviewState || "").toLowerCase().trim();
  if (normalizedReviewState === "approved") {
    return "approved";
  }
  if (normalizedReviewState === "changes_requested") {
    return "changes_requested";
  }
  if (normalizedReviewState === "commented") {
    return null;
  }

  return undefined;
}

function mapCodexApprovalReactionPayload(payload, codexUserLogins) {
  if (!isPullRequestDescriptionReaction(payload)) {
    return null;
  }

  const action = String(payload.action || "").toLowerCase().trim();
  if (action !== "created" && action !== "deleted") {
    return null;
  }

  const reactionContent = String(payload.reaction?.content || "").toLowerCase().trim();
  if (reactionContent !== "+1") {
    return null;
  }

  const actorLogin = String(payload.sender?.login || payload.reaction?.user?.login || "")
    .toLowerCase()
    .trim();
  if (!actorLogin || !codexUserLogins.includes(actorLogin)) {
    return null;
  }

  const repo = payload.repository?.full_name;
  const prNumber = Number(payload.issue?.number);
  if (!repo || !Number.isInteger(prNumber) || prNumber <= 0) {
    return null;
  }

  return {
    repo,
    prNumber,
    codexApproved: action === "created",
  };
}

function isPullRequestDescriptionReaction(payload) {
  return (
    payload.issue &&
    payload.issue.pull_request &&
    !payload.comment
  );
}

function normalizeCodexUserLogins(rawLogins) {
  const rawValues = Array.isArray(rawLogins) ? rawLogins : [rawLogins];
  const normalizedLogins = rawValues
    .map((value) => String(value || "").toLowerCase().trim())
    .filter(Boolean);

  if (normalizedLogins.length > 0) {
    return normalizedLogins;
  }

  return ["codex", "codex[bot]"];
}

module.exports = {
  createGithubWebhookHandler,
  registerGithubWebhook,
};
