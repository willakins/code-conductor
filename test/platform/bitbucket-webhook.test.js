const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  createBitbucketWebhookHandler,
  registerBitbucketWebhook,
} = require("../../src/platform/code_host/providers/bitbucket/webhook");
const { verifyBitbucketSignature } = require("../../src/platform/code_host/providers/bitbucket/verify_signature");

function signPayload(secret, payloadBuffer) {
  return `sha256=${crypto.createHmac("sha256", secret).update(payloadBuffer).digest("hex")}`;
}

function buildReqRes({ payload, signature, event = "pullrequest:created" }) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const headers = {
    "x-event-key": event,
    "x-hub-signature": signature,
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

function buildPullRequestPayload(overrides = {}) {
  return {
    repository: { full_name: "workspace/repo" },
    pullrequest: {
      id: 77,
      state: "OPEN",
      created_on: "2026-02-13T17:00:00Z",
      updated_on: "2026-02-13T17:00:00Z",
      draft: false,
      title: "Ship it",
      links: {
        html: {
          href: "https://bitbucket.org/workspace/repo/pull-requests/77",
        },
      },
      destination: {
        branch: { name: "main" },
      },
      author: {
        user: {
          nickname: "octocat",
        },
      },
    },
    ...overrides,
  };
}

test("verifyBitbucketSignature validates a correct sha256 signature", () => {
  const secret = "test-secret";
  const payloadBuffer = Buffer.from('{"ok":true}', "utf8");
  const signatureHeader = signPayload(secret, payloadBuffer);

  const valid = verifyBitbucketSignature({ payloadBuffer, signatureHeader, secret });
  assert.equal(valid, true);
});

test("verifyBitbucketSignature returns false when payload body is missing", () => {
  const valid = verifyBitbucketSignature({
    payloadBuffer: undefined,
    signatureHeader: "sha256=abc123",
    secret: "test-secret",
  });

  assert.equal(valid, false);
});

test("registerBitbucketWebhook registers both configured webhook paths", () => {
  const registeredPaths = [];
  const app = {
    post(path, _rawMiddleware, _handler) {
      registeredPaths.push(path);
    },
  };

  registerBitbucketWebhook(app, {
    pool: {},
    bitbucket: {
      mainBranch: "main",
      repositoryFullName: "workspace/repo",
      webhookSecret: "secret",
    },
    paths: ["/bitbucket/webhook", "/codehost/webhook"],
  });

  assert.deepEqual(registeredPaths, ["/bitbucket/webhook", "/codehost/webhook"]);
});

test("bitbucket webhook returns 401 on invalid signature", async () => {
  const handler = createBitbucketWebhookHandler({
    pool: {},
    bitbucket: {
      mainBranch: "main",
      repositoryFullName: "workspace/repo",
      webhookSecret: "correct-secret",
    },
  });
  const payload = buildPullRequestPayload();
  const { req, res } = buildReqRes({
    payload,
    signature: "sha256=not-valid",
  });

  await handler(req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.ok, false);
});

test("bitbucket webhook returns 401 when request body is missing", async () => {
  const handler = createBitbucketWebhookHandler({
    pool: {},
    bitbucket: {
      mainBranch: "main",
      repositoryFullName: "workspace/repo",
      webhookSecret: "correct-secret",
    },
  });
  const req = {
    body: undefined,
    get(name) {
      if (String(name).toLowerCase() === "x-event-key") {
        return "pullrequest:created";
      }
      if (String(name).toLowerCase() === "x-hub-signature") {
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

test("bitbucket webhook tracks created pull request review lifecycle", async () => {
  let savedReviewState;
  const handler = createBitbucketWebhookHandler({
    pool: {},
    bitbucket: {
      mainBranch: "main",
      repositoryFullName: "workspace/repo",
      webhookSecret: "secret",
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
  assert.equal(savedReviewState.repo, "workspace/repo");
  assert.equal(savedReviewState.prNumber, 77);
  assert.equal(savedReviewState.reviewState, "waiting");
  assert.equal(savedReviewState.lifecycleState, "open");
  assert.equal(savedReviewState.lastModifiedAt, "2026-02-13T17:00:00Z");
  assert.equal(res.body.review_tracking_updated, true);
});

test("bitbucket webhook upserts merged PR as untested", async () => {
  let savedPullRequest;
  const handler = createBitbucketWebhookHandler({
    pool: {},
    bitbucket: {
      mainBranch: "main",
      repositoryFullName: "workspace/repo",
      webhookSecret: "secret",
    },
    upsertPullRequestAsUntestedFn: async (_pool, pr) => {
      savedPullRequest = pr;
      return { pr_number: pr.prNumber, status: "untested" };
    },
    upsertOpenPullRequestReviewStateFn: async () => ({ pr_number: 77, review_state: "waiting" }),
  });
  const payload = buildPullRequestPayload({
    pullrequest: {
      ...buildPullRequestPayload().pullrequest,
      state: "MERGED",
      updated_on: "2026-02-13T17:10:00Z",
    },
  });
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const { req, res } = buildReqRes({
    payload,
    event: "pullrequest:fulfilled",
    signature: signPayload("secret", body),
  });

  req.body = body;
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(savedPullRequest.repo, "workspace/repo");
  assert.equal(savedPullRequest.prNumber, 77);
  assert.equal(savedPullRequest.mergedAt, "2026-02-13T17:10:00Z");
  assert.equal(res.body.status, "untested");
});

test("bitbucket webhook updates review state for approval", async () => {
  let updatedReview;
  const handler = createBitbucketWebhookHandler({
    pool: {},
    bitbucket: {
      mainBranch: "main",
      repositoryFullName: "workspace/repo",
      webhookSecret: "secret",
    },
    updatePullRequestReviewSubmissionFn: async (_pool, reviewUpdate) => {
      updatedReview = reviewUpdate;
      return { pr_number: reviewUpdate.prNumber, review_state: reviewUpdate.reviewState };
    },
  });
  const payload = buildPullRequestPayload();
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const { req, res } = buildReqRes({
    payload,
    event: "pullrequest:approved",
    signature: signPayload("secret", body),
  });

  req.body = body;
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(updatedReview.prNumber, 77);
  assert.equal(updatedReview.reviewState, "approved");
  assert.equal(res.body.review_state, "approved");
});

test("bitbucket webhook ignores events outside tracked branch/repo", async () => {
  let updateCalled = false;
  const handler = createBitbucketWebhookHandler({
    pool: {},
    bitbucket: {
      mainBranch: "main",
      repositoryFullName: "workspace/repo",
      webhookSecret: "secret",
    },
    upsertOpenPullRequestReviewStateFn: async () => {
      updateCalled = true;
      return {};
    },
  });
  const payload = buildPullRequestPayload({
    repository: { full_name: "other/repo" },
  });
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const { req, res } = buildReqRes({
    payload,
    signature: signPayload("secret", body),
  });

  req.body = body;
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ignored, true);
  assert.equal(updateCalled, false);
});
