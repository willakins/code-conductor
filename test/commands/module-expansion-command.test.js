const assert = require("node:assert/strict");
const test = require("node:test");

const { handleCalypsoCommand, registerCalypsoCommand } = require("../../src/commands/command_router");

test("handleCalypsoCommand routes emails list input", () => {
  const result = handleCalypsoCommand({ text: "emails", user_id: "U123" });

  assert.equal(result.action, "emails_list");
});

test("handleCalypsoCommand routes emails responded input", () => {
  const result = handleCalypsoCommand({ text: "emails responded 42", user_id: "U123" });

  assert.equal(result.action, "emails_responded");
  assert.equal(result.emailId, 42);
});

test("handleCalypsoCommand routes emails draft input", () => {
  const result = handleCalypsoCommand({
    text: "emails draft 42 keep it concise",
    user_id: "U123",
  });

  assert.equal(result.action, "emails_draft");
  assert.equal(result.emailId, 42);
  assert.equal(result.additionalInstructions, "keep it concise");
});

test("handleCalypsoCommand routes environment status config input", () => {
  const result = handleCalypsoCommand({ text: "config environment-status:on", user_id: "UADMIN" });

  assert.equal(result.action, "config_environment_status");
  assert.equal(result.enabled, true);
});

test("handleCalypsoCommand routes environment status url config input", () => {
  const result = handleCalypsoCommand({
    text: "config environment-status-url:https://example.com/healthz",
    user_id: "UADMIN",
  });

  assert.equal(result.action, "config_environment_status_url");
  assert.equal(result.targetUrl, "https://example.com/healthz");
});

test("handleCalypsoCommand routes error tracking config input", () => {
  const result = handleCalypsoCommand({ text: "config error-tracking:on", user_id: "UADMIN" });

  assert.equal(result.action, "config_error_tracking");
  assert.equal(result.enabled, true);
});

test("handleCalypsoCommand routes error tracking project config input", () => {
  const result = handleCalypsoCommand({
    text: "config error-tracking-project:api",
    user_id: "UADMIN",
  });

  assert.equal(result.action, "config_error_tracking_project");
  assert.equal(result.projectSlug, "api");
});

test("handleCalypsoCommand routes errors command input", () => {
  const result = handleCalypsoCommand({ text: "errors", user_id: "U123" });

  assert.equal(result.action, "errors_list");
});

test("handleCalypsoCommand routes email monitor config input", () => {
  const result = handleCalypsoCommand({ text: "config email-monitor:on", user_id: "UADMIN" });

  assert.equal(result.action, "config_email_monitor");
  assert.equal(result.enabled, true);
});

test("handleCalypsoCommand routes email channel config input", () => {
  const result = handleCalypsoCommand({
    text: "config email-channel:<#C123ABC|support>",
    user_id: "UADMIN",
  });

  assert.equal(result.action, "config_email_channel");
  assert.equal(result.targetChannelReference, "<#C123ABC|support>");
});

test("handleCalypsoCommand routes email on call config input", () => {
  const result = handleCalypsoCommand({
    text: "config email-on-call <@U123ABC> 1D",
    user_id: "UADMIN",
  });

  assert.equal(result.action, "config_email_on_call");
  assert.equal(result.targetUserId, "U123ABC");
  assert.equal(result.onCallDurationToken, "1d");
});

test("handleCalypsoCommand routes email on call off config input", () => {
  const result = handleCalypsoCommand({
    text: "config email-on-call off",
    user_id: "UADMIN",
  });

  assert.equal(result.action, "config_email_on_call_off");
});

test("handleCalypsoCommand rejects invalid email on call duration", () => {
  const result = handleCalypsoCommand({
    text: "config email-on-call <@U123ABC> 0D",
    user_id: "UADMIN",
  });

  assert.equal(result.action, "respond");
  assert.match(result.responseText, /\/conductor config email-on-call <@USER\|USER_ID> <Nh\|Nd\|Nw>/);
});

test("registerCalypsoCommand emails command lists pending support emails", async () => {
  let commandHandler;
  registerCalypsoCommand(
    {
      command(_name, handler) {
        commandHandler = handler;
      },
    },
    {
      listPendingSupportEmailThreadsFn: async () => [
        {
          id: 42,
          first_sender: "alice@example.com",
          subject: "Billing question",
        },
      ],
      pool: {},
    },
  );

  let payload;
  await commandHandler({
    ack: async () => {},
    command: { text: "emails", user_id: "U123" },
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(readResponseText(payload), /Pending customer support emails:/);
  assert.match(readResponseText(payload), /\[42\] alice@example.com \| Billing question/);
  assert.match(readSlackBlocks(payload)[0].text.text, /Support email/);
});

test("registerCalypsoCommand emails command marks support email responded", async () => {
  let commandHandler;
  const calls = [];
  registerCalypsoCommand(
    {
      command(_name, handler) {
        commandHandler = handler;
      },
    },
    {
      markSupportEmailThreadRespondedFn: async (_pool, emailId, respondedBy) => {
        calls.push({ emailId, respondedBy });
        return { found: true, alreadyResponded: false, emailThread: { id: emailId } };
      },
      pool: {},
    },
  );

  let payload;
  await commandHandler({
    ack: async () => {},
    command: { text: "emails responded 7", user_id: "U123" },
    respond: async (message) => {
      payload = message;
    },
  });

  assert.deepEqual(calls, [{ emailId: 7, respondedBy: "U123" }]);
  assert.equal(payload.response_type, "ephemeral");
  assert.match(readResponseText(payload), /Marked support email \[7\] as responded/);
});

test("registerCalypsoCommand emails draft generates a reply for the current on-call user", async () => {
  let commandHandler;
  let capturedDraftArguments = null;
  registerCalypsoCommand(
    {
      command(_name, handler) {
        commandHandler = handler;
      },
    },
    {
      aiSupportEmailSystemPrompt: "Keep replies brief.",
      getSupportEmailConfigFn: async () => ({
        onCallExpiresAt: "2099-03-06T12:00:00.000Z",
        onCallUserId: "UONCALL",
      }),
      getSupportEmailThreadByIdFn: async () => ({
        first_message_text: "Hi, I need help with a billing issue.",
        first_sender: "alice@example.com",
        gmail_first_message_id: "msg-7",
        id: 7,
        source_provider: "gmail",
        subject: "Billing question",
      }),
      isWorkspaceAdminFn: async () => false,
      pool: {},
      resolveAiClientFn: async () => ({
        aiClient: {
          async generateText(argumentsValue) {
            capturedDraftArguments = argumentsValue;
            return "Hi Alice,\n\nWe are reviewing the billing issue now and will follow up shortly.";
          },
        },
        aiProvider: "openai",
      }),
    },
  );

  let payload;
  await commandHandler({
    ack: async () => {},
    command: { text: "emails draft 7 keep it concise", user_id: "UONCALL" },
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(readResponseText(payload), /Draft reply for support email \[7\]/);
  assert.match(readResponseText(payload), /Subject: Re: Billing question/);
  assert.match(readResponseText(payload), /We are reviewing the billing issue now/);
  assert.match(capturedDraftArguments.systemPrompt, /Keep replies brief/);
  assert.match(capturedDraftArguments.userPrompt, /Customer email:/);
  assert.match(capturedDraftArguments.userPrompt, /keep it concise/);
});

test("registerCalypsoCommand emails draft fetches and caches missing message text", async () => {
  let commandHandler;
  const calls = [];
  registerCalypsoCommand(
    {
      command(_name, handler) {
        commandHandler = handler;
      },
    },
    {
      getSupportEmailConfigFn: async () => ({
        onCallExpiresAt: null,
        onCallUserId: null,
      }),
      getSupportEmailThreadByIdFn: async () => ({
        first_message_text: null,
        first_sender: "bob@example.com",
        gmail_first_message_id: "msg-9",
        id: 9,
        source_provider: "outlook",
        subject: "Need help",
      }),
      cacheSupportEmailThreadMessageTextFn: async (_pool, emailId, messageText, provider) => {
        calls.push({ emailId, messageText, provider });
        return {};
      },
      isWorkspaceAdminFn: async () => true,
      pool: {},
      resolveAiClientFn: async () => ({
        aiClient: {
          async generateText() {
            return "Hi Bob,\n\nThanks for reaching out.";
          },
        },
        aiProvider: "openai",
      }),
      resolveEmailClientByProviderFn: async (provider) => ({
        emailClient: {
          async getMessageDetail(messageId) {
            calls.push({ messageId, provider });
            return {
              plainTextBody: "Hello, I need help with my account access.",
            };
          },
        },
        emailProvider: provider,
      }),
    },
  );

  let payload;
  await commandHandler({
    ack: async () => {},
    command: { text: "emails draft 9", user_id: "UADMIN" },
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(readResponseText(payload), /Subject: Re: Need help/);
  assert.deepEqual(calls, [
    { messageId: "msg-9", provider: "outlook" },
    {
      emailId: 9,
      messageText: "Hello, I need help with my account access.",
      provider: "outlook",
    },
  ]);
});

test("registerCalypsoCommand emails draft denies users who are not admin or on-call", async () => {
  let commandHandler;
  registerCalypsoCommand(
    {
      command(_name, handler) {
        commandHandler = handler;
      },
    },
    {
      getSupportEmailConfigFn: async () => ({
        onCallExpiresAt: "2099-03-06T12:00:00.000Z",
        onCallUserId: "UONCALL",
      }),
      getSupportEmailThreadByIdFn: async () => {
        throw new Error("should not be called");
      },
      isWorkspaceAdminFn: async () => false,
      pool: {},
    },
  );

  let payload;
  await commandHandler({
    ack: async () => {},
    command: { text: "emails draft 7", user_id: "U123" },
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(readResponseText(payload), /Email draft denied/);
});

test("registerCalypsoCommand emails draft reports AI unavailability", async () => {
  let commandHandler;
  registerCalypsoCommand(
    {
      command(_name, handler) {
        commandHandler = handler;
      },
    },
    {
      getSupportEmailConfigFn: async () => ({
        onCallExpiresAt: null,
        onCallUserId: null,
      }),
      getSupportEmailThreadByIdFn: async () => ({
        first_message_text: "Hello from a customer.",
        first_sender: "alice@example.com",
        gmail_first_message_id: "msg-10",
        id: 10,
        source_provider: "gmail",
        subject: "Question",
      }),
      isWorkspaceAdminFn: async () => true,
      pool: {},
      resolveAiClientFn: async () => ({
        aiClient: null,
        aiProvider: "anthropic",
      }),
    },
  );

  let payload;
  await commandHandler({
    ack: async () => {},
    command: { text: "emails draft 10", user_id: "UADMIN" },
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(readResponseText(payload), /AI drafting unavailable/);
  assert.match(readResponseText(payload), /`anthropic`/);
});

test("registerCalypsoCommand emails draft reports support email not found", async () => {
  let commandHandler;
  registerCalypsoCommand(
    {
      command(_name, handler) {
        commandHandler = handler;
      },
    },
    {
      getSupportEmailConfigFn: async () => ({
        onCallExpiresAt: null,
        onCallUserId: null,
      }),
      getSupportEmailThreadByIdFn: async () => null,
      isWorkspaceAdminFn: async () => true,
      pool: {},
    },
  );

  let payload;
  await commandHandler({
    ack: async () => {},
    command: { text: "emails draft 404", user_id: "UADMIN" },
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(readResponseText(payload), /Support email \[404\] not found/);
});

test("registerCalypsoCommand config command updates environment status monitoring", async () => {
  let commandHandler;
  const calls = [];
  registerCalypsoCommand(
    {
      command(_name, handler) {
        commandHandler = handler;
      },
    },
    {
      pool: {},
      resolveDeployAccessFn: async () => ({ canDeploy: true }),
      setEnvironmentStatusEnabledFn: async (_pool, enabled, updatedBy) => {
        calls.push({ enabled, updatedBy });
        return {};
      },
    },
  );

  let payload;
  await commandHandler({
    ack: async () => {},
    command: { text: "config environment-status:on", user_id: "UADMIN" },
    respond: async (message) => {
      payload = message;
    },
  });

  assert.deepEqual(calls, [{ enabled: true, updatedBy: "UADMIN" }]);
  assert.equal(payload.response_type, "in_channel");
  assert.match(readResponseText(payload), /Updated environment status monitoring to `on`/);
});

test("registerCalypsoCommand config command updates error tracking project", async () => {
  let commandHandler;
  const calls = [];
  registerCalypsoCommand(
    {
      command(_name, handler) {
        commandHandler = handler;
      },
    },
    {
      pool: {},
      resolveDeployAccessFn: async () => ({ canDeploy: true }),
      setErrorTrackingProjectFn: async (_pool, projectSlug, updatedBy) => {
        calls.push({ projectSlug, updatedBy });
        return {};
      },
    },
  );

  let payload;
  await commandHandler({
    ack: async () => {},
    command: { text: "config error-tracking-project:api", user_id: "UADMIN" },
    respond: async (message) => {
      payload = message;
    },
  });

  assert.deepEqual(calls, [{ projectSlug: "api", updatedBy: "UADMIN" }]);
  assert.equal(payload.response_type, "in_channel");
  assert.match(readResponseText(payload), /Updated error tracking project to `api`/);
});

test("registerCalypsoCommand config command rejects invalid error tracking project ephemerally", async () => {
  let commandHandler;
  let setCalled = false;
  registerCalypsoCommand(
    {
      command(_name, handler) {
        commandHandler = handler;
      },
    },
    {
      pool: {},
      resolveDeployAccessFn: async () => ({ canDeploy: true }),
      setErrorTrackingProjectFn: async () => {
        setCalled = true;
      },
    },
  );

  let payload;
  await commandHandler({
    ack: async () => {},
    command: { text: "config error-tracking-project:bad/slug", user_id: "UADMIN" },
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(setCalled, false);
  assert.equal(payload.response_type, "ephemeral");
  assert.match(readResponseText(payload), /Error tracking project slug `bad\/slug` is invalid/);
});

test("registerCalypsoCommand errors command lists unresolved tracked issues", async () => {
  let commandHandler;
  const calls = [];
  registerCalypsoCommand(
    {
      command(_name, handler) {
        commandHandler = handler;
      },
    },
    {
      errorTrackingProvider: "sentry",
      getErrorTrackingConfigFn: async () => ({
        enabled: true,
        projectSlug: "api",
        environment: "production",
        lastSyncAt: "2026-03-06T12:00:00.000Z",
        lastSyncError: null,
        targetChannelId: "COPS",
      }),
      getRuntimeProviderConfigFn: async () => ({
        communicationProvider: "slack",
        codeHostProvider: "github",
        deployProvider: "digitalocean",
        emailProvider: "gmail",
        errorTrackingProvider: "rollbar",
      }),
      listOpenErrorTrackingIssuesFn: async (_pool, scope) => {
        calls.push(scope);
        return [
          {
            shortId: "API-7",
            title: "Database unavailable",
            level: "error",
            lastSeenAt: "2026-03-06T12:02:00.000Z",
            regressionCount: 1,
          },
        ];
      },
      pool: {
        async query() {
          return { rows: [] };
        },
      },
    },
  );

  let payload;
  await commandHandler({
    ack: async () => {},
    command: { text: "errors", user_id: "U123" },
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(readResponseText(payload), /Tracked unresolved errors for project `api` in environment `production`/);
  assert.match(readResponseText(payload), /\[API-7\] Database unavailable/);
  assert.match(readResponseText(payload), /regressions:1/);
  assert.deepEqual(calls, [
    {
      environment: "production",
      projectSlug: "api",
      provider: "rollbar",
    },
  ]);
});

test("registerCalypsoCommand config command rejects invalid environment status url ephemerally", async () => {
  let commandHandler;
  let setCalled = false;
  registerCalypsoCommand(
    {
      command(_name, handler) {
        commandHandler = handler;
      },
    },
    {
      pool: {},
      resolveDeployAccessFn: async () => ({ canDeploy: true }),
      setEnvironmentStatusUrlFn: async () => {
        setCalled = true;
      },
    },
  );

  let payload;
  await commandHandler({
    ack: async () => {},
    command: { text: "config environment-status-url:ftp://example.com", user_id: "UADMIN" },
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(setCalled, false);
  assert.equal(payload.response_type, "ephemeral");
  assert.match(readResponseText(payload), /Environment status URL `ftp:\/\/example.com` is invalid/);
});

test("registerCalypsoCommand config command updates support email on call", async () => {
  let commandHandler;
  const calls = [];
  registerCalypsoCommand(
    {
      command(_name, handler) {
        commandHandler = handler;
      },
    },
    {
      pool: {},
      resolveDeployAccessFn: async () => ({ canDeploy: true }),
      setSupportEmailOnCallFn: async (_pool, targetUserId, expiresAt, updatedBy) => {
        calls.push({ targetUserId, expiresAt, updatedBy });
        return {};
      },
    },
  );

  let payload;
  await commandHandler({
    ack: async () => {},
    command: { text: "config email-on-call <@U555> 1D", user_id: "UADMIN" },
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].targetUserId, "U555");
  assert.equal(calls[0].updatedBy, "UADMIN");
  assert.ok(calls[0].expiresAt);
  assert.equal(payload.response_type, "in_channel");
  assert.match(readResponseText(payload), /Updated support email on-call to <@U555> for `1d`/);
});

test("registerCalypsoCommand config command clears support email on call", async () => {
  let commandHandler;
  const calls = [];
  registerCalypsoCommand(
    {
      command(_name, handler) {
        commandHandler = handler;
      },
    },
    {
      clearSupportEmailOnCallFn: async (_pool, updatedBy) => {
        calls.push(updatedBy);
        return {};
      },
      pool: {},
      resolveDeployAccessFn: async () => ({ canDeploy: true }),
    },
  );

  let payload;
  await commandHandler({
    ack: async () => {},
    command: { text: "config email-on-call off", user_id: "UADMIN" },
    respond: async (message) => {
      payload = message;
    },
  });

  assert.deepEqual(calls, ["UADMIN"]);
  assert.equal(payload.response_type, "in_channel");
  assert.match(readResponseText(payload), /Cleared support email on-call assignment/);
});

test("registerCalypsoCommand config command reports unresolved support email on call handle", async () => {
  let commandHandler;
  registerCalypsoCommand(
    {
      command(_name, handler) {
        commandHandler = handler;
      },
    },
    {
      pool: {},
      resolveDeployAccessFn: async () => ({ canDeploy: true }),
      setSupportEmailOnCallFn: async () => {
        throw new Error("should not be called");
      },
    },
  );

  let payload;
  await commandHandler({
    ack: async () => {},
    client: {
      users: {
        list: async () => ({
          members: [],
          response_metadata: {},
        }),
      },
    },
    command: { text: "config email-on-call @ghost 1d", user_id: "UADMIN" },
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(readResponseText(payload), /Could not resolve `@ghost` to a Slack user/);
});

function readSlackBlocks(message) {
  return message.attachments[0].blocks;
}

function readResponseText(message) {
  return message.text || message.attachments?.[0]?.fallback || "";
}
