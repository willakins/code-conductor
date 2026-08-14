const assert = require("node:assert/strict");
const test = require("node:test");

const { registerCalypsoCommand } = require("../../src/commands/command_router");
const {
  runEnvironmentStatusSchedulerTick,
} = require("../../src/background_jobs/environment_status_scheduler");
const {
  runSupportEmailSchedulerTick,
} = require("../../src/background_jobs/support_email_scheduler");
const {
  createGmailWebhookHandler,
} = require("../../src/platform/email/providers/gmail/webhook");

test("high-level support email flow: enable -> webhook -> notify -> list -> respond", async () => {
  const state = {
    supportEmailConfig: {
      backfillCompletedAt: null,
      enabled: false,
      lastProcessedHistoryId: null,
      lastSyncAt: null,
      onCallExpiresAt: null,
      onCallUserId: null,
      pendingHistoryId: null,
      targetChannelId: null,
      watchExpirationAt: null,
    },
    supportEmailThreads: [],
  };
  const postedMessages = [];
  let nextId = 1;

  let commandHandler;
  registerCalypsoCommand(
    {
      command(_name, handler) {
        commandHandler = handler;
      },
    },
    {
      clearSupportEmailOnCallFn: async () => ({}),
      listPendingSupportEmailThreadsFn: async () =>
        state.supportEmailThreads.filter((thread) => thread.status === "pending"),
      markSupportEmailThreadRespondedFn: async (_pool, emailId, respondedBy) => {
        const thread = state.supportEmailThreads.find((candidate) => candidate.id === emailId);
        if (!thread) {
          return { found: false };
        }
        if (thread.status === "responded") {
          return { found: true, alreadyResponded: true, emailThread: thread };
        }

        thread.status = "responded";
        thread.responded_by = respondedBy;
        return { found: true, alreadyResponded: false, emailThread: thread };
      },
      pool: createTransactionalPool(),
      resolveDeployAccessFn: async () => ({ canDeploy: true }),
      setSupportEmailChannelFn: async (_pool, targetChannelId) => {
        state.supportEmailConfig.targetChannelId = targetChannelId;
        return {};
      },
      setSupportEmailMonitorEnabledFn: async (_pool, enabled) => {
        state.supportEmailConfig.enabled = enabled;
        return {};
      },
      setSupportEmailOnCallFn: async (_pool, targetUserId, expiresAt) => {
        state.supportEmailConfig.onCallUserId = targetUserId;
        state.supportEmailConfig.onCallExpiresAt = expiresAt;
        return {};
      },
    },
  );

  await runSlashCommand(commandHandler, "config email-monitor:on");
  await runSlashCommand(commandHandler, "config email-channel:<#CEMAIL|support>");
  await runSlashCommand(commandHandler, "config email-on-call <@UONCALL> 1d");

  await runSupportEmailSchedulerTick({
    communicationClient: {
      provider: "slack",
      async postChannelMessage(message) {
        postedMessages.push(message);
      },
    },
    emailSyncFallbackIntervalMs: 5 * 60 * 1000,
    emailWatchRenewIntervalMs: 24 * 60 * 60 * 1000,
    getSupportEmailConfigFn: async () => state.supportEmailConfig,
    gmailClient: {
      gmailAddress: "support@example.com",
      async getMessageMetadata() {
        throw new Error("metadata should not be fetched during empty backfill");
      },
      async listHistory() {
        return { history: [], historyId: "100" };
      },
      async listRecentInboxMessages() {
        return [];
      },
      async watchMailbox() {
        return {
          expiration: "2026-03-12T00:00:00.000Z",
          historyId: "100",
        };
      },
    },
    insertSupportEmailThreadFn: async (_pool, thread) => {
      state.supportEmailThreads.push({
        id: nextId++,
        first_sender: thread.firstSender,
        first_received_at: thread.firstReceivedAt,
        gmail_thread_id: thread.gmailThreadId,
        notification_sent_at: null,
        status: "pending",
        subject: thread.subject,
      });
    },
    listUnnotifiedSupportEmailThreadsFn: async () => [],
    logger: silentLogger(),
    markSupportEmailThreadNotificationSentFn: async () => null,
    nowFn: () => new Date("2026-03-06T12:00:00.000Z"),
    pool: createTransactionalPool(),
    schedulerState: {
      lastSkipLogMinuteKeyByReason: new Map(),
      lastWatchRenewAttemptAt: 0,
    },
    updateSupportEmailRuntimeStateFn: async (_pool, updates) => {
      applySupportEmailConfigUpdates(state.supportEmailConfig, updates);
      return { ...state.supportEmailConfig };
    },
  });

  const webhookHandler = createGmailWebhookHandler({
    config: {
      emailGmailAddress: "support@example.com",
      emailWebhookAudience: "https://example.com/email/webhook",
    },
    pool: {},
    upsertPendingSupportEmailHistoryIdFn: async (_pool, historyId) => {
      state.supportEmailConfig.pendingHistoryId = historyId;
      return historyId;
    },
    verifyPushJwtFn: async () => ({ valid: true }),
  });

  await webhookHandler(
    {
      body: {
        message: {
          data: Buffer.from(
            JSON.stringify({
              emailAddress: "support@example.com",
              historyId: "150",
            }),
            "utf8",
          ).toString("base64"),
        },
      },
      headers: {},
    },
    createResponseRecorder(),
  );

  await runSupportEmailSchedulerTick({
    communicationClient: {
      provider: "slack",
      async postChannelMessage(message) {
        postedMessages.push(message);
      },
    },
    emailSyncFallbackIntervalMs: 5 * 60 * 1000,
    emailWatchRenewIntervalMs: 24 * 60 * 60 * 1000,
    getSupportEmailConfigFn: async () => state.supportEmailConfig,
    gmailClient: {
      gmailAddress: "support@example.com",
      async getMessageMetadata() {
        return {
          id: "m1",
          internalDate: "1741262400000",
          payload: {
            headers: [
              { name: "From", value: "Alice <alice@example.com>" },
              { name: "Subject", value: "Billing question" },
            ],
          },
          threadId: "thread-1",
        };
      },
      async listHistory() {
        return {
          history: [{ messagesAdded: [{ message: { id: "m1", threadId: "thread-1" } }] }],
          historyId: "150",
        };
      },
      async listRecentInboxMessages() {
        return [];
      },
      async watchMailbox() {
        return {
          expiration: "2026-03-12T00:00:00.000Z",
          historyId: "100",
        };
      },
    },
    insertSupportEmailThreadFn: async (_pool, thread) => {
      if (!state.supportEmailThreads.some((candidate) => candidate.gmail_thread_id === thread.gmailThreadId)) {
        state.supportEmailThreads.push({
          id: nextId++,
          first_sender: thread.firstSender,
          first_received_at: thread.firstReceivedAt,
          gmail_thread_id: thread.gmailThreadId,
          notification_sent_at: null,
          status: "pending",
          subject: thread.subject,
        });
      }
    },
    listUnnotifiedSupportEmailThreadsFn: async () =>
      state.supportEmailThreads.filter((thread) => thread.notification_sent_at === null),
    logger: silentLogger(),
    markSupportEmailThreadNotificationSentFn: async (_pool, emailId, notificationSentAt) => {
      const thread = state.supportEmailThreads.find((candidate) => candidate.id === emailId);
      thread.notification_sent_at = notificationSentAt;
      return thread;
    },
    nowFn: () => new Date("2026-03-06T12:05:00.000Z"),
    pool: createTransactionalPool(),
    schedulerState: {
      lastSkipLogMinuteKeyByReason: new Map(),
      lastWatchRenewAttemptAt: Date.parse("2026-03-06T12:00:00.000Z"),
    },
    updateSupportEmailRuntimeStateFn: async (_pool, updates) => {
      applySupportEmailConfigUpdates(state.supportEmailConfig, updates);
      return { ...state.supportEmailConfig };
    },
  });

  assert.equal(postedMessages.length, 1);
  assert.match(postedMessages[0].text, /New customer support email: alice@example.com \| Billing question/);
  assert.match(postedMessages[0].text, /On call: <@UONCALL>/);

  const listPayload = await runSlashCommand(commandHandler, "emails");
  assert.match(readResponseText(listPayload), /\[1\] alice@example.com \| Billing question/);

  const respondPayload = await runSlashCommand(commandHandler, "emails responded 1");
  assert.match(readResponseText(respondPayload), /Marked support email \[1\] as responded/);
  assert.equal(state.supportEmailThreads[0].status, "responded");
});

test("high-level environment status flow: transient failure -> confirmed outage -> recovery", async () => {
  const state = {
    environmentStatusConfig: {
      consecutiveFailureCount: 0,
      enabled: false,
      lastCheckedAt: null,
      lastConnectivityCheckedAt: null,
      lastConnectivityErrorMessage: null,
      lastConnectivityState: "unknown",
      lastErrorMessage: null,
      lastHttpStatus: null,
      lastNotifiedAt: null,
      lastNotifiedState: null,
      lastObservedState: "unknown",
      lastStateChangedAt: null,
      targetChannelId: null,
      targetUrl: null,
    },
  };
  const postedMessages = [];

  let commandHandler;
  registerCalypsoCommand(
    {
      command(_name, handler) {
        commandHandler = handler;
      },
    },
    {
      pool: createTransactionalPool(),
      resolveDeployAccessFn: async () => ({ canDeploy: true }),
      setEnvironmentStatusChannelFn: async (_pool, targetChannelId) => {
        state.environmentStatusConfig.targetChannelId = targetChannelId;
        return {};
      },
      setEnvironmentStatusEnabledFn: async (_pool, enabled) => {
        state.environmentStatusConfig.enabled = enabled;
        return {};
      },
      setEnvironmentStatusUrlFn: async (_pool, targetUrl) => {
        state.environmentStatusConfig.targetUrl = targetUrl;
        return {};
      },
    },
  );

  await runSlashCommand(commandHandler, "config environment-status:on");
  await runSlashCommand(commandHandler, "config environment-status-url:https://example.com/healthz");
  await runSlashCommand(commandHandler, "config environment-status-channel:<#COPS|ops>");

  const runTick = async ({ targetStatuses }) => {
    const pendingTargetStatuses = [...targetStatuses];
    return runEnvironmentStatusSchedulerTick({
      communicationClient: {
        async postChannelMessage(message) {
          postedMessages.push(message);
        },
      },
      connectivityProbeUrl: "https://probe.example.com/healthz",
      dnsLookupFn: async () => ({ address: "203.0.113.10", family: 4 }),
      fetchFn: async (requestUrl) => {
        if (requestUrl === "https://probe.example.com/healthz") {
          return { status: 204 };
        }

        return { status: pendingTargetStatuses.shift() ?? 200 };
      },
      getEnvironmentStatusConfigFn: async () => state.environmentStatusConfig,
      logger: silentLogger(),
      markEnvironmentStatusNotificationSentFn: async (_pool, stateName, notifiedAt) => {
        state.environmentStatusConfig.lastNotifiedState = stateName;
        state.environmentStatusConfig.lastNotifiedAt = notifiedAt;
      },
      nowFn: () => new Date("2026-03-06T12:00:00.000Z"),
      pool: {},
      recordEnvironmentStatusObservationFn: async (_pool, observation) => {
        applyEnvironmentStatusConfigUpdates(state.environmentStatusConfig, observation);
      },
      schedulerState: { lastSkipLogMinuteKeyByReason: new Map() },
      sleepFn: async () => {},
      updateEnvironmentStatusRuntimeStateFn: async (_pool, updates) => {
        applyEnvironmentStatusConfigUpdates(state.environmentStatusConfig, updates);
        return { ...state.environmentStatusConfig };
      },
    });
  };

  await runTick({ targetStatuses: [503, 200] });
  await runTick({ targetStatuses: [503, 503, 503] });
  await runTick({ targetStatuses: [200] });

  assert.equal(postedMessages.length, 2);
  assert.match(postedMessages[0].text, /Environment alert: https:\/\/example.com\/healthz is down after 3 consecutive failed checks/);
  assert.match(postedMessages[1].text, /Environment recovery: https:\/\/example.com\/healthz returned HTTP 200 again/);
  assert.equal(state.environmentStatusConfig.lastConnectivityState, "reachable");
  assert.equal(state.environmentStatusConfig.consecutiveFailureCount, 0);
});

async function runSlashCommand(commandHandler, text) {
  let payload;
  await commandHandler({
    ack: async () => {},
    command: { text, user_id: "UADMIN" },
    respond: async (message) => {
      payload = message;
    },
  });
  return payload;
}

function applySupportEmailConfigUpdates(config, updates) {
  if (updates.lastProcessedHistoryId !== undefined) {
    config.lastProcessedHistoryId = updates.lastProcessedHistoryId;
  }
  if (updates.pendingHistoryId !== undefined) {
    config.pendingHistoryId = updates.pendingHistoryId;
  }
  if (updates.watchExpirationAt !== undefined) {
    config.watchExpirationAt = updates.watchExpirationAt;
  }
  if (updates.backfillCompletedAt !== undefined) {
    config.backfillCompletedAt = updates.backfillCompletedAt;
  }
  if (updates.lastSyncAt !== undefined) {
    config.lastSyncAt = updates.lastSyncAt;
  }
  if (updates.clearBackfillCompletedAt) {
    config.backfillCompletedAt = null;
  }
}

function applyEnvironmentStatusConfigUpdates(config, updates) {
  if (updates.lastObservedState !== undefined) {
    config.lastObservedState = updates.lastObservedState;
  }
  if (updates.lastStateChangedAt !== undefined && updates.lastStateChangedAt !== null) {
    config.lastStateChangedAt = updates.lastStateChangedAt;
  }
  if (updates.lastCheckedAt !== undefined) {
    config.lastCheckedAt = updates.lastCheckedAt;
  }
  if (updates.lastHttpStatus !== undefined) {
    config.lastHttpStatus = updates.lastHttpStatus;
  }
  if (updates.lastErrorMessage !== undefined) {
    config.lastErrorMessage = updates.lastErrorMessage;
  }
  if (updates.consecutiveFailureCount !== undefined) {
    config.consecutiveFailureCount = updates.consecutiveFailureCount;
  }
  if (updates.lastConnectivityState !== undefined) {
    config.lastConnectivityState = updates.lastConnectivityState;
  }
  if (updates.lastConnectivityCheckedAt !== undefined) {
    config.lastConnectivityCheckedAt = updates.lastConnectivityCheckedAt;
  }
  if (updates.lastConnectivityErrorMessage !== undefined) {
    config.lastConnectivityErrorMessage = updates.lastConnectivityErrorMessage;
  }
  if (updates.clearLastConnectivityErrorMessage) {
    config.lastConnectivityErrorMessage = null;
  }
}

function createResponseRecorder() {
  return {
    payload: null,
    statusCode: 200,
    json(payload) {
      this.payload = payload;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
  };
}

function createTransactionalPool() {
  return {
    async query() {
      return { rows: [] };
    },
  };
}

function silentLogger() {
  return {
    error() {},
    info() {},
    warn() {},
  };
}

function readResponseText(message) {
  return message.text || message.attachments?.[0]?.fallback || "";
}
