const assert = require("node:assert/strict");
const test = require("node:test");

const {
  deriveReviewStateFromReviews,
  runOpenPullRequestSyncTick,
} = require("../../src/background_jobs/scheduler");

test("deriveReviewStateFromReviews resolves final state across review timeline", () => {
  const reviewState = deriveReviewStateFromReviews([
    { state: "APPROVED", submitted_at: "2026-02-16T14:00:00.000Z" },
    { state: "COMMENTED", submitted_at: "2026-02-16T14:10:00.000Z" },
    { state: "DISMISSED", submitted_at: "2026-02-16T14:20:00.000Z" },
    { state: "CHANGES_REQUESTED", submitted_at: "2026-02-16T14:30:00.000Z" },
  ]);

  assert.equal(reviewState, "changes_requested");
});

test("runOpenPullRequestSyncTick upserts open PRs and closes stale rows", async () => {
  const calls = {
    closed: [],
    mergedUpserted: [],
    open: [],
    upserted: [],
  };

  const result = await runOpenPullRequestSyncTick({
    codeHostClient: {
      async listOpenPullRequests() {
        return [
          {
            number: 71,
            title: "Improve metrics",
            html_url: "https://github.com/croft-eng/croft/pull/71",
            user: { login: "octocat" },
            base: { ref: "main" },
            draft: false,
            created_at: "2026-02-10T14:00:00.000Z",
            updated_at: "2026-02-15T14:00:00.000Z",
          },
          {
            number: 72,
            title: "WIP",
            html_url: "https://github.com/croft-eng/croft/pull/72",
            user: { login: "octocat" },
            base: { ref: "main" },
            draft: true,
            created_at: "2026-02-11T14:00:00.000Z",
          },
        ];
      },
      async listPullRequestReviews({ prNumber }) {
        if (prNumber === 71) {
          return [{ state: "APPROVED", submitted_at: "2026-02-11T15:00:00.000Z" }];
        }
        return [];
      },
      async isPullRequestCodexApproved({ prNumber }) {
        return prNumber === 71;
      },
      async listClosedPullRequests() {
        return [];
      },
    },
    getLastProdDeployAtFn: async () => "1970-01-01T00:00:00.000Z",
    logger: {
      info() {},
      error() {},
    },
    mainBranch: "main",
    markStaleOpenPullRequestsClosedFn: async (_pool, payload) => {
      calls.closed.push(payload);
      return 1;
    },
    nowFn: () => new Date("2026-02-16T14:05:00.000Z"),
    pool: {},
    repository: "croft-eng/croft",
    upsertPullRequestAsUntestedFromSyncFn: async (_pool, record) => {
      calls.mergedUpserted.push(record);
      return record;
    },
    upsertOpenPullRequestReviewStateFn: async (_pool, record) => {
      calls.upserted.push(record);
      calls.open.push(record.prNumber);
      return record;
    },
  });

  assert.equal(calls.upserted.length, 2);
  assert.equal(calls.upserted[0].reviewState, "approved");
  assert.equal(calls.upserted[0].codexApproved, true);
  assert.equal(calls.upserted[0].lastModifiedAt, "2026-02-15T14:00:00.000Z");
  assert.equal(calls.upserted[1].reviewState, "waiting");
  assert.equal(calls.upserted[1].codexApproved, false);
  assert.equal(calls.upserted[1].openedForReviewAt, null);
  assert.deepEqual(calls.open, [71, 72]);
  assert.equal(calls.closed.length, 1);
  assert.deepEqual(calls.closed[0], {
    repo: "croft-eng/croft",
    baseBranch: "main",
    openPrNumbers: [71, 72],
    closedAt: "2026-02-16T14:05:00.000Z",
  });
  assert.equal(calls.mergedUpserted.length, 0);
  assert.equal(result.mergedUntestedCount, 0);
});

test("runOpenPullRequestSyncTick ignores open PRs not on tracked branch", async () => {
  const calls = {
    closed: [],
    upserted: [],
  };

  await runOpenPullRequestSyncTick({
    codeHostClient: {
      async listOpenPullRequests() {
        return [
          {
            number: 99,
            title: "Wrong branch",
            html_url: "https://github.com/croft-eng/croft/pull/99",
            user: { login: "octocat" },
            base: { ref: "develop" },
            draft: false,
            created_at: "2026-02-10T14:00:00.000Z",
          },
        ];
      },
      async listPullRequestReviews() {
        return [];
      },
      async listClosedPullRequests() {
        return [];
      },
    },
    getLastProdDeployAtFn: async () => "1970-01-01T00:00:00.000Z",
    logger: {
      info() {},
      error() {},
    },
    mainBranch: "main",
    markStaleOpenPullRequestsClosedFn: async (_pool, payload) => {
      calls.closed.push(payload);
      return 0;
    },
    nowFn: () => new Date("2026-02-16T14:05:00.000Z"),
    pool: {},
    repository: "croft-eng/croft",
    upsertPullRequestAsUntestedFromSyncFn: async () => null,
    upsertOpenPullRequestReviewStateFn: async (_pool, record) => {
      calls.upserted.push(record);
      return record;
    },
  });

  assert.equal(calls.upserted.length, 0);
  assert.equal(calls.closed.length, 1);
  assert.deepEqual(calls.closed[0].openPrNumbers, []);
});

test("runOpenPullRequestSyncTick defaults codex approval to false when reaction lookup fails", async () => {
  const calls = {
    upserted: [],
  };

  await runOpenPullRequestSyncTick({
    codeHostClient: {
      async listOpenPullRequests() {
        return [
          {
            number: 71,
            title: "Improve metrics",
            html_url: "https://github.com/croft-eng/croft/pull/71",
            user: { login: "octocat" },
            base: { ref: "main" },
            draft: false,
            created_at: "2026-02-10T14:00:00.000Z",
          },
        ];
      },
      async listPullRequestReviews() {
        return [];
      },
      async isPullRequestCodexApproved() {
        throw new Error("forbidden");
      },
      async listClosedPullRequests() {
        return [];
      },
    },
    getLastProdDeployAtFn: async () => "1970-01-01T00:00:00.000Z",
    logger: {
      info() {},
      error() {},
    },
    mainBranch: "main",
    markStaleOpenPullRequestsClosedFn: async () => 0,
    nowFn: () => new Date("2026-02-16T14:05:00.000Z"),
    pool: {},
    repository: "croft-eng/croft",
    upsertPullRequestAsUntestedFromSyncFn: async () => null,
    upsertOpenPullRequestReviewStateFn: async (_pool, record) => {
      calls.upserted.push(record);
      return record;
    },
  });

  assert.equal(calls.upserted.length, 1);
  assert.equal(calls.upserted[0].codexApproved, false);
});

test("runOpenPullRequestSyncTick uses default now when nowFn is not provided", async () => {
  const calls = {
    closedPayload: null,
  };

  const result = await runOpenPullRequestSyncTick({
    codeHostClient: {
      async listOpenPullRequests() {
        return [];
      },
      async listPullRequestReviews() {
        return [];
      },
      async listClosedPullRequests() {
        return [];
      },
    },
    getLastProdDeployAtFn: async () => "1970-01-01T00:00:00.000Z",
    logger: {
      info() {},
      error() {},
    },
    mainBranch: "main",
    markStaleOpenPullRequestsClosedFn: async (_pool, payload) => {
      calls.closedPayload = payload;
      return 0;
    },
    pool: {},
    repository: "croft-eng/croft",
    upsertPullRequestAsUntestedFromSyncFn: async () => null,
    upsertOpenPullRequestReviewStateFn: async () => null,
  });

  assert.equal(result.upsertedCount, 0);
  assert.equal(result.closedCount, 0);
  assert.equal(Array.isArray(calls.closedPayload.openPrNumbers), true);
  assert.equal(Number.isNaN(Date.parse(calls.closedPayload.closedAt)), false);
});

test("runOpenPullRequestSyncTick upserts merged pull requests newer than last prod deploy", async () => {
  const calls = {
    mergedUpserted: [],
  };

  const result = await runOpenPullRequestSyncTick({
    codeHostClient: {
      async listOpenPullRequests() {
        return [];
      },
      async listPullRequestReviews() {
        return [];
      },
      async listClosedPullRequests() {
        return [
          {
            number: 10,
            title: "Old merge",
            html_url: "https://github.com/croft-eng/croft/pull/10",
            base: { ref: "main" },
            merged_at: "2026-02-10T14:00:00.000Z",
          },
          {
            number: 11,
            title: "New merge",
            html_url: "https://github.com/croft-eng/croft/pull/11",
            base: { ref: "main" },
            merged_at: "2026-02-16T14:00:00.000Z",
          },
          {
            number: 12,
            title: "Closed unmerged",
            html_url: "https://github.com/croft-eng/croft/pull/12",
            base: { ref: "main" },
            merged_at: null,
          },
        ];
      },
    },
    getLastProdDeployAtFn: async () => "2026-02-13T00:00:00.000Z",
    logger: {
      info() {},
      error() {},
    },
    mainBranch: "main",
    markStaleOpenPullRequestsClosedFn: async () => 0,
    nowFn: () => new Date("2026-02-16T14:05:00.000Z"),
    pool: {},
    repository: "croft-eng/croft",
    upsertPullRequestAsUntestedFromSyncFn: async (_pool, record) => {
      calls.mergedUpserted.push(record);
      return record;
    },
    upsertOpenPullRequestReviewStateFn: async () => null,
  });

  assert.equal(calls.mergedUpserted.length, 1);
  assert.equal(calls.mergedUpserted[0].prNumber, 11);
  assert.equal(result.mergedUntestedCount, 1);
});
