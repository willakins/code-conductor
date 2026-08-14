const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const { registerCalypsoCommand } = require("../../src/commands/command_router");
const { createGithubWebhookHandler } = require("../../src/platform/code_host/providers/github/webhook");
const { runReviewRecapSchedulerTick } = require("../../src/background_jobs/review_recap_scheduler");
const { formatReviewRecapResponse } = require("../../src/util/format");

const WEBHOOK_SECRET = "secret";

function signPayload(secret, payloadBuffer) {
  return `sha256=${crypto.createHmac("sha256", secret).update(payloadBuffer).digest("hex")}`;
}

function buildReqRes({ payload, signature, event = "pull_request" }) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const headers = {
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

test("high-level review recap flow: webhook tracking + config + scheduled post", async () => {
  const state = {
    openPullRequests: [],
    runtimeUserConfig: {
      timeZone: "America/New_York",
    },
    reviewRecapConfig: {
      targetChannelId: null,
      reviewScope: "all",
      recencyValue: 1,
      recencyUnit: "w",
      scheduleWeekday: "mon",
      scheduleTime: "09:00",
      timeZone: "America/New_York",
      lastSentSlotAt: null,
    },
  };

  const webhookHandler = createGithubWebhookHandler({
    pool: {},
    config: {
      githubMainBranch: "main",
      githubRepo: "croft-eng/croft",
      githubWebhookSecret: WEBHOOK_SECRET,
    },
    upsertOpenPullRequestReviewStateFn: async (_pool, pullRequestState) => {
      const existingIndex = state.openPullRequests.findIndex(
        (candidate) =>
          candidate.repo === pullRequestState.repo && candidate.pr_number === pullRequestState.prNumber,
      );
      const row = {
        repo: pullRequestState.repo,
        pr_number: pullRequestState.prNumber,
        title: pullRequestState.title,
        url: pullRequestState.url,
        author_login: pullRequestState.authorLogin,
        is_draft: pullRequestState.isDraft,
        lifecycle_state: pullRequestState.lifecycleState,
        review_state: pullRequestState.reviewState,
        opened_for_review_at: pullRequestState.openedForReviewAt,
      };
      if (existingIndex >= 0) {
        state.openPullRequests[existingIndex] = row;
      } else {
        state.openPullRequests.push(row);
      }

      return {
        pr_number: row.pr_number,
        review_state: row.review_state,
      };
    },
    upsertPullRequestAsUntestedFn: async (_pool, pullRequest) => ({
      pr_number: pullRequest.prNumber,
      status: "untested",
    }),
    updatePullRequestReviewSubmissionFn: async (_pool, reviewUpdate) => {
      const existingPullRequest = state.openPullRequests.find(
        (candidate) =>
          candidate.repo === reviewUpdate.repo && candidate.pr_number === reviewUpdate.prNumber,
      );
      if (!existingPullRequest) {
        return null;
      }
      existingPullRequest.review_state = reviewUpdate.reviewState || existingPullRequest.review_state;
      return {
        pr_number: existingPullRequest.pr_number,
        review_state: existingPullRequest.review_state,
      };
    },
  });

  const openedPayload = {
    action: "opened",
    repository: { full_name: "croft-eng/croft" },
    pull_request: {
      number: 71,
      merged: false,
      merged_at: null,
      created_at: "2026-02-16T19:00:00.000Z",
      updated_at: "2026-02-16T19:00:00.000Z",
      draft: false,
      title: "Improve metrics",
      html_url: "https://github.com/croft-eng/croft/pull/71",
      base: { ref: "main" },
      user: { login: "octocat" },
    },
  };
  const openedBody = Buffer.from(JSON.stringify(openedPayload), "utf8");
  const { req, res } = buildReqRes({
    payload: openedPayload,
    signature: signPayload(WEBHOOK_SECRET, openedBody),
  });

  req.body = openedBody;
  await webhookHandler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(state.openPullRequests.length, 1);
  assert.equal(state.openPullRequests[0].review_state, "waiting");

  let commandHandler;
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    isValidTimeZoneFn: () => true,
    setReviewRecapChannelFn: async (_pool, targetChannelId) => {
      state.reviewRecapConfig.targetChannelId = targetChannelId;
      return { target_channel_id: targetChannelId };
    },
    setReviewRecapRecencyFn: async (_pool, recencyValue, recencyUnit) => {
      state.reviewRecapConfig.recencyValue = recencyValue;
      state.reviewRecapConfig.recencyUnit = recencyUnit;
      state.reviewRecapConfig.reviewScope = "legacy";
      return { recency_value: recencyValue, recency_unit: recencyUnit };
    },
    setReviewRecapScopeFn: async (_pool, reviewScope) => {
      state.reviewRecapConfig.reviewScope = reviewScope;
      return { review_scope: reviewScope };
    },
    setReviewRecapScheduleFn: async (_pool, scheduleWeekday, scheduleTime) => {
      state.reviewRecapConfig.scheduleWeekday = scheduleWeekday;
      state.reviewRecapConfig.scheduleTime = scheduleTime;
      return { schedule_weekday: scheduleWeekday, schedule_time: scheduleTime };
    },
    setConfiguredTimeZoneFn: async (_pool, timeZone) => {
      state.runtimeUserConfig.timeZone = timeZone;
      return { timezone: timeZone };
    },
    setReviewRecapTimeZoneFn: async (_pool, timeZone) => {
      state.reviewRecapConfig.timeZone = timeZone;
      return { timezone: timeZone };
    },
  });

  await runSlashCommand(commandHandler, "config review-recap-channel:<#CRECAP|deployments>");
  await runSlashCommand(commandHandler, "config review-recap-window:last-week");
  await runSlashCommand(commandHandler, "config review-recap-schedule:tue@10:15");
  await runSlashCommand(commandHandler, "config timezone:America/Los_Angeles");

  assert.equal(state.reviewRecapConfig.targetChannelId, "CRECAP");
  assert.equal(state.reviewRecapConfig.reviewScope, "week");
  assert.equal(state.reviewRecapConfig.scheduleWeekday, "tue");
  assert.equal(state.reviewRecapConfig.scheduleTime, "10:15");
  assert.equal(state.reviewRecapConfig.timeZone, "America/Los_Angeles");

  const schedulerCalls = {
    postedMessages: [],
    markSlots: [],
    sinceTimestamps: [],
  };
  const schedulerNow = new Date("2026-02-17T18:16:00.000Z");

  await runReviewRecapSchedulerTick({
    getReviewRecapConfigFn: async () => state.reviewRecapConfig,
    listOpenPullRequestsForReviewRecapSinceFn: async (_pool, sinceTimestamp) => {
      schedulerCalls.sinceTimestamps.push(sinceTimestamp);
      return state.openPullRequests.filter((pullRequest) => {
        const openedForReviewAt = new Date(pullRequest.opened_for_review_at);
        return (
          pullRequest.lifecycle_state === "open" &&
          pullRequest.is_draft === false &&
          openedForReviewAt >= sinceTimestamp
        );
      });
    },
    markReviewRecapSentFn: async (_pool, scheduledSlotAt) => {
      schedulerCalls.markSlots.push(scheduledSlotAt);
      state.reviewRecapConfig.lastSentSlotAt = scheduledSlotAt;
      return { id: 1, last_sent_slot_at: scheduledSlotAt };
    },
    formatReviewRecapResponseFn: formatReviewRecapResponse,
    nowFn: () => schedulerNow,
    logger: {
      info() {},
      warn() {},
      error() {},
    },
    pool: {},
    schedulerState: {
      lastNoChannelLogMinuteKey: null,
    },
    slackClient: {
      chat: {
        async postMessage(message) {
          schedulerCalls.postedMessages.push(message);
        },
      },
    },
  });

  assert.equal(schedulerCalls.postedMessages.length, 1);
  assert.equal(schedulerCalls.postedMessages[0].channel, "CRECAP");
  assert.match(
    schedulerCalls.postedMessages[0].text,
    /^\*PR Review Recap — last week\*/,
  );
  assert.match(schedulerCalls.postedMessages[0].text, /modified \d{1,2}\/\d{1,2}\/\d{4}/);
  assert.match(
    JSON.stringify(schedulerCalls.postedMessages[0].attachments),
    /PR review recap/,
  );
  assert.deepEqual(schedulerCalls.markSlots, ["2026-02-17T18:15:00.000Z"]);
  assert.equal(schedulerCalls.sinceTimestamps.length, 1);

  const expectedSince = new Date("2026-02-10T18:16:00.000Z").getTime();
  assert.equal(schedulerCalls.sinceTimestamps[0].getTime(), expectedSince);
});

async function runSlashCommand(commandHandler, text) {
  let response;

  await commandHandler({
    command: {
      text,
      user_id: "UADMIN",
    },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      response = message;
    },
  });

  return response;
}
