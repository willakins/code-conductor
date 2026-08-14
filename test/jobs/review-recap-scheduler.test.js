const assert = require("node:assert/strict");
const test = require("node:test");

const {
  findMostRecentScheduledSlot,
  runReviewRecapSchedulerTick,
} = require("../../src/background_jobs/review_recap_scheduler");

test("findMostRecentScheduledSlot resolves monday 9am America/New_York slot", () => {
  const slot = findMostRecentScheduledSlot({
    now: new Date("2026-02-16T14:05:00.000Z"),
    scheduleWeekday: "mon",
    scheduleTime: "09:00",
    timeZone: "America/New_York",
    lookbackMinutes: 60,
  });

  assert.ok(slot);
  assert.equal(slot.toISOString(), "2026-02-16T14:00:00.000Z");
});

test("findMostRecentScheduledSlot resolves daily 9am America/New_York slot", () => {
  const slot = findMostRecentScheduledSlot({
    now: new Date("2026-02-17T14:05:00.000Z"),
    scheduleWeekday: "daily",
    scheduleTime: "09:00",
    timeZone: "America/New_York",
    lookbackMinutes: 60,
  });

  assert.ok(slot);
  assert.equal(slot.toISOString(), "2026-02-17T14:00:00.000Z");
});

test("findMostRecentScheduledSlot resolves most recent slot from multiple times", () => {
  const slot = findMostRecentScheduledSlot({
    now: new Date("2026-02-17T22:05:00.000Z"),
    scheduleWeekday: "daily",
    scheduleTime: "09:00,17:00",
    timeZone: "America/New_York",
    lookbackMinutes: 60,
  });

  assert.ok(slot);
  assert.equal(slot.toISOString(), "2026-02-17T22:00:00.000Z");
});

test("runReviewRecapSchedulerTick posts and marks slot when due", async () => {
  const calls = {
    list: [],
    mark: [],
    post: [],
  };
  const now = new Date("2026-02-16T14:05:00.000Z");

  await runReviewRecapSchedulerTick({
    getReviewRecapConfigFn: async () => ({
      targetChannelId: "CDEPLOY",
      reviewScope: "week",
      recencyValue: 1,
      recencyUnit: "w",
      scheduleWeekday: "mon",
      scheduleTime: "09:00",
      sendOnWeekends: true,
      sendOnHolidays: true,
      timeZone: "America/New_York",
      lastSentSlotAt: null,
    }),
    listOpenPullRequestsWaitingOnReviewSinceFn: async (_pool, sinceTimestamp) => {
      calls.list.push(sinceTimestamp);
      return [
        {
          repo: "croft-eng/croft",
          pr_number: 71,
          title: "Improve metrics",
          url: "https://github.com/croft-eng/croft/pull/71",
          author_login: "octocat",
          opened_for_review_at: "2026-02-13T22:00:17.000Z",
        },
      ];
    },
    markReviewRecapSentFn: async (_pool, slotTimestamp) => {
      calls.mark.push(slotTimestamp);
      return { id: 1, last_sent_slot_at: slotTimestamp };
    },
    formatReviewRecapResponseFn: ({ pullRequests, now: formatterNow }) => {
      assert.equal(pullRequests.length, 1);
      assert.equal(formatterNow, now);
      return "recap message";
    },
    nowFn: () => now,
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
          calls.post.push(message);
        },
      },
    },
  });

  assert.equal(calls.list.length, 1);
  assert.equal(calls.post.length, 1);
  assert.equal(calls.post[0].channel, "CDEPLOY");
  assert.equal(calls.post[0].text, "recap message");
  assert.equal(calls.post[0].mrkdwn, true);
  assert.equal(calls.post[0].attachments.length, 1);
  assert.match(JSON.stringify(calls.post[0].attachments), /PR review recap/);
  assert.match(JSON.stringify(calls.post[0].attachments), /Unapproved/);
  assert.doesNotMatch(JSON.stringify(calls.post[0].attachments), /#71/);
  assert.match(JSON.stringify(calls.post[0].attachments), /reviews tab:unapproved/);
  assert.deepEqual(calls.mark, ["2026-02-16T14:00:00.000Z"]);
});

test("runReviewRecapSchedulerTick uses epoch lookback for all-scope recap", async () => {
  let capturedSinceTimestamp = null;
  let capturedBackburnerBeforeTimestamp = null;

  await runReviewRecapSchedulerTick({
    getReviewRecapConfigFn: async () => ({
      targetChannelId: "CDEPLOY",
      reviewScope: "all",
      recencyValue: 1,
      recencyUnit: "w",
      scheduleWeekday: "mon",
      scheduleTime: "09:00",
      sendOnWeekends: true,
      sendOnHolidays: true,
      timeZone: "America/New_York",
      lastSentSlotAt: null,
    }),
    listOpenPullRequestsForReviewRecapSinceFn: async (
      _pool,
      sinceTimestamp,
      backburnerBeforeTimestamp,
    ) => {
      capturedSinceTimestamp = sinceTimestamp;
      capturedBackburnerBeforeTimestamp = backburnerBeforeTimestamp;
      return [];
    },
    markReviewRecapSentFn: async () => ({ id: 1 }),
    formatReviewRecapResponseFn: () => "recap message",
    nowFn: () => new Date("2026-02-16T14:05:00.000Z"),
    logger: {
      info() {},
      warn() {},
      error() {},
    },
    messageClient: {
      async postChannelMessage() {},
    },
    pool: {},
    schedulerState: {
      lastNoChannelLogMinuteKey: null,
    },
  });

  assert.ok(capturedSinceTimestamp instanceof Date);
  assert.equal(capturedSinceTimestamp.getTime(), 0);
  assert.equal(
    capturedBackburnerBeforeTimestamp.toISOString(),
    "2026-01-17T14:05:00.000Z",
  );
});

test("runReviewRecapSchedulerTick skips when slot already sent", async () => {
  let postCalled = false;
  let markCalled = false;

  await runReviewRecapSchedulerTick({
    getReviewRecapConfigFn: async () => ({
      targetChannelId: "CDEPLOY",
      recencyValue: 1,
      recencyUnit: "w",
      scheduleWeekday: "mon",
      scheduleTime: "09:00",
      timeZone: "America/New_York",
      lastSentSlotAt: "2026-02-16T14:00:00.000Z",
    }),
    listOpenPullRequestsWaitingOnReviewSinceFn: async () => [],
    markReviewRecapSentFn: async () => {
      markCalled = true;
    },
    formatReviewRecapResponseFn: () => "recap message",
    nowFn: () => new Date("2026-02-16T14:05:00.000Z"),
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
        async postMessage() {
          postCalled = true;
        },
      },
    },
  });

  assert.equal(postCalled, false);
  assert.equal(markCalled, false);
});

test("runReviewRecapSchedulerTick does not backfill immediately after schedule update", async () => {
  const calls = {
    post: 0,
    mark: 0,
  };
  let now = new Date("2026-02-19T13:57:00.000Z");
  const scheduleUpdatedAt = "2026-02-19T13:57:00.000Z";

  const runTick = async () =>
    runReviewRecapSchedulerTick({
      getReviewRecapConfigFn: async () => ({
        targetChannelId: "CDEPLOY",
        recencyValue: 1,
        recencyUnit: "w",
        scheduleWeekday: "daily",
        scheduleTime: "09:00",
        timeZone: "America/New_York",
        lastSentSlotAt: scheduleUpdatedAt,
      }),
      listOpenPullRequestsWaitingOnReviewSinceFn: async () => [],
      markReviewRecapSentFn: async () => {
        calls.mark += 1;
      },
      formatReviewRecapResponseFn: () => "recap message",
      nowFn: () => now,
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      messageClient: {
        async postChannelMessage() {
          calls.post += 1;
        },
      },
      pool: {},
      schedulerState: {
        lastNoChannelLogMinuteKey: null,
      },
    });

  await runTick();
  assert.equal(calls.post, 0);
  assert.equal(calls.mark, 0);

  now = new Date("2026-02-19T14:00:00.000Z");
  await runTick();
  assert.equal(calls.post, 1);
  assert.equal(calls.mark, 1);
});

test("runReviewRecapSchedulerTick skips weekend slots when weekend sending is disabled", async () => {
  const calls = {
    list: 0,
    post: 0,
    mark: [],
  };

  await runReviewRecapSchedulerTick({
    getReviewRecapConfigFn: async () => ({
      targetChannelId: "CDEPLOY",
      recencyValue: 1,
      recencyUnit: "w",
      scheduleWeekday: "daily",
      scheduleTime: "09:00",
      sendOnWeekends: false,
      sendOnHolidays: true,
      timeZone: "America/New_York",
      lastSentSlotAt: null,
    }),
    listOpenPullRequestsWaitingOnReviewSinceFn: async () => {
      calls.list += 1;
      return [];
    },
    markReviewRecapSentFn: async (_pool, slotTimestamp) => {
      calls.mark.push(slotTimestamp);
      return { id: 1, last_sent_slot_at: slotTimestamp };
    },
    formatReviewRecapResponseFn: () => "recap message",
    nowFn: () => new Date("2026-02-14T14:05:00.000Z"),
    logger: {
      info() {},
      warn() {},
      error() {},
    },
    messageClient: {
      async postChannelMessage() {
        calls.post += 1;
      },
    },
    pool: {},
    schedulerState: {
      lastNoChannelLogMinuteKey: null,
    },
  });

  assert.equal(calls.list, 0);
  assert.equal(calls.post, 0);
  assert.deepEqual(calls.mark, ["2026-02-14T14:00:00.000Z"]);
});

test("runReviewRecapSchedulerTick skips US federal holiday slots when holiday sending is disabled", async () => {
  const calls = {
    list: 0,
    post: 0,
    mark: [],
  };

  await runReviewRecapSchedulerTick({
    getReviewRecapConfigFn: async () => ({
      targetChannelId: "CDEPLOY",
      recencyValue: 1,
      recencyUnit: "w",
      scheduleWeekday: "daily",
      scheduleTime: "09:00",
      sendOnWeekends: true,
      sendOnHolidays: false,
      timeZone: "America/New_York",
      lastSentSlotAt: null,
    }),
    listOpenPullRequestsWaitingOnReviewSinceFn: async () => {
      calls.list += 1;
      return [];
    },
    markReviewRecapSentFn: async (_pool, slotTimestamp) => {
      calls.mark.push(slotTimestamp);
      return { id: 1, last_sent_slot_at: slotTimestamp };
    },
    formatReviewRecapResponseFn: () => "recap message",
    nowFn: () => new Date("2026-11-26T14:05:00.000Z"),
    logger: {
      info() {},
      warn() {},
      error() {},
    },
    messageClient: {
      async postChannelMessage() {
        calls.post += 1;
      },
    },
    pool: {},
    schedulerState: {
      lastNoChannelLogMinuteKey: null,
    },
  });

  assert.equal(calls.list, 0);
  assert.equal(calls.post, 0);
  assert.deepEqual(calls.mark, ["2026-11-26T14:00:00.000Z"]);
});

test("runReviewRecapSchedulerTick logs when no channel configured", async () => {
  const infoLogs = [];

  await runReviewRecapSchedulerTick({
    getReviewRecapConfigFn: async () => ({
      targetChannelId: null,
      recencyValue: 1,
      recencyUnit: "w",
      scheduleWeekday: "mon",
      scheduleTime: "09:00",
      timeZone: "America/New_York",
      lastSentSlotAt: null,
    }),
    listOpenPullRequestsWaitingOnReviewSinceFn: async () => [],
    markReviewRecapSentFn: async () => null,
    formatReviewRecapResponseFn: () => "unused",
    nowFn: () => new Date("2026-02-16T14:05:00.000Z"),
    logger: {
      info(message) {
        infoLogs.push(message);
      },
      warn() {},
      error() {},
    },
    pool: {},
    schedulerState: {
      lastNoChannelLogMinuteKey: null,
    },
    slackClient: {
      chat: {
        async postMessage() {},
      },
    },
  });

  assert.equal(infoLogs.length, 1);
  assert.match(infoLogs[0], /no target channel configured/i);
});

test("runReviewRecapSchedulerTick stops retrying after 3 not_in_channel failures for the same slot", async () => {
  const errorLogs = [];
  let listCallCount = 0;
  let postCallCount = 0;
  const schedulerState = {
    lastNoChannelLogMinuteKey: null,
  };

  const runTick = async () =>
    runReviewRecapSchedulerTick({
    getReviewRecapConfigFn: async () => ({
      targetChannelId: "CDEPLOY",
      recencyValue: 1,
      recencyUnit: "w",
      scheduleWeekday: "mon",
      scheduleTime: "09:00",
      sendOnWeekends: true,
      sendOnHolidays: true,
      timeZone: "America/New_York",
      lastSentSlotAt: null,
    }),
      listOpenPullRequestsWaitingOnReviewSinceFn: async () => {
        listCallCount += 1;
        return [];
      },
      markReviewRecapSentFn: async () => {
        throw new Error("should not mark sent on failure");
      },
      formatReviewRecapResponseFn: () => "recap message",
      nowFn: () => new Date("2026-02-16T14:05:00.000Z"),
      logger: {
        info() {},
        warn() {},
        error(message) {
          errorLogs.push(String(message));
        },
      },
      messageClient: {
        async postChannelMessage() {
          postCallCount += 1;
          const error = new Error("An API error occurred: not_in_channel");
          error.data = { error: "not_in_channel" };
          throw error;
        },
      },
      pool: {},
      schedulerState,
    });

  await runTick();
  await runTick();
  await runTick();
  await runTick();

  assert.equal(postCallCount, 3);
  assert.equal(listCallCount, 3);
  assert.equal(
    errorLogs.filter((message) => /bot is not in the configured channel/i.test(message)).length,
    3,
  );
  assert.equal(
    errorLogs.filter((message) => /max retry attempts \(3\)/i.test(message)).length,
    1,
  );
});
