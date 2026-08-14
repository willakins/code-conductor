const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const test = require("node:test");

const express = require("express");

const {
  createGithubWebhookHandler,
  registerGithubWebhook,
} = require("../../src/platform/code_host/providers/github/webhook");
const { verifyGithubSignature } = require("../../src/platform/code_host/providers/github/verify_signature");

function signPayload(secret, payloadBuffer) {
  return `sha256=${crypto.createHmac("sha256", secret).update(payloadBuffer).digest("hex")}`;
}

function buildReqRes({ payload, signature, event = "pull_request", delivery = "delivery-123" }) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const headers = {
    "x-github-delivery": delivery,
    "x-github-event": event,
    "x-hub-signature-256": signature,
  };

  const req = {
    body,
    get(name) {
      return headers[name.toLowerCase()];
    },
  };

  const res = {
    body: null,
    statusCode: 200,
    json(payloadBody) {
      this.body = payloadBody;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
  };

  return { req, res, body };
}

function createCapturingLogger() {
  const entries = [];
  return {
    entries,
    info(message) {
      entries.push(parseWebhookLogMessage(message));
    },
    error(message) {
      entries.push(parseWebhookLogMessage(message));
    },
  };
}

function parseWebhookLogMessage(message) {
  const jsonStartIndex = String(message).indexOf("{");
  return JSON.parse(String(message).slice(jsonStartIndex));
}

function buildPullRequestPayload(overrides = {}) {
  return {
    action: "opened",
    repository: { full_name: "croft-eng/croft" },
    pull_request: {
      number: 77,
      merged: false,
      merged_at: null,
      created_at: "2026-02-13T17:00:00Z",
      updated_at: "2026-02-13T17:00:00Z",
      closed_at: null,
      draft: false,
      title: "Ship it",
      html_url: "https://github.com/croft-eng/croft/pull/77",
      base: { ref: "main" },
      user: { login: "octocat" },
    },
    ...overrides,
  };
}

function buildPullRequestReviewPayload(overrides = {}) {
  return {
    action: "submitted",
    repository: { full_name: "croft-eng/croft" },
    pull_request: {
      number: 77,
      base: { ref: "main" },
    },
    review: {
      state: "approved",
      submitted_at: "2026-02-13T18:00:00Z",
    },
    ...overrides,
  };
}

function buildPullRequestReactionPayload(overrides = {}) {
  return {
    action: "created",
    repository: { full_name: "croft-eng/croft" },
    issue: {
      number: 77,
      pull_request: {
        url: "https://api.github.com/repos/croft-eng/croft/pulls/77",
      },
    },
    reaction: {
      content: "+1",
      user: { login: "codex" },
    },
    sender: { login: "codex" },
    ...overrides,
  };
}

function listenOnEphemeralPort(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

function postWebhookRequest({ body, headers, path, port }) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        method: "POST",
        port,
        path,
        headers: {
          "content-length": body.length,
          ...headers,
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const responseBodyText = Buffer.concat(chunks).toString("utf8");
          resolve({
            statusCode: response.statusCode,
            body: JSON.parse(responseBodyText),
          });
        });
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

test("verifyGithubSignature validates a correct sha256 signature", () => {
  const secret = "test-secret";
  const payloadBuffer = Buffer.from('{"ok":true}', "utf8");
  const signatureHeader = signPayload(secret, payloadBuffer);

  const valid = verifyGithubSignature({ payloadBuffer, signatureHeader, secret });
  assert.equal(valid, true);
});

test("verifyGithubSignature returns false when payload body is missing", () => {
  const valid = verifyGithubSignature({
    payloadBuffer: undefined,
    signatureHeader: "sha256=abc123",
    secret: "test-secret",
  });

  assert.equal(valid, false);
});

test("registerGithubWebhook registers configured webhook path", () => {
  const registeredPaths = [];
  const app = {
    post(path, _rawMiddleware, _handler) {
      registeredPaths.push(path);
    },
  };

  registerGithubWebhook(app, {
    pool: {},
    github: {
      mainBranch: "main",
      repositoryFullName: "croft-eng/croft",
      webhookSecret: "secret",
    },
    paths: ["/codehost/webhook"],
  });

  assert.deepEqual(registeredPaths, ["/codehost/webhook"]);
});

test("registered github route reads form-encoded webhook bodies as raw bytes", async (t) => {
  const secret = "secret";
  const app = express();
  registerGithubWebhook(app, {
    pool: {},
    github: {
      mainBranch: "main",
      repositoryFullName: "croft-eng/croft",
      webhookSecret: secret,
    },
    paths: ["/codehost/webhook"],
  });
  const server = await listenOnEphemeralPort(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const payload = {
    zen: "Keep it logically awesome.",
    repository: { full_name: "croft-eng/croft" },
  };
  const body = Buffer.from(`payload=${encodeURIComponent(JSON.stringify(payload))}`, "utf8");
  const response = await postWebhookRequest({
    body,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-github-delivery": "delivery-form-route-123",
      "x-github-event": "ping",
      "x-hub-signature-256": signPayload(secret, body),
    },
    path: "/codehost/webhook",
    port: server.address().port,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ignored, true);
});

test("github webhook returns 401 on invalid signature", async () => {
  const handler = createGithubWebhookHandler({
    pool: {},
    config: {
      githubMainBranch: "main",
      githubRepo: "croft-eng/croft",
      githubWebhookSecret: "correct-secret",
    },
  });
  const payload = { action: "closed" };
  const { req, res } = buildReqRes({
    payload,
    signature: "sha256=not-valid",
  });

  await handler(req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.ok, false);
});

test("github webhook returns 401 when request body is missing", async () => {
  const handler = createGithubWebhookHandler({
    pool: {},
    config: {
      githubMainBranch: "main",
      githubRepo: "croft-eng/croft",
      githubWebhookSecret: "correct-secret",
    },
  });
  const req = {
    body: undefined,
    get(name) {
      if (String(name).toLowerCase() === "x-github-event") {
        return "pull_request";
      }
      if (String(name).toLowerCase() === "x-hub-signature-256") {
        return "sha256=not-valid";
      }
      return undefined;
    },
  };
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payloadBody) {
      this.body = payloadBody;
      return this;
    },
  };

  await handler(req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, "invalid signature");
});

test("github webhook returns 400 on invalid json payload", async () => {
  const secret = "secret";
  const handler = createGithubWebhookHandler({
    pool: {},
    config: {
      githubMainBranch: "main",
      githubRepo: "croft-eng/croft",
      githubWebhookSecret: secret,
    },
  });
  const rawBody = Buffer.from("{", "utf8");
  const req = {
    body: rawBody,
    get(name) {
      const key = name.toLowerCase();
      if (key === "x-github-event") {
        return "pull_request";
      }
      if (key === "x-hub-signature-256") {
        return signPayload(secret, rawBody);
      }
      return undefined;
    },
  };
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payloadBody) {
      this.body = payloadBody;
      return this;
    },
  };

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "invalid json payload");
});

test("github webhook accepts form-encoded payload bodies after signature verification", async () => {
  const secret = "secret";
  const logger = createCapturingLogger();
  const handler = createGithubWebhookHandler({
    pool: {},
    config: {
      githubMainBranch: "main",
      githubRepo: "croft-eng/croft",
      githubWebhookSecret: secret,
    },
    logger,
  });
  const payload = {
    zen: "Approachable is better than simple.",
    hook_id: 12345,
    repository: { full_name: "croft-eng/croft" },
  };
  const rawBody = Buffer.from(
    `payload=${encodeURIComponent(JSON.stringify(payload))}`,
    "utf8",
  );
  const req = {
    body: rawBody,
    get(name) {
      const key = name.toLowerCase();
      if (key === "x-github-delivery") {
        return "delivery-form-123";
      }
      if (key === "x-github-event") {
        return "ping";
      }
      if (key === "x-hub-signature-256") {
        return signPayload(secret, rawBody);
      }
      if (key === "content-type") {
        return "application/x-www-form-urlencoded";
      }
      return undefined;
    },
  };
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payloadBody) {
      this.body = payloadBody;
      return this;
    },
  };

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ignored, true);
  assert.equal(logger.entries[0].outcome, "ignored_unsupported_event");
  assert.equal(logger.entries[0].delivery_id, "delivery-form-123");
  assert.equal(logger.entries[0].event, "ping");
});

test("github webhook ignores unsupported event types", async () => {
  const secret = "secret";
  let upsertCalled = false;
  const logger = createCapturingLogger();
  const handler = createGithubWebhookHandler({
    pool: {},
    config: {
      githubMainBranch: "main",
      githubRepo: "croft-eng/croft",
      githubWebhookSecret: secret,
    },
    logger,
    upsertPullRequestAsUntestedFn: async () => {
      upsertCalled = true;
    },
  });
  const payload = { action: "closed" };
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const { req, res } = buildReqRes({
    payload,
    event: "push",
    signature: signPayload(secret, body),
  });

  req.body = body;
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ignored, true);
  assert.equal(upsertCalled, false);
  assert.equal(logger.entries[0].provider, "GitHub");
  assert.equal(logger.entries[0].outcome, "ignored_unsupported_event");
  assert.equal(logger.entries[0].delivery_id, "delivery-123");
  assert.equal(logger.entries[0].event, "push");
  assert.equal(logger.entries[0].action, "closed");
  assert.equal(logger.entries[0].expected_repo, "croft-eng/croft");
  assert.equal(logger.entries[0].expected_base_branch, "main");
});

test("github webhook ignores pull request events outside tracked branch/repo", async () => {
  const secret = "secret";
  let upsertCalled = false;
  const logger = createCapturingLogger();
  const handler = createGithubWebhookHandler({
    pool: {},
    config: {
      githubMainBranch: "main",
      githubRepo: "croft-eng/croft",
      githubWebhookSecret: secret,
    },
    logger,
    upsertPullRequestAsUntestedFn: async () => {
      upsertCalled = true;
    },
  });
  const payload = buildPullRequestPayload({
    repository: { full_name: "other/repo" },
  });
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const { req, res } = buildReqRes({
    payload,
    signature: signPayload(secret, body),
  });

  req.body = body;
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ignored, true);
  assert.equal(upsertCalled, false);
  assert.equal(logger.entries[0].outcome, "ignored_untracked_repo_or_branch");
  assert.equal(logger.entries[0].repo, "other/repo");
  assert.equal(logger.entries[0].expected_repo, "croft-eng/croft");
  assert.equal(logger.entries[0].repo_matches, false);
  assert.equal(logger.entries[0].base_branch_matches, true);
});

test("github webhook tracks opened pull request review lifecycle", async () => {
  let savedReviewState;
  const handler = createGithubWebhookHandler({
    pool: {},
    config: {
      githubMainBranch: "main",
      githubRepo: "croft-eng/croft",
      githubWebhookSecret: "secret",
    },
    upsertOpenPullRequestReviewStateFn: async (_pool, state) => {
      savedReviewState = state;
      return { pr_number: state.prNumber, review_state: state.reviewState };
    },
  });
  const payload = buildPullRequestPayload();
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const { req, res } = buildReqRes({
    payload,
    signature: signPayload("secret", body),
  });

  req.body = body;
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(savedReviewState.repo, "croft-eng/croft");
  assert.equal(savedReviewState.prNumber, 77);
  assert.equal(savedReviewState.reviewState, "waiting");
  assert.equal(savedReviewState.lifecycleState, "open");
  assert.equal(savedReviewState.openedForReviewAt, "2026-02-13T17:00:00Z");
  assert.equal(savedReviewState.lastModifiedAt, "2026-02-13T17:00:00Z");
  assert.equal(res.body.review_tracking_updated, true);
});

test("github webhook tracks ready_for_review transitions", async () => {
  let savedReviewState;
  const handler = createGithubWebhookHandler({
    pool: {},
    config: {
      githubMainBranch: "main",
      githubRepo: "croft-eng/croft",
      githubWebhookSecret: "secret",
    },
    upsertOpenPullRequestReviewStateFn: async (_pool, state) => {
      savedReviewState = state;
      return { pr_number: state.prNumber, review_state: state.reviewState };
    },
  });
  const payload = buildPullRequestPayload({
    action: "ready_for_review",
    pull_request: {
      ...buildPullRequestPayload().pull_request,
      draft: false,
      updated_at: "2026-02-14T11:00:00Z",
    },
  });
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const { req, res } = buildReqRes({ payload, signature: signPayload("secret", body) });

  req.body = body;
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(savedReviewState.isDraft, false);
  assert.equal(savedReviewState.reviewState, "waiting");
  assert.equal(savedReviewState.openedForReviewAt, "2026-02-14T11:00:00Z");
  assert.equal(savedReviewState.lastModifiedAt, "2026-02-14T11:00:00Z");
});

test("github webhook upserts merged main PR as untested while updating review state", async () => {
  let savedPullRequest;
  let savedReviewState;
  const logger = createCapturingLogger();
  const handler = createGithubWebhookHandler({
    pool: { marker: "pool" },
    config: {
      githubMainBranch: "main",
      githubRepo: "croft-eng/croft",
      githubWebhookSecret: "secret",
    },
    logger,
    upsertOpenPullRequestReviewStateFn: async (_pool, state) => {
      savedReviewState = state;
      return { pr_number: state.prNumber, review_state: state.reviewState };
    },
    upsertPullRequestAsUntestedFn: async (_pool, pr) => {
      savedPullRequest = pr;
      return { pr_number: pr.prNumber, status: "untested" };
    },
  });
  const payload = buildPullRequestPayload({
    action: "closed",
    pull_request: {
      ...buildPullRequestPayload().pull_request,
      merged: true,
      merged_at: "2026-02-13T17:00:00Z",
      closed_at: "2026-02-13T17:10:00Z",
    },
  });
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const { req, res } = buildReqRes({
    payload,
    signature: signPayload("secret", body),
  });

  req.body = body;
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(savedPullRequest.repo, "croft-eng/croft");
  assert.equal(savedPullRequest.prNumber, 77);
  assert.equal(savedPullRequest.mergedAt, "2026-02-13T17:00:00Z");
  assert.equal(savedReviewState.lifecycleState, "merged");
  assert.equal(logger.entries[0].outcome, "processed");
  assert.equal(logger.entries[0].event, "pull_request");
  assert.equal(logger.entries[0].action, "closed");
  assert.equal(logger.entries[0].repo_matches, true);
  assert.equal(logger.entries[0].base_branch_matches, true);
  assert.equal(logger.entries[0].merged, true);
  assert.equal(logger.entries[0].pr_number, 77);
  assert.equal(logger.entries[0].status, "untested");
});

test("github webhook updates review state on submitted approval", async () => {
  let updatedReview;
  const handler = createGithubWebhookHandler({
    pool: {},
    config: {
      githubMainBranch: "main",
      githubRepo: "croft-eng/croft",
      githubWebhookSecret: "secret",
    },
    updatePullRequestReviewSubmissionFn: async (_pool, reviewUpdate) => {
      updatedReview = reviewUpdate;
      return { pr_number: reviewUpdate.prNumber, review_state: reviewUpdate.reviewState };
    },
  });
  const payload = buildPullRequestReviewPayload();
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const { req, res } = buildReqRes({
    payload,
    event: "pull_request_review",
    signature: signPayload("secret", body),
  });

  req.body = body;
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(updatedReview.repo, "croft-eng/croft");
  assert.equal(updatedReview.prNumber, 77);
  assert.equal(updatedReview.reviewState, "approved");
  assert.equal(res.body.review_tracking_updated, true);
});

test("github webhook tracks commented review submission without forcing approval", async () => {
  let updatedReview;
  const handler = createGithubWebhookHandler({
    pool: {},
    config: {
      githubMainBranch: "main",
      githubRepo: "croft-eng/croft",
      githubWebhookSecret: "secret",
    },
    updatePullRequestReviewSubmissionFn: async (_pool, reviewUpdate) => {
      updatedReview = reviewUpdate;
      return { pr_number: reviewUpdate.prNumber, review_state: "waiting" };
    },
  });
  const payload = buildPullRequestReviewPayload({
    review: {
      state: "commented",
      submitted_at: "2026-02-13T18:30:00Z",
    },
  });
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const { req, res } = buildReqRes({
    payload,
    event: "pull_request_review",
    signature: signPayload("secret", body),
  });

  req.body = body;
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(updatedReview.reviewState, null);
  assert.equal(updatedReview.lastReviewedAt, "2026-02-13T18:30:00Z");
  assert.equal(res.body.review_tracking_updated, true);
});

test("github webhook ignores review events outside tracked branch/repo", async () => {
  const secret = "secret";
  let updateCalled = false;
  const handler = createGithubWebhookHandler({
    pool: {},
    config: {
      githubMainBranch: "main",
      githubRepo: "croft-eng/croft",
      githubWebhookSecret: secret,
    },
    updatePullRequestReviewSubmissionFn: async () => {
      updateCalled = true;
    },
  });
  const payload = buildPullRequestReviewPayload({
    repository: { full_name: "other/repo" },
  });
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const { req, res } = buildReqRes({
    payload,
    event: "pull_request_review",
    signature: signPayload(secret, body),
  });

  req.body = body;
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ignored, true);
  assert.equal(updateCalled, false);
});

test("github webhook tracks codex thumbs-up reactions on pull request descriptions", async () => {
  let approvalUpdate;
  const handler = createGithubWebhookHandler({
    pool: {},
    config: {
      githubMainBranch: "main",
      githubRepo: "croft-eng/croft",
      githubWebhookSecret: "secret",
      codeHostCodexUserLogins: ["codex"],
    },
    updatePullRequestCodexApprovalFn: async (_pool, update) => {
      approvalUpdate = update;
      return { repo: update.repo, pr_number: update.prNumber, codex_approved: update.codexApproved };
    },
  });
  const payload = buildPullRequestReactionPayload();
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const { req, res } = buildReqRes({
    payload,
    event: "reaction",
    signature: signPayload("secret", body),
  });

  req.body = body;
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(approvalUpdate, {
    repo: "croft-eng/croft",
    prNumber: 77,
    codexApproved: true,
  });
  assert.equal(res.body.review_tracking_updated, true);
  assert.equal(res.body.codex_approved, true);
});

test("github webhook tracks codex thumbs-up deletion as unapproval", async () => {
  let approvalUpdate;
  const handler = createGithubWebhookHandler({
    pool: {},
    config: {
      githubMainBranch: "main",
      githubRepo: "croft-eng/croft",
      githubWebhookSecret: "secret",
      codeHostCodexUserLogins: ["codex"],
    },
    updatePullRequestCodexApprovalFn: async (_pool, update) => {
      approvalUpdate = update;
      return { repo: update.repo, pr_number: update.prNumber, codex_approved: update.codexApproved };
    },
  });
  const payload = buildPullRequestReactionPayload({ action: "deleted" });
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const { req, res } = buildReqRes({
    payload,
    event: "reaction",
    signature: signPayload("secret", body),
  });

  req.body = body;
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(approvalUpdate, {
    repo: "croft-eng/croft",
    prNumber: 77,
    codexApproved: false,
  });
  assert.equal(res.body.review_tracking_updated, true);
  assert.equal(res.body.codex_approved, false);
});

test("github webhook ignores non-codex reactions", async () => {
  let updateCalled = false;
  const handler = createGithubWebhookHandler({
    pool: {},
    config: {
      githubMainBranch: "main",
      githubRepo: "croft-eng/croft",
      githubWebhookSecret: "secret",
      codeHostCodexUserLogins: ["codex"],
    },
    updatePullRequestCodexApprovalFn: async () => {
      updateCalled = true;
    },
  });
  const payload = buildPullRequestReactionPayload({
    sender: { login: "octocat" },
    reaction: {
      content: "+1",
      user: { login: "octocat" },
    },
  });
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const { req, res } = buildReqRes({
    payload,
    event: "reaction",
    signature: signPayload("secret", body),
  });

  req.body = body;
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ignored, true);
  assert.equal(updateCalled, false);
});

test("github webhook ignores reactions on pull request comments", async () => {
  let updateCalled = false;
  const handler = createGithubWebhookHandler({
    pool: {},
    config: {
      githubMainBranch: "main",
      githubRepo: "croft-eng/croft",
      githubWebhookSecret: "secret",
      codeHostCodexUserLogins: ["codex"],
    },
    updatePullRequestCodexApprovalFn: async () => {
      updateCalled = true;
    },
  });
  const payload = buildPullRequestReactionPayload({
    comment: {
      id: 12345,
      body: "Looks good",
    },
  });
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const { req, res } = buildReqRes({
    payload,
    event: "reaction",
    signature: signPayload("secret", body),
  });

  req.body = body;
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ignored, true);
  assert.equal(updateCalled, false);
});

test("github webhook returns 500 if persistence fails", async () => {
  const secret = "secret";
  const handler = createGithubWebhookHandler({
    pool: {},
    config: {
      githubMainBranch: "main",
      githubRepo: "croft-eng/croft",
      githubWebhookSecret: secret,
    },
    upsertOpenPullRequestReviewStateFn: async () => {
      throw new Error("db failed");
    },
  });
  const payload = buildPullRequestPayload();
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const { req, res } = buildReqRes({
    payload,
    signature: signPayload(secret, body),
  });

  req.body = body;
  await handler(req, res);

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, "internal error");
});
