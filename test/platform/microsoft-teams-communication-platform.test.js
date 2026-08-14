const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DEPLOY_PROD_TIP_TEXT,
} = require("../../src/platform/communication/deploy_prod_tip");
const {
  MicrosoftTeamsCommunicationPlatform,
} = require("../../src/platform/communication/providers/microsoft_teams_communication_platform");

test("microsoft teams platform registers command route and responds", async () => {
  const platform = new MicrosoftTeamsCommunicationPlatform({
    config: {
      botName: "Code Conductor",
      communicationAdminUserIds: ["UADMIN"],
    },
  });

  platform.registerCalypsoCommand({
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
  });

  const routes = [];
  const app = {
    post(path, handler) {
      routes.push({ path, handler });
    },
  };

  platform.registerHttpRoutes(app);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].path, "/communication/commands");

  const response = createResponseRecorder();
  await routes[0].handler(
    {
      body: {
        text: "/conductor help",
        from: {
          id: "U123",
          name: "will.akins",
        },
      },
      headers: {},
    },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.text, undefined);
  assert.equal(response.payload.attachments.length, 1);
  assert.match(
    response.payload.attachments[0].content.fallbackText,
    /\/conductor help/,
  );
  assert.match(
    JSON.stringify(response.payload.attachments[0].content.body),
    /Code Conductor help/,
  );
  assert.equal(await platform.resolveUserDisplayName("U123"), "will.akins");
  assert.equal(await platform.isWorkspaceAdmin("UADMIN"), true);
  assert.equal(await platform.isWorkspaceAdmin("UNAUTHORIZED"), false);
});

test("microsoft teams platform accepts Adaptive Card submitted commands", async () => {
  const platform = new MicrosoftTeamsCommunicationPlatform({
    config: { botName: "Code Conductor" },
  });
  platform.registerCalypsoCommand({ pool: {} });
  const routes = [];
  platform.registerHttpRoutes({
    post(path, handler) {
      routes.push({ path, handler });
    },
  });

  const response = createResponseRecorder();
  await routes[0].handler(
    {
      body: {
        from: { id: "U123", name: "Will" },
        value: { command: "help" },
      },
      headers: {},
    },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.text, undefined);
  assert.match(
    response.payload.attachments[0].content.fallbackText,
    /\/conductor status/,
  );
});

test("microsoft teams platform renders status as an adaptive card", async () => {
  const platform = new MicrosoftTeamsCommunicationPlatform({
    config: {
      botName: "Code Conductor",
    },
  });
  platform.registerCalypsoCommand({
    pool: {},
    getLastProdDeployAtFn: async () => new Date("2026-07-28T14:00:00.000Z"),
    listBlockingPullRequestsFn: async () => [
      {
        repo: "acme/widgets",
        pr_number: 42,
        status: "untested",
        title: "Improve deploy controls",
        url: "https://example.test/acme/widgets/pull/42",
      },
    ],
    readTimeFormatPreferenceFn: async () => "legacy_utc",
    readTimeZonePreferenceFn: async () => "UTC",
  });

  const routes = [];
  platform.registerHttpRoutes({
    post(path, handler) {
      routes.push({ path, handler });
    },
  });

  const response = createResponseRecorder();
  await routes[0].handler(
    {
      body: {
        text: "/conductor status",
        from: {
          id: "U123",
          name: "Will",
        },
      },
      headers: {},
    },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.attachments.length, 1);
  assert.equal(
    response.payload.attachments[0].contentType,
    "application/vnd.microsoft.card.adaptive",
  );
  const cardText = JSON.stringify(response.payload.attachments[0].content.body);
  assert.match(cardText, /Production readiness/);
  assert.match(cardText, /Ready to deploy/);
  assert.match(cardText, /1 change queued/);
  assert.match(cardText, /\[#42  Improve deploy controls\]/);
  assert.match(cardText, /acme\/widgets/);
  assert.match(cardText, /Untested/);
  assert.match(cardText, /Review deployment/);
});

test("microsoft teams platform returns 400 for missing command text", async () => {
  const platform = new MicrosoftTeamsCommunicationPlatform({
    config: {},
  });
  platform.registerCalypsoCommand({
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
  });

  const routes = [];
  platform.registerHttpRoutes({
    post(path, handler) {
      routes.push({ path, handler });
    },
  });

  const response = createResponseRecorder();
  await routes[0].handler(
    {
      body: {},
      headers: {},
    },
    response,
  );

  assert.equal(response.statusCode, 400);
  assert.match(response.payload.text, /Missing command text/);
});

test("microsoft teams platform strips configured bot prefix", async () => {
  const platform = new MicrosoftTeamsCommunicationPlatform({
    config: {
      botName: "Voyager",
    },
  });
  platform.registerCalypsoCommand({
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
  });

  const routes = [];
  platform.registerHttpRoutes({
    post(path, handler) {
      routes.push({ path, handler });
    },
  });

  const response = createResponseRecorder();
  await routes[0].handler(
    {
      body: {
        text: "/voyager help",
        from: {
          id: "U123",
          name: "will.akins",
        },
      },
      headers: {},
    },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.text, undefined);
  assert.match(
    response.payload.attachments[0].content.fallbackText,
    /\/voyager status/,
  );
  assert.doesNotMatch(
    response.payload.attachments[0].content.fallbackText,
    /\/conductor/,
  );
});

test("microsoft teams platform strips a kebab-cased multiword bot prefix", async () => {
  const platform = new MicrosoftTeamsCommunicationPlatform({
    config: { botName: "Release Bot" },
  });
  platform.registerCalypsoCommand({ pool: {} });
  const routes = [];
  platform.registerHttpRoutes({
    post(path, handler) {
      routes.push({ path, handler });
    },
  });

  const response = createResponseRecorder();
  await routes[0].handler(
    {
      body: {
        text: "/release-bot help",
        from: { id: "U123", name: "Will" },
      },
      headers: {},
    },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.match(
    response.payload.attachments[0].content.fallbackText,
    /\/release-bot status/,
  );
});

test("microsoft teams platform does not partially match a legacy command prefix", async () => {
  const platform = new MicrosoftTeamsCommunicationPlatform({
    config: { botName: "Calypso Ops" },
  });
  platform.registerCalypsoCommand({ pool: {} });
  const routes = [];
  platform.registerHttpRoutes({
    post(path, handler) {
      routes.push({ path, handler });
    },
  });

  const response = createResponseRecorder();
  await routes[0].handler(
    {
      body: {
        text: "/calypso-ops help",
        from: { id: "U123", name: "Will" },
      },
      headers: {},
    },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.match(
    response.payload.attachments[0].content.fallbackText,
    /\/calypso-ops status/,
  );
});

test("microsoft teams platform returns deploy prod tip for matching text", async () => {
  const platform = new MicrosoftTeamsCommunicationPlatform({
    config: {
      botName: "Code Conductor",
    },
  });
  platform.registerCalypsoCommand({
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
  });

  const routes = [];
  platform.registerHttpRoutes({
    post(path, handler) {
      routes.push({ path, handler });
    },
  });

  const response = createResponseRecorder();
  await routes[0].handler(
    {
      body: {
        text: "deploying prod",
        from: {
          id: "U123",
          name: "will.akins",
        },
      },
      headers: {},
    },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.text, DEPLOY_PROD_TIP_TEXT);
});

test("microsoft teams platform posts channel message via webhook", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      text: async () => "",
    };
  };

  try {
    const platform = new MicrosoftTeamsCommunicationPlatform({
      config: {
        communicationWebhookUrl: "https://example.test/teams/webhook",
      },
    });

    await platform.postChannelMessage({
      channelId: "ignored",
      mrkdwn: true,
      text: "recap message",
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://example.test/teams/webhook");
    assert.equal(calls[0].options.method, "POST");
    assert.match(calls[0].options.body, /recap message/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("microsoft teams platform rejects posting when webhook URL is missing", async () => {
  const platform = new MicrosoftTeamsCommunicationPlatform({
    config: {},
  });

  await assert.rejects(
    async () => {
      await platform.postChannelMessage({
        text: "hello",
      });
    },
    /webhook URL is not configured/,
  );
});

function createResponseRecorder() {
  return {
    payload: null,
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}
