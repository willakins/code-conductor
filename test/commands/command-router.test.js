const assert = require("node:assert/strict");
const test = require("node:test");

const { handleCalypsoCommand, registerCalypsoCommand } = require("../../src/commands/command_router");

test("handleCalypsoCommand returns help for empty input", () => {
  const result = handleCalypsoCommand({ text: "", user_id: "U123" });

  assert.equal(result.action, "respond");
  assert.match(result.responseText, /Calypso/);
  assert.match(result.responseText, /\/calypso help/);
});

test("handleCalypsoCommand returns help for help input", () => {
  const result = handleCalypsoCommand({ text: "HeLp", user_id: "U123" });

  assert.equal(result.action, "respond");
  assert.match(result.responseText, /\/calypso help/);
  assert.match(result.responseText, /\/calypso status/);
  assert.match(result.responseText, /Modules/);
  assert.match(result.responseText, /\/calypso help deploy/);
  assert.match(result.responseText, /\/calypso help reviews/);
  assert.match(result.responseText, /\/calypso help monitoring/);
  assert.match(result.responseText, /\/calypso help email/);
  assert.match(result.responseText, /\/calypso help config/);
});

test("handleCalypsoCommand uses configured bot name in help header", () => {
  const result = handleCalypsoCommand({ text: "help", user_id: "U123", botName: "Voyager" });

  assert.equal(result.action, "respond");
  assert.match(result.responseText, /^\*Voyager\*/);
});

test("handleCalypsoCommand returns deploy topic help for testing alias", () => {
  const result = handleCalypsoCommand({ text: "help testing", user_id: "U123" });

  assert.equal(result.action, "respond");
  assert.match(result.responseText, /\*Calypso Deploy Help\*/);
  assert.match(result.responseText, /\/calypso status/);
  assert.match(result.responseText, /\/calypso tested <PR_NUMBER>/);
  assert.match(result.responseText, /\/calypso deploy list/);
  assert.match(result.responseText, /\/calypso config deploy-environment:prod\|staging/);
  assert.match(result.responseText, /forced production deploy/);
  assert.match(result.responseText, /only explicit must-test PRs block/);
});

test("handleCalypsoCommand returns reviews topic help for reviewing alias", () => {
  const result = handleCalypsoCommand({ text: "help reviewing", user_id: "U123" });

  assert.equal(result.action, "respond");
  assert.match(result.responseText, /\*Calypso Reviews Help\*/);
  assert.match(result.responseText, /\/calypso reviews <GITHUB_USER>/);
  assert.match(result.responseText, /\/calypso config review-recap-window:<all\|last-day\|last-week\|last-month>/);
  assert.match(result.responseText, /\/calypso config review-recap-schedule:<daily\|weekday>@HH:MM\[,HH:MM\.\.\.\]/);
  assert.match(result.responseText, /\/calypso config timezone:America\/New_York/);
});

test("handleCalypsoCommand returns monitoring topic help", () => {
  const result = handleCalypsoCommand({ text: "help monitoring", user_id: "U123" });

  assert.equal(result.action, "respond");
  assert.match(result.responseText, /\*Calypso Monitoring Help\*/);
  assert.match(result.responseText, /\/calypso errors/);
  assert.match(result.responseText, /\/calypso config environment-status-url:https:\/\/example\.com\/healthz/);
  assert.match(result.responseText, /\/calypso config error-tracking-project:<PROJECT_SLUG>/);
});

test("handleCalypsoCommand returns email topic help", () => {
  const result = handleCalypsoCommand({ text: "help email", user_id: "U123" });

  assert.equal(result.action, "respond");
  assert.match(result.responseText, /\*Calypso Email Help\*/);
  assert.match(result.responseText, /\/calypso emails draft <EMAIL_ID> \[ADDITIONAL_INSTRUCTIONS\.\.\.\]/);
  assert.match(result.responseText, /\/calypso emails responded <EMAIL_ID>/);
  assert.match(result.responseText, /\/calypso config email-on-call <@USER\|USER_ID> <Nh\|Nd\|Nw>/);
});

test("handleCalypsoCommand returns config topic help", () => {
  const result = handleCalypsoCommand({ text: "help config", user_id: "U123" });

  assert.equal(result.action, "respond");
  assert.match(result.responseText, /\*Calypso Config Help\*/);
  assert.match(result.responseText, /\/calypso config time-format:human\|long/);
  assert.match(
    result.responseText,
    /\/calypso config github-slack-user-map:<GITHUB_USER>=<@USER\|USER_ID\|@HANDLE>/,
  );
  assert.match(result.responseText, /\/calypso config communication-provider:slack\|microsoft_teams/);
  assert.match(result.responseText, /\/calypso config email-provider:gmail\|outlook/);
  assert.match(result.responseText, /\/calypso config ai-provider:openai\|anthropic/);
  assert.match(result.responseText, /\/calypso config error-tracking-provider:sentry\|rollbar/);
  assert.match(result.responseText, /\/calypso help reviews/);
  assert.match(result.responseText, /\/calypso help monitoring/);
  assert.match(result.responseText, /\/calypso help email/);
});

test("handleCalypsoCommand rejects unknown help topic", () => {
  const result = handleCalypsoCommand({ text: "help foobar", user_id: "U123" });

  assert.equal(result.action, "respond");
  assert.match(result.responseText, /Usage:/);
  assert.match(result.responseText, /\/calypso help deploy/);
});

test("handleCalypsoCommand routes status input", () => {
  const result = handleCalypsoCommand({ text: "status", user_id: "U123" });

  assert.equal(result.action, "status");
});

test("handleCalypsoCommand routes sync input", () => {
  const result = handleCalypsoCommand({ text: "sync", user_id: "U123" });

  assert.equal(result.action, "sync_open_pr_review_state");
});

test("handleCalypsoCommand rejects invalid sync input", () => {
  const result = handleCalypsoCommand({ text: "sync now", user_id: "U123" });

  assert.equal(result.action, "respond");
  assert.match(result.responseText, /Usage: `\/calypso sync`/);
});

test("handleCalypsoCommand routes reviews input", () => {
  const result = handleCalypsoCommand({ text: "reviews", user_id: "U123" });

  assert.equal(result.action, "reviews_list");
  assert.equal(result.timeframe, null);
  assert.equal(result.githubUser, null);
});

test("handleCalypsoCommand routes reviews input with github user", () => {
  const result = handleCalypsoCommand({ text: "reviews octocat", user_id: "U123" });

  assert.equal(result.action, "reviews_list");
  assert.equal(result.githubUser, "octocat");
  assert.equal(result.timeframe, null);
});

test("handleCalypsoCommand routes reviews input with timeframe", () => {
  const result = handleCalypsoCommand({ text: "reviews week", user_id: "U123" });

  assert.equal(result.action, "reviews_list");
  assert.equal(result.githubUser, null);
  assert.equal(result.timeframe, "week");
});

test("handleCalypsoCommand routes reviews input with recent timeframe", () => {
  const result = handleCalypsoCommand({ text: "reviews recent day", user_id: "U123" });

  assert.equal(result.action, "reviews_list");
  assert.equal(result.githubUser, null);
  assert.equal(result.timeframe, "day");
});

test("handleCalypsoCommand routes reviews input with github user and timeframe", () => {
  const result = handleCalypsoCommand({ text: "reviews octocat month", user_id: "U123" });

  assert.equal(result.action, "reviews_list");
  assert.equal(result.githubUser, "octocat");
  assert.equal(result.timeframe, "month");
});

test("handleCalypsoCommand rejects invalid reviews input", () => {
  const result = handleCalypsoCommand({ text: "reviews recent", user_id: "U123" });

  assert.equal(result.action, "respond");
  assert.match(result.responseText, /Usage:/);
  assert.match(result.responseText, /`\/calypso reviews`/);
});

test("handleCalypsoCommand routes tested input with PR number", () => {
  const result = handleCalypsoCommand({ text: "tested 42", user_id: "U123" });

  assert.equal(result.action, "tested_single");
  assert.equal(result.prNumber, 42);
});

test("handleCalypsoCommand routes tested all input", () => {
  const result = handleCalypsoCommand({ text: "tested all", user_id: "U123" });

  assert.equal(result.action, "tested_all");
});

test("handleCalypsoCommand routes tested recent input", () => {
  const result = handleCalypsoCommand({ text: "tested recent week", user_id: "U123" });

  assert.equal(result.action, "tested_recent");
  assert.equal(result.timeframe, "week");
});

test("handleCalypsoCommand routes must-test input with PR number", () => {
  const result = handleCalypsoCommand({ text: "must-test 42", user_id: "U123" });

  assert.equal(result.action, "must_test_set");
  assert.equal(result.prNumber, 42);
});

test("handleCalypsoCommand routes must-test off input with PR number", () => {
  const result = handleCalypsoCommand({ text: "must-test off 42", user_id: "U123" });

  assert.equal(result.action, "must_test_clear");
  assert.equal(result.prNumber, 42);
});

test("handleCalypsoCommand rejects invalid must-test input", () => {
  const result = handleCalypsoCommand({ text: "must-test maybe", user_id: "U123" });

  assert.equal(result.action, "respond");
  assert.match(result.responseText, /Usage:/);
  assert.match(result.responseText, /\/calypso must-test <PR_NUMBER>/);
});

test("handleCalypsoCommand rejects tested input without PR number", () => {
  const result = handleCalypsoCommand({ text: "tested", user_id: "U123" });

  assert.equal(result.action, "respond");
  assert.match(result.responseText, /Usage:/);
});

test("handleCalypsoCommand routes deploy prod input", () => {
  const result = handleCalypsoCommand({ text: "deploy prod", user_id: "U123" });

  assert.equal(result.action, "deploy_prod");
});

test("handleCalypsoCommand routes deploy staging input", () => {
  const result = handleCalypsoCommand({ text: "deploy staging", user_id: "U123" });

  assert.equal(result.action, "deploy_staging");
  assert.equal(result.deployEnvironment, "staging");
});

test("handleCalypsoCommand routes deploy without an environment", () => {
  const result = handleCalypsoCommand({ text: "deploy", user_id: "U123" });

  assert.equal(result.action, "deploy_default");
  assert.equal(result.deployEnvironment, null);
});

test("handleCalypsoCommand routes deploy list as a status alias", () => {
  const result = handleCalypsoCommand({ text: "deploy list", user_id: "U123" });

  assert.equal(result.commandName, "status");
  assert.equal(result.action, "status");
});

test("handleCalypsoCommand rejects invalid deploy input", () => {
  const result = handleCalypsoCommand({ text: "deploy prod force", user_id: "U123" });

  assert.equal(result.action, "respond");
  assert.match(result.responseText, /`\/calypso deploy`/);
  assert.match(result.responseText, /`\/calypso deploy staging`/);
  assert.match(result.responseText, /`\/calypso deploy list`/);
  assert.doesNotMatch(result.responseText, /force/);
});

test("handleCalypsoCommand routes whitelist command with mention", () => {
  const result = handleCalypsoCommand({ text: "whitelist <@U123ABC>", user_id: "UADMIN" });

  assert.equal(result.action, "whitelist_add");
  assert.equal(result.targetUserId, "U123ABC");
});

test("handleCalypsoCommand routes whitelist command with @handle", () => {
  const result = handleCalypsoCommand({ text: "whitelist @travis", user_id: "UADMIN" });

  assert.equal(result.action, "whitelist_add");
  assert.equal(result.targetUserHandle, "travis");
});

test("handleCalypsoCommand routes config time-format input", () => {
  const result = handleCalypsoCommand({ text: "config time-format:long", user_id: "UADMIN" });

  assert.equal(result.action, "config_time_format");
  assert.equal(result.timeFormat, "long");
});

test("handleCalypsoCommand rejects invalid config input", () => {
  const result = handleCalypsoCommand({ text: "config time-format:weird", user_id: "UADMIN" });

  assert.equal(result.action, "respond");
  assert.match(result.responseText, /Usage:/);
  assert.match(result.responseText, /`\/calypso config time-format:human`/);
  assert.match(result.responseText, /`\/calypso config timezone:America\/New_York`/);
});

test("handleCalypsoCommand routes config timezone input", () => {
  const result = handleCalypsoCommand({
    text: "config timezone:America/Los_Angeles",
    user_id: "UADMIN",
  });

  assert.equal(result.action, "config_timezone");
  assert.equal(result.timeZone, "America/Los_Angeles");
});

test("handleCalypsoCommand routes config github-slack user map input", () => {
  const result = handleCalypsoCommand({
    text: "config github-slack-user-map:octocat=@willa",
    user_id: "UADMIN",
  });

  assert.equal(result.action, "config_github_slack_user_map");
  assert.equal(result.githubUsername, "octocat");
  assert.equal(result.slackUsername, "willa");
});

test("handleCalypsoCommand routes config github-slack user map input with mention", () => {
  const result = handleCalypsoCommand({
    text: "config github-slack-user-map:octocat=<@U123ABC>",
    user_id: "UADMIN",
  });

  assert.equal(result.action, "config_github_slack_user_map");
  assert.equal(result.githubUsername, "octocat");
  assert.equal(result.slackUsername, "U123ABC");
});

test("handleCalypsoCommand routes config review recap channel input", () => {
  const result = handleCalypsoCommand({
    text: "config review-recap-channel:<#C123ABC|deploys>",
    user_id: "UADMIN",
  });

  assert.equal(result.action, "config_review_recap_channel");
  assert.equal(result.targetChannelReference, "<#C123ABC|deploys>");
});

test("handleCalypsoCommand routes config review recap recency input", () => {
  const result = handleCalypsoCommand({
    text: "config review-recap-recency:2w",
    user_id: "UADMIN",
  });

  assert.equal(result.action, "config_review_recap_recency");
  assert.equal(result.recencyValue, 2);
  assert.equal(result.recencyUnit, "w");
});

test("handleCalypsoCommand routes config review recap window input", () => {
  const result = handleCalypsoCommand({
    text: "config review-recap-window:last-week",
    user_id: "UADMIN",
  });

  assert.equal(result.action, "config_review_recap_window");
  assert.equal(result.reviewScope, "week");
});

test("handleCalypsoCommand routes config review recap schedule input", () => {
  const result = handleCalypsoCommand({
    text: "config review-recap-schedule:tue@10:15",
    user_id: "UADMIN",
  });

  assert.equal(result.action, "config_review_recap_schedule");
  assert.equal(result.scheduleWeekday, "tue");
  assert.equal(result.scheduleTime, "10:15");
});

test("handleCalypsoCommand routes config review recap daily schedule input", () => {
  const result = handleCalypsoCommand({
    text: "config review-recap-schedule:daily@09:00",
    user_id: "UADMIN",
  });

  assert.equal(result.action, "config_review_recap_schedule");
  assert.equal(result.scheduleWeekday, "daily");
  assert.equal(result.scheduleTime, "09:00");
});

test("handleCalypsoCommand routes config review recap schedule input with multiple times", () => {
  const result = handleCalypsoCommand({
    text: "config review-recap-schedule:daily@17:00,09:00",
    user_id: "UADMIN",
  });

  assert.equal(result.action, "config_review_recap_schedule");
  assert.equal(result.scheduleWeekday, "daily");
  assert.equal(result.scheduleTime, "09:00,17:00");
});

test("handleCalypsoCommand routes config review recap send weekends input", () => {
  const result = handleCalypsoCommand({
    text: "config review-recap-send-weekends:off",
    user_id: "UADMIN",
  });

  assert.equal(result.action, "config_review_recap_send_weekends");
  assert.equal(result.sendOnWeekends, false);
});

test("handleCalypsoCommand routes config review recap send holidays input", () => {
  const result = handleCalypsoCommand({
    text: "config review-recap-send-holidays:on",
    user_id: "UADMIN",
  });

  assert.equal(result.action, "config_review_recap_send_holidays");
  assert.equal(result.sendOnHolidays, true);
});

test("handleCalypsoCommand routes config communication provider input", () => {
  const result = handleCalypsoCommand({
    text: "config communication-provider:slack",
    user_id: "UADMIN",
  });

  assert.equal(result.action, "config_communication_provider");
  assert.equal(result.communicationProvider, "slack");
});

test("handleCalypsoCommand routes config code-host provider input", () => {
  const result = handleCalypsoCommand({
    text: "config code-host-provider:github",
    user_id: "UADMIN",
  });

  assert.equal(result.action, "config_code_host_provider");
  assert.equal(result.codeHostProvider, "github");
});

test("handleCalypsoCommand routes config email provider input", () => {
  const result = handleCalypsoCommand({
    text: "config email-provider:outlook",
    user_id: "UADMIN",
  });

  assert.equal(result.action, "config_email_provider");
  assert.equal(result.emailProvider, "outlook");
});

test("handleCalypsoCommand routes config ai provider input", () => {
  const result = handleCalypsoCommand({
    text: "config ai-provider:anthropic",
    user_id: "UADMIN",
  });

  assert.equal(result.action, "config_ai_provider");
  assert.equal(result.aiProvider, "anthropic");
});

test("handleCalypsoCommand routes config error tracking provider input", () => {
  const result = handleCalypsoCommand({
    text: "config error-tracking-provider:rollbar",
    user_id: "UADMIN",
  });

  assert.equal(result.action, "config_error_tracking_provider");
  assert.equal(result.errorTrackingProvider, "rollbar");
});

test("handleCalypsoCommand routes config deploy provider input", () => {
  const result = handleCalypsoCommand({
    text: "config deploy-provider:digitalocean",
    user_id: "UADMIN",
  });

  assert.equal(result.action, "config_deploy_provider");
  assert.equal(result.deployProvider, "digitalocean");
});

test("handleCalypsoCommand routes config default deploy environment input", () => {
  const result = handleCalypsoCommand({
    text: "config deploy-environment:staging",
    user_id: "U123",
  });

  assert.equal(result.action, "config_deploy_environment");
  assert.equal(result.deployEnvironment, "staging");
});

test("handleCalypsoCommand returns unknown message for unsupported input", () => {
  const result = handleCalypsoCommand({ text: "foobar", user_id: "U123" });

  assert.equal(result.action, "respond");
  assert.match(result.responseText, /Unknown subcommand\./);
  assert.doesNotMatch(result.responseText, /foobar/);
});

test("handleCalypsoCommand sanitizes control characters before parsing", () => {
  const result = handleCalypsoCommand({ text: "\u0000\nstatus\t", user_id: "U123" });

  assert.equal(result.action, "status");
});

test("handleCalypsoCommand rejects tested command with injection-like payload", () => {
  const result = handleCalypsoCommand({
    text: "tested \"/'DATABASE DROP\"",
    user_id: "U123",
  });

  assert.equal(result.action, "respond");
  assert.match(result.responseText, /Usage:/);
});

test("registerCalypsoCommand registers /calypso and responds ephemerally", async () => {
  let commandName;
  let commandHandler;

  const app = {
    command(name, handler) {
      commandName = name;
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app);

  assert.equal(commandName, "/calypso");
  assert.equal(typeof commandHandler, "function");

  let ackCalled = false;
  let payload;

  await commandHandler({
    command: { text: "help", user_id: "U123" },
    ack: async () => {
      ackCalled = true;
    },
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(ackCalled, true);
  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /\/calypso help/);
  assert.match(payload.text, /\/calypso status/);
  assert.match(payload.text, /Modules/);
  assert.match(payload.text, /\/calypso help monitoring/);
  assert.match(payload.blocks[0].text.text, /Calypso help/);
  assert.ok(payload.blocks.some((block) => block.type === "divider"));
});

test("registerCalypsoCommand runs sync command and returns summary", async () => {
  let commandHandler;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    runOpenPullRequestSyncNowFn: async () => ({
      upsertedCount: 7,
      closedCount: 2,
      mergedUntestedCount: 3,
    }),
  });

  const responses = [];
  await commandHandler({
    command: { text: "sync", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      responses.push(message);
    },
  });

  assert.equal(responses.length, 2);
  assert.equal(responses[0].response_type, "ephemeral");
  assert.match(responses[0].text, /Syncing in progress/);
  assert.equal(responses[1].response_type, "ephemeral");
  assert.match(responses[1].text, /Open PR sync completed successfully/);
  assert.match(responses[1].text, /Review sync: upserted 7 open PR\(s\)/);
  assert.match(responses[1].text, /marked 2 stale PR\(s\) closed/);
  assert.match(responses[1].text, /Untested merge sync: upserted 3 merged untested PR\(s\)/);
});

test("registerCalypsoCommand reports sync unavailable when token is not configured", async () => {
  let commandHandler;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
  });

  const responses = [];
  await commandHandler({
    command: { text: "sync", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      responses.push(message);
    },
  });

  assert.equal(responses.length, 1);
  assert.equal(responses[0].response_type, "ephemeral");
  assert.match(responses[0].text, /Sync unavailable/);
  assert.match(responses[0].text, /CODE_HOST_TOKEN/);
});

test("registerCalypsoCommand returns sync failure details when manual sync throws", async () => {
  let commandHandler;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    runOpenPullRequestSyncNowFn: async () => {
      throw new Error("github rate limited");
    },
  });

  const responses = [];
  await commandHandler({
    command: { text: "sync", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      responses.push(message);
    },
  });

  assert.equal(responses.length, 2);
  assert.equal(responses[0].response_type, "ephemeral");
  assert.match(responses[0].text, /Syncing in progress/);
  assert.equal(responses[1].response_type, "ephemeral");
  assert.match(responses[1].text, /Open PR sync failed/);
  assert.match(responses[1].text, /github rate limited/);
});

test("registerCalypsoCommand denies sync for non-admin, non-whitelisted user", async () => {
  let commandHandler;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: false }),
    runOpenPullRequestSyncNowFn: async () => ({
      upsertedCount: 1,
      closedCount: 0,
    }),
  });

  let payload;
  await commandHandler({
    command: { text: "sync", user_id: "U123" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Sync denied/);
  assert.match(payload.text, /Only workspace admins or whitelisted users can run manual sync/);
});

test("registerCalypsoCommand handles status with injected db functions", async () => {
  let commandHandler;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    getLastProdDeployAtFn: async () => "2026-02-13T22:00:17.000Z",
    listBlockingPullRequestsFn: async () => [],
    readTimeFormatPreferenceFn: async () => "long",
  });

  let payload;

  await commandHandler({
    command: { text: "status", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /No blockers since last prod deploy/);
  assert.match(payload.text, /2026-02-13 22:00:17 UTC/);
});

test("registerCalypsoCommand status reports a production red channel topic", async () => {
  let commandHandler;
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };
  registerCalypsoCommand(app, {
    pool: {},
    getLastProdDeployAtFn: async () => "2026-07-28T16:35:00.000Z",
    listBlockingPullRequestsFn: async () => [],
    readTimeFormatPreferenceFn: async () => "long",
  });

  let payload;
  await commandHandler({
    command: {
      text: "status",
      user_id: "U123",
      channel_id: "CDEPLOY",
    },
    client: {
      conversations: {
        info: async () => ({
          channel: {
            topic: {
              value:
                "set the channel topic: Production: :red_circle: (Test) On Call/Support: Isaiah Week of July 26-August 1st.",
            },
          },
        }),
      },
    },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.match(payload.text, /Production deployment is blocked by the channel topic/);
  assert.match(payload.text, /No must-test PR blockers since last prod deploy/);
  assert.match(payload.blocks[0].text.text, /Production deploy is blocked/);
  const renderedBlocks = JSON.stringify(payload.blocks);
  assert.match(renderedBlocks, /Channel topic/);
  assert.match(renderedBlocks, /Blocked/);
  assert.match(renderedBlocks, /Must-test PRs/);
  assert.match(renderedBlocks, /Change the channel's Production topic marker from red/);
});

test("registerCalypsoCommand shows open waiting reviews without filters", async () => {
  let commandHandler;
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    listOpenPullRequestsWaitingOnReviewSinceFn: async () => [
      {
        repo: "croft-eng/croft",
        pr_number: 55,
        title: "Add observability",
        url: "https://github.com/croft-eng/croft/pull/55",
        author_login: "octocat",
        is_draft: false,
        review_state: "waiting",
        opened_for_review_at: "2026-02-13T22:00:17.000Z",
      },
    ],
    readTimeFormatPreferenceFn: async () => "human",
    readTimeZonePreferenceFn: async () => "America/New_York",
  });

  let payload;
  await commandHandler({
    command: { text: "reviews", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Open PRs waiting on review:/);
  assert.match(payload.text, /<https:\/\/github.com\/croft-eng\/croft\/pull\/55\|#55> - \*Add observability\*/);
  assert.match(payload.text, /author: octocat/);
  assert.match(payload.text, /review: waiting/);
  assert.match(payload.text, /codex: not approved/);
  assert.match(payload.text, /Last modified: 2\/13\/2026/);
});

test("registerCalypsoCommand filters waiting reviews by github user", async () => {
  let commandHandler;
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    listOpenPullRequestsWaitingOnReviewSinceFn: async () => [
      {
        repo: "croft-eng/croft",
        pr_number: 11,
        title: "One",
        url: "https://github.com/croft-eng/croft/pull/11",
        author_login: "octocat",
        is_draft: false,
        review_state: "waiting",
        opened_for_review_at: "2026-02-13T22:00:17.000Z",
      },
      {
        repo: "croft-eng/croft",
        pr_number: 12,
        title: "Two",
        url: "https://github.com/croft-eng/croft/pull/12",
        author_login: "hubot",
        is_draft: false,
        review_state: "approved",
        opened_for_review_at: "2026-02-13T22:00:17.000Z",
      },
    ],
    readTimeFormatPreferenceFn: async () => "long",
    readTimeZonePreferenceFn: async () => "America/New_York",
  });

  let payload;
  await commandHandler({
    command: { text: "reviews octocat", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /for github user octocat/);
  assert.match(payload.text, /<https:\/\/github.com\/croft-eng\/croft\/pull\/11\|#11> - \*One\*/);
  assert.doesNotMatch(payload.text, /<https:\/\/github.com\/croft-eng\/croft\/pull\/12\|#12> - \*Two\*/);
});

test("registerCalypsoCommand sorts waiting reviews most recent first", async () => {
  let commandHandler;
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    listOpenPullRequestsWaitingOnReviewSinceFn: async () => [
      {
        repo: "croft-eng/croft",
        pr_number: 55,
        title: "Older",
        url: "https://github.com/croft-eng/croft/pull/55",
        author_login: "octocat",
        is_draft: false,
        review_state: "waiting",
        opened_for_review_at: "2026-02-13T22:00:17.000Z",
      },
      {
        repo: "croft-eng/croft",
        pr_number: 56,
        title: "Newer",
        url: "https://github.com/croft-eng/croft/pull/56",
        author_login: "octocat",
        is_draft: false,
        review_state: "waiting",
        opened_for_review_at: "2026-02-14T22:00:17.000Z",
      },
    ],
    readTimeFormatPreferenceFn: async () => "human",
    readTimeZonePreferenceFn: async () => "America/New_York",
  });

  let payload;
  await commandHandler({
    command: { text: "reviews", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  const newerIndex = payload.text.indexOf("<https://github.com/croft-eng/croft/pull/56|#56>");
  const olderIndex = payload.text.indexOf("<https://github.com/croft-eng/croft/pull/55|#55>");
  assert.ok(newerIndex >= 0);
  assert.ok(olderIndex >= 0);
  assert.ok(newerIndex < olderIndex);
});

test("registerCalypsoCommand groups waiting reviews by last-modified age buckets", async () => {
  let commandHandler;
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };
  const dayInMilliseconds = 24 * 60 * 60 * 1000;
  const nowTimestamp = Date.now();
  const tenDaysAgo = new Date(nowTimestamp - (10 * dayInMilliseconds)).toISOString();
  const sixtyDaysAgo = new Date(nowTimestamp - (60 * dayInMilliseconds)).toISOString();
  const oneHundredTwentyDaysAgo = new Date(nowTimestamp - (120 * dayInMilliseconds)).toISOString();

  registerCalypsoCommand(app, {
    pool: {},
    listOpenPullRequestsWaitingOnReviewSinceFn: async () => [
      {
        repo: "croft-eng/croft",
        pr_number: 201,
        title: "Recent update",
        url: "https://github.com/croft-eng/croft/pull/201",
        author_login: "octocat",
        is_draft: false,
        review_state: "waiting",
        opened_for_review_at: tenDaysAgo,
        last_modified_at: tenDaysAgo,
      },
      {
        repo: "croft-eng/croft",
        pr_number: 202,
        title: "Mid-age update",
        url: "https://github.com/croft-eng/croft/pull/202",
        author_login: "octocat",
        is_draft: false,
        review_state: "waiting",
        opened_for_review_at: sixtyDaysAgo,
        last_modified_at: sixtyDaysAgo,
      },
      {
        repo: "croft-eng/croft",
        pr_number: 203,
        title: "Old update",
        url: "https://github.com/croft-eng/croft/pull/203",
        author_login: "octocat",
        is_draft: false,
        review_state: "waiting",
        opened_for_review_at: oneHundredTwentyDaysAgo,
        last_modified_at: oneHundredTwentyDaysAgo,
      },
    ],
    readTimeFormatPreferenceFn: async () => "human",
    readTimeZonePreferenceFn: async () => "America/New_York",
  });

  let payload;
  await commandHandler({
    command: { text: "reviews", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /\*Modified in the last month\*/);
  assert.match(payload.text, /\*Modified in the last 3 months\*/);
  assert.match(payload.text, /\*Modified 3\+ months ago\*/);

  const lastMonthIndex = payload.text.indexOf("*Modified in the last month*");
  const pr201Index = payload.text.indexOf("<https://github.com/croft-eng/croft/pull/201|#201>");
  const lastThreeMonthsIndex = payload.text.indexOf("*Modified in the last 3 months*");
  const pr202Index = payload.text.indexOf("<https://github.com/croft-eng/croft/pull/202|#202>");
  const threePlusMonthsIndex = payload.text.indexOf("*Modified 3+ months ago*");
  const pr203Index = payload.text.indexOf("<https://github.com/croft-eng/croft/pull/203|#203>");
  assert.ok(lastMonthIndex >= 0 && pr201Index > lastMonthIndex);
  assert.ok(lastThreeMonthsIndex > pr201Index && pr202Index > lastThreeMonthsIndex);
  assert.ok(threePlusMonthsIndex > pr202Index && pr203Index > threePlusMonthsIndex);
});

test("registerCalypsoCommand shows no-results message for reviews timeframe filter", async () => {
  let commandHandler;
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    listOpenPullRequestsWaitingOnReviewSinceFn: async () => [],
    readTimeFormatPreferenceFn: async () => "human",
    readTimeZonePreferenceFn: async () => "America/New_York",
  });

  let payload;
  await commandHandler({
    command: { text: "reviews week", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /No open PRs waiting on review in the last week/);
});

test("registerCalypsoCommand reports not found for tested command", async () => {
  let commandHandler;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    markPullRequestTestedFn: async () => ({ found: false }),
  });

  let payload;
  await commandHandler({
    command: { text: "tested 9999", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /PR #9999 not found/);
});

test("registerCalypsoCommand is idempotent for already tested PR", async () => {
  let commandHandler;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    markPullRequestTestedFn: async () => ({ found: true, alreadyTested: true }),
  });

  let payload;
  await commandHandler({
    command: { text: "tested 77", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /already marked tested/);
});

test("registerCalypsoCommand denies tested single for non-admin, non-whitelisted user", async () => {
  let commandHandler;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: false }),
  });

  let payload;
  await commandHandler({
    command: { text: "tested 77", user_id: "U123" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Tested update denied/);
});

test("registerCalypsoCommand marks all untested PRs as tested", async () => {
  let commandHandler;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    markAllUntestedPullRequestsTestedFn: async () => 3,
  });

  let payload;
  await commandHandler({
    command: { text: "tested all", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Marked 3 untested PR\(s\) as tested/);
});

test("registerCalypsoCommand denies tested all for non-admin, non-whitelisted user", async () => {
  let commandHandler;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: false }),
  });

  let payload;
  await commandHandler({
    command: { text: "tested all", user_id: "U123" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Tested update denied/);
});

test("registerCalypsoCommand marks PR as must-test for force deploy", async () => {
  let commandHandler;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    setPullRequestForceDeployBlockedFn: async () => ({ found: true, alreadySet: false }),
  });

  let payload;
  await commandHandler({
    command: { text: "must-test 77", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /PR #77 now requires testing before force deploy/);
});

test("registerCalypsoCommand denies must-test for non-admin, non-whitelisted user", async () => {
  let commandHandler;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: false }),
  });

  let payload;
  await commandHandler({
    command: { text: "must-test 77", user_id: "U123" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Must-test update denied/);
});

test("registerCalypsoCommand shows recently tested PRs for tested recent", async () => {
  let commandHandler;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    listRecentlyTestedPullRequestsFn: async () => [
      {
        repo: "croft-eng/croft",
        pr_number: 123,
        url: "https://github.com/croft-eng/croft/pull/123",
        status: "tested",
        tested_at: "2026-02-13T20:00:00.000Z",
        tested_by: "U123",
        title: "Patch release fix",
      },
    ],
  });

  let payload;
  await commandHandler({
    command: { text: "tested recent day", user_id: "U123" },
    client: {
      users: {
        info: async () => ({
          user: {
            profile: {
              display_name: "Willa",
            },
          },
        }),
      },
    },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /PRs tested in the last day/);
  assert.match(payload.text, /<https:\/\/github.com\/croft-eng\/croft\/pull\/123\|croft-eng\/croft#123>/);
  assert.match(payload.text, /tested by Willa on February 13th, 2026 at 3:00 PM EST/);
});

test("registerCalypsoCommand blocks deploy when a PR is explicitly marked must-test", async () => {
  let commandHandler;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    getLastProdDeployAtFn: async () => "1970-01-01T00:00:00.000Z",
    listBlockingPullRequestsFn: async () => [
      {
        force_deploy_blocked: true,
        repo: "croft-eng/croft",
        pr_number: 12,
        url: "https://github.com/croft-eng/croft/pull/12",
        status: "untested",
      },
    ],
    deployConfig: {},
  });

  let payload;
  await commandHandler({
    command: { text: "deploy prod", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Force deploy blocked/);
  assert.match(payload.text, /must-test and cannot be bypassed/);
  assert.match(payload.text, /<https:\/\/github.com\/croft-eng\/croft\/pull\/12\|croft-eng\/croft#12> \(untested\)/);
  assert.match(payload.text, /\/calypso must-test off <PR_NUMBER>/);
});

test("registerCalypsoCommand blocks prod deploy when channel topic marks production red", async () => {
  let commandHandler;
  let deployTriggered = false;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    triggerProdDeployFn: async () => {
      deployTriggered = true;
      return { externalDeployId: "dep-123" };
    },
    deployConfig: {
      digitaloceanToken: "token",
      doAppIdProd: "app-id-prod",
    },
  });

  let payload;
  await commandHandler({
    command: { text: "deploy prod", user_id: "U123", channel_id: "CDEPLOY" },
    client: {
      conversations: {
        info: async () => ({
          channel: {
            topic: {
              value: "Production: :red_circle: Staging: :large_green_circle:",
            },
          },
        }),
      },
    },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Cannot deploy to prod from this channel right now/);
  assert.match(payload.text, /Channel topic indicates deploy is not allowed/);
  assert.equal(deployTriggered, false);
});

test("registerCalypsoCommand blocks staging deploy when channel topic marks staging red", async () => {
  let commandHandler;
  let deployTriggered = false;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    triggerProdDeployFn: async () => {
      deployTriggered = true;
      return { externalDeployId: "dep-123" };
    },
    deployConfig: {
      digitaloceanToken: "token",
      doAppIdProd: "app-id-prod",
      deployStagingAppId: "app-id-staging",
    },
  });

  let payload;
  await commandHandler({
    command: { text: "deploy staging", user_id: "U123", channel_id: "CDEPLOY" },
    client: {
      conversations: {
        info: async () => ({
          channel: {
            topic: {
              value: "Production: :large_green_circle: Staging: 🔴",
            },
          },
        }),
      },
    },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Cannot deploy to staging from this channel right now/);
  assert.match(payload.text, /Channel topic indicates deploy is not allowed/);
  assert.match(payload.blocks[0].text.text, /Staging deployment unavailable/);
  assert.equal(deployTriggered, false);
});

test("registerCalypsoCommand denies deploy for non-admin, non-whitelisted user", async () => {
  let commandHandler;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: false }),
    getLastProdDeployAtFn: async () => "1970-01-01T00:00:00.000Z",
    listBlockingPullRequestsFn: async () => [],
    deployConfig: {},
  });

  let payload;
  await commandHandler({
    command: { text: "deploy prod", user_id: "U123" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Deploy denied/);
  assert.match(payload.text, /Only workspace admins or whitelisted users can deploy/);
});

test("registerCalypsoCommand rejects removed force deploy syntax", async () => {
  let commandHandler;
  let deployTriggered = false;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    triggerProdDeployFn: async () => {
      deployTriggered = true;
    },
  });

  let payload;
  await commandHandler({
    command: { text: "deploy prod force", user_id: "U123", user_name: "travis" },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Usage:/);
  assert.doesNotMatch(payload.text, /force/);
  assert.equal(deployTriggered, false);
});

test("registerCalypsoCommand triggers staging deploy without deploy-gate transaction", async () => {
  let commandHandler;
  let capturedDeployConfiguration;
  const queryCalls = [];

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };
  const pool = {
    async query(sql) {
      queryCalls.push(sql);
      return { rows: [] };
    },
  };

  registerCalypsoCommand(app, {
    pool,
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    triggerProdDeployFn: async (deployConfiguration) => {
      capturedDeployConfiguration = deployConfiguration;
      return { externalDeployId: "dep-stg-123" };
    },
    deployConfig: {
      digitaloceanToken: "token",
      doAppIdProd: "app-id-prod",
      deployStagingAppId: "app-id-staging",
    },
  });

  let payload;
  await commandHandler({
    command: { text: "deploy staging", user_id: "U123", user_name: "travis" },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "in_channel");
  assert.match(payload.text, /Deploy to staging is in progress \(id: dep-stg-123\)/);
  assert.match(payload.text, /Triggered by <@U123>/);
  assert.match(
    payload.blocks.find((block) => block.type === "context").elements[0].text,
    /handed off to the configured provider/,
  );
  assert.deepEqual(queryCalls, []);
  assert.equal(capturedDeployConfiguration.deployTargetEnvironment, "staging");
  assert.equal(capturedDeployConfiguration.deployProductionAppId, "app-id-staging");
});

test("registerCalypsoCommand deploy uses the configured default environment", async () => {
  let commandHandler;
  let capturedDeployConfiguration;
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    getRuntimeProviderConfigFn: async () => ({ deployEnvironment: "staging" }),
    triggerProdDeployFn: async (deployConfiguration) => {
      capturedDeployConfiguration = deployConfiguration;
      return { externalDeployId: null };
    },
    deployConfig: {
      digitaloceanToken: "token",
      deployStagingAppId: "app-id-staging",
    },
  });

  let payload;
  await commandHandler({
    command: { text: "deploy", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "in_channel");
  assert.match(payload.text, /Deploy to staging is in progress/);
  assert.equal(capturedDeployConfiguration.deployTargetEnvironment, "staging");
  assert.equal(capturedDeployConfiguration.deployProductionAppId, "app-id-staging");
});

test("registerCalypsoCommand deploy list returns the status response", async () => {
  let commandHandler;
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    getLastProdDeployAtFn: async () => "2026-07-01T12:00:00.000Z",
    listBlockingPullRequestsFn: async () => [],
    readTimeFormatPreferenceFn: async () => "long",
    readTimeZonePreferenceFn: async () => "UTC",
    formatStatusResponseFn: () => "status alias result",
  });

  let payload;
  await commandHandler({
    command: { text: "deploy list", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.equal(payload.text, "status alias result");
});

test("registerCalypsoCommand sends staging deployment completion follow-up with staging config", async () => {
  let commandHandler;
  let completionWaitConfig;
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    enableDeploymentCompletionNotifications: true,
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    triggerProdDeployFn: async () => ({ externalDeployId: "dep-stg-abc" }),
    waitForProdDeployCompletionFn: async (deployConfig) => {
      completionWaitConfig = deployConfig;
      return { id: "dep-stg-abc", phase: "ACTIVE" };
    },
    deployConfig: {
      digitaloceanToken: "token",
      doAppIdProd: "app-id-prod",
      deployStagingAppId: "app-id-staging",
      doDeploymentPollIntervalMs: 1,
      doDeploymentTimeoutMs: 1000,
    },
  });

  const responses = [];
  await commandHandler({
    command: { text: "deploy staging", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      responses.push(message);
    },
  });

  assert.equal(responses.length, 2);
  assert.equal(responses[0].response_type, "in_channel");
  assert.match(responses[0].text, /Deploy to staging is in progress \(id: dep-stg-abc\)/);
  assert.equal(responses[1].response_type, "in_channel");
  assert.match(
    responses[1].text,
    /Deployment dep-stg-abc finished successfully with phase ACTIVE/,
  );
  assert.match(responses[0].blocks[0].text.text, /Staging deployment started/);
  assert.match(responses[1].blocks[0].text.text, /Staging deployment complete/);
  assert.equal(completionWaitConfig.deployTargetEnvironment, "staging");
  assert.equal(completionWaitConfig.deployProductionAppId, "app-id-staging");
});

test("registerCalypsoCommand sends deployment completion follow-up when enabled", async () => {
  let commandHandler;
  let insertedDeployment;
  let markedPullRequests;
  let markedDeployedAt;
  let insertedWithClient;
  let markedWithClient;
  let transactionClientReleased = false;
  const queryCalls = [];
  const deployedPullRequests = [
    {
      repo: "croft-eng/croft",
      pr_number: 12,
      status: "tested",
      title: "Add deploy gate",
      url: "https://github.com/croft-eng/croft/pull/12",
      author_login: "octocat",
    },
    {
      repo: "croft-eng/croft",
      pr_number: 13,
      status: "tested",
      title: "Fix flaky test",
      url: "https://github.com/croft-eng/croft/pull/13",
      author_login: "hubot",
    },
  ];
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };
  const transactionClient = {
    async query(sql) {
      queryCalls.push(sql);
      return { rows: [] };
    },
    release() {
      transactionClientReleased = true;
    },
  };
  const pool = {
    async connect() {
      return transactionClient;
    },
  };

  registerCalypsoCommand(app, {
    enableDeploymentCompletionNotifications: true,
    pool,
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    getLastProdDeployAtFn: async () => "1970-01-01T00:00:00.000Z",
    listBlockingPullRequestsFn: async () => [],
    listDeployablePullRequestsForDeploymentFn: async () => deployedPullRequests,
    triggerProdDeployFn: async () => ({ externalDeployId: "dep-abc" }),
    insertDeploymentFn: async (client, deployment) => {
      insertedWithClient = client;
      insertedDeployment = deployment;
      return { deployed_at: deployment.deployedAt };
    },
    markPullRequestsDeployedFn: async (client, pullRequests, deployedAt) => {
      markedWithClient = client;
      markedPullRequests = pullRequests;
      markedDeployedAt = deployedAt;
      return {
        deployedPullRequestCount: pullRequests.length,
        deployedPullRequests: pullRequests.map((pullRequest) => ({
          ...pullRequest,
          deployed_at: deployedAt,
        })),
      };
    },
    waitForProdDeployCompletionFn: async () => ({ id: "dep-abc", phase: "ACTIVE" }),
    listGithubSlackUserMappingsFn: async () => new Map([["octocat", "U123ABC"]]),
    deployConfig: {
      digitaloceanToken: "token",
      doAppIdProd: "app-id",
      doDeploymentPollIntervalMs: 1,
      doDeploymentTimeoutMs: 1000,
    },
  });

  const responses = [];
  await commandHandler({
    command: { text: "deploy prod", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      responses.push(message);
    },
  });

  assert.equal(responses.length, 2);
  assert.equal(responses[0].response_type, "in_channel");
  assert.match(responses[0].text, /Deploy to prod is in progress \(id: dep-abc\)/);
  assert.match(responses[0].text, /PRs to deploy:/);
  assert.match(responses[0].text, /Add deploy gate> by <@U123ABC> \(tested\)\./);
  assert.doesNotMatch(responses[0].text, /Marked 2 PR\(s\) deployed/);
  assert.equal(responses[1].response_type, "in_channel");
  assert.match(
    responses[1].text,
    /Deployment dep-abc finished successfully with phase ACTIVE/,
  );
  assert.match(responses[1].text, /Marked 2 PR\(s\) deployed/);
  assert.match(responses[1].text, /Deployed PRs:/);
  assert.match(responses[1].text, /<https:\/\/github\.com\/croft-eng\/croft\/pull\/12\|Add deploy gate> by <@U123ABC> \(tested\)\./);
  assert.deepEqual(queryCalls, ["BEGIN", "COMMIT"]);
  assert.equal(insertedDeployment.externalDeployId, "dep-abc");
  assert.ok(insertedDeployment.deployedAt instanceof Date);
  assert.deepEqual(
    markedPullRequests,
    deployedPullRequests.map(({ status: _status, ...pullRequest }) => ({
      ...pullRequest,
      tested: true,
    })),
  );
  assert.equal(markedDeployedAt, insertedDeployment.deployedAt);
  assert.equal(insertedWithClient, transactionClient);
  assert.equal(markedWithClient, transactionClient);
  assert.equal(transactionClientReleased, true);
});

test("registerCalypsoCommand tags here when deployment completion fails", async () => {
  let commandHandler;
  let inserted = false;
  let marked = false;
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };
  const pool = {
    async query(sql) {
      if (sql === "BEGIN" || sql === "COMMIT") {
        return { rows: [] };
      }
      return { rows: [] };
    },
  };

  registerCalypsoCommand(app, {
    enableDeploymentCompletionNotifications: true,
    pool,
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    getLastProdDeployAtFn: async () => "1970-01-01T00:00:00.000Z",
    listBlockingPullRequestsFn: async () => [],
    listDeployablePullRequestsForDeploymentFn: async () => [],
    triggerProdDeployFn: async () => ({ externalDeployId: "dep-abc" }),
    insertDeploymentFn: async () => {
      inserted = true;
    },
    markPullRequestsDeployedFn: async () => {
      marked = true;
    },
    waitForProdDeployCompletionFn: async () => {
      throw new Error("deployment errored");
    },
    deployConfig: {
      digitaloceanToken: "token",
      doAppIdProd: "app-id",
      doDeploymentPollIntervalMs: 1,
      doDeploymentTimeoutMs: 1000,
    },
  });

  const responses = [];
  await commandHandler({
    command: { text: "deploy prod", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      responses.push(message);
    },
  });

  assert.equal(responses.length, 2);
  assert.equal(responses[1].response_type, "in_channel");
  assert.match(
    responses[1].text,
    /<!here> Deployment dep-abc failed after trigger: deployment errored/,
  );
  assert.match(responses[1].text, /No deploy records or PR statuses were committed/);
  assert.match(responses[1].blocks[0].text.text, /Deployment failed/);
  assert.match(
    responses[1].blocks.find((block) => block.type === "context").elements[0].text,
    /No deployment record or PR status was committed/,
  );
  assert.equal(inserted, false);
  assert.equal(marked, false);
});

test("registerCalypsoCommand does not finalize production deployment without external deployment id", async () => {
  let commandHandler;
  let inserted = false;
  let marked = false;
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    enableDeploymentCompletionNotifications: true,
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    getLastProdDeployAtFn: async () => "1970-01-01T00:00:00.000Z",
    listBlockingPullRequestsFn: async () => [],
    listDeployablePullRequestsForDeploymentFn: async () => [
      {
        repo: "croft-eng/croft",
        pr_number: 12,
        title: "Add deploy gate",
        url: "https://github.com/croft-eng/croft/pull/12",
        author_login: "octocat",
      },
    ],
    triggerProdDeployFn: async () => ({ externalDeployId: null }),
    insertDeploymentFn: async () => {
      inserted = true;
    },
    markPullRequestsDeployedFn: async () => {
      marked = true;
    },
    waitForProdDeployCompletionFn: async () => {
      throw new Error("should not wait without deployment id");
    },
    listGithubSlackUserMappingsFn: async () => new Map(),
    deployConfig: {
      digitaloceanToken: "token",
      doAppIdProd: "app-id",
    },
  });

  const responses = [];
  await commandHandler({
    command: { text: "deploy prod", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      responses.push(message);
    },
  });

  assert.equal(responses.length, 1);
  assert.equal(responses[0].response_type, "in_channel");
  assert.match(responses[0].text, /Deploy to prod is in progress \(id: n\/a\)/);
  assert.match(responses[0].text, /will not mark PRs deployed automatically/);
  assert.match(responses[0].text, /PRs to deploy:/);
  assert.equal(inserted, false);
  assert.equal(marked, false);
});

test("registerCalypsoCommand returns deploy not configured when clear", async () => {
  let commandHandler;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    getLastProdDeployAtFn: async () => "1970-01-01T00:00:00.000Z",
    listBlockingPullRequestsFn: async () => [],
    deployConfig: {},
  });

  let payload;
  await commandHandler({
    command: { text: "deploy prod", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /deploy not configured/i);
  assert.match(payload.blocks[0].text.text, /Production deployment is not configured/);
});

test("registerCalypsoCommand returns staging deploy not configured when staging app id is missing", async () => {
  let commandHandler;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    deployConfig: {
      digitaloceanToken: "token",
      doAppIdProd: "app-id-prod",
    },
  });

  let payload;
  await commandHandler({
    command: { text: "deploy staging", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Deploy to staging is not configured/);
  assert.match(payload.blocks[0].text.text, /Staging deployment is not configured/);
});

test("registerCalypsoCommand triggers deploy and reports planned PRs when clear and configured", async () => {
  let commandHandler;
  const queryCalls = [];
  const plannedPullRequests = [
    {
      repo: "croft-eng/croft",
      pr_number: 12,
      title: "Add deploy gate",
      url: "https://github.com/croft-eng/croft/pull/12",
      author_login: "octocat",
    },
    {
      repo: "croft-eng/croft",
      pr_number: 13,
      title: "Fix flaky test",
      url: "https://github.com/croft-eng/croft/pull/13",
      author_login: "hubot",
    },
  ];
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };
  const pool = {
    async query(sql) {
      queryCalls.push(sql);
      return { rows: [] };
    },
  };

  registerCalypsoCommand(app, {
    pool,
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    getLastProdDeployAtFn: async () => "1970-01-01T00:00:00.000Z",
    listBlockingPullRequestsFn: async () => [],
    listDeployablePullRequestsForDeploymentFn: async () => plannedPullRequests,
    triggerProdDeployFn: async () => ({ externalDeployId: "dep-123" }),
    waitForProdDeployCompletionFn: async () => new Promise(() => {}),
    listGithubSlackUserMappingsFn: async () => new Map([["octocat", "U123ABC"]]),
    deployConfig: {
      digitaloceanToken: "token",
      doAppIdProd: "app-id",
    },
  });

  let payload;
  await commandHandler({
    command: { text: "deploy prod", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "in_channel");
  assert.match(payload.text, /Deploy to prod is in progress/);
  assert.match(payload.text, /Triggered by <@U123>/);
  assert.doesNotMatch(payload.text, /Marked 2 PR\(s\) deployed/);
  assert.match(payload.text, /PRs to deploy:/);
  assert.match(payload.text, /<https:\/\/github\.com\/croft-eng\/croft\/pull\/12\|Add deploy gate> by <@U123ABC>\./);
  assert.match(
    payload.text,
    /<https:\/\/github\.com\/croft-eng\/croft\/pull\/13\|Fix flaky test> by hubot \(github username since no matching slack username\)\./,
  );
  assert.deepEqual(queryCalls, []);
});

test("registerCalypsoCommand formats mapped slack user IDs as uppercase mentions", async () => {
  let commandHandler;
  const queryCalls = [];
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };
  const pool = {
    async query(sql) {
      queryCalls.push(sql);
      return { rows: [] };
    },
  };

  registerCalypsoCommand(app, {
    pool,
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    getLastProdDeployAtFn: async () => "1970-01-01T00:00:00.000Z",
    listBlockingPullRequestsFn: async () => [],
    listDeployablePullRequestsForDeploymentFn: async () => [
      {
        repo: "croft-eng/croft",
        pr_number: 12,
        title: "Add deploy gate",
        url: "https://github.com/croft-eng/croft/pull/12",
        author_login: "octocat",
      },
    ],
    triggerProdDeployFn: async () => ({ externalDeployId: "dep-123" }),
    waitForProdDeployCompletionFn: async () => new Promise(() => {}),
    listGithubSlackUserMappingsFn: async () => new Map([["octocat", "u123abc"]]),
    deployConfig: {
      digitaloceanToken: "token",
      doAppIdProd: "app-id",
    },
  });

  let payload;
  await commandHandler({
    command: { text: "deploy prod", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "in_channel");
  assert.match(payload.text, /<https:\/\/github\.com\/croft-eng\/croft\/pull\/12\|Add deploy gate> by <@U123ABC>\./);
  assert.deepEqual(queryCalls, []);
});

test("registerCalypsoCommand does not mutate DB when deploy call fails", async () => {
  let commandHandler;
  let inserted = false;
  let marked = false;
  const queryCalls = [];
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };
  const pool = {
    async query(sql) {
      queryCalls.push(sql);
      return { rows: [] };
    },
  };

  registerCalypsoCommand(app, {
    pool,
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    getLastProdDeployAtFn: async () => "1970-01-01T00:00:00.000Z",
    listBlockingPullRequestsFn: async () => [],
    listDeployablePullRequestsForDeploymentFn: async () => [],
    triggerProdDeployFn: async () => {
      throw new Error("deploy failed");
    },
    insertDeploymentFn: async () => {
      inserted = true;
    },
    markPullRequestsDeployedFn: async () => {
      marked = true;
    },
    deployConfig: {
      digitaloceanToken: "token",
      doAppIdProd: "app-id",
    },
  });

  let payload;
  await commandHandler({
    command: { text: "deploy prod", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(inserted, false);
  assert.equal(marked, false);
  assert.deepEqual(queryCalls, []);
  assert.match(payload.text, /Deploy failed before deployment state was committed/);
});

test("registerCalypsoCommand reports rollback when deployment finalization transaction fails", async () => {
  let commandHandler;
  let marked = false;
  const queryCalls = [];
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };
  const pool = {
    async query(sql) {
      queryCalls.push(sql);
      return { rows: [] };
    },
  };

  registerCalypsoCommand(app, {
    enableDeploymentCompletionNotifications: true,
    pool,
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    getLastProdDeployAtFn: async () => "1970-01-01T00:00:00.000Z",
    listBlockingPullRequestsFn: async () => [],
    listDeployablePullRequestsForDeploymentFn: async () => [
      {
        repo: "croft-eng/croft",
        pr_number: 12,
        title: "Add deploy gate",
        url: "https://github.com/croft-eng/croft/pull/12",
        author_login: "octocat",
      },
    ],
    triggerProdDeployFn: async () => ({ externalDeployId: "dep-123" }),
    insertDeploymentFn: async () => {
      throw new Error("insert failed");
    },
    markPullRequestsDeployedFn: async () => {
      marked = true;
    },
    waitForProdDeployCompletionFn: async () => ({ id: "dep-123", phase: "ACTIVE" }),
    listGithubSlackUserMappingsFn: async () => new Map(),
    deployConfig: {
      digitaloceanToken: "token",
      doAppIdProd: "app-id",
    },
  });

  const responses = [];
  await commandHandler({
    command: { text: "deploy prod", user_id: "U123" },
    ack: async () => {},
    respond: async (message) => {
      responses.push(message);
    },
  });

  assert.equal(marked, false);
  assert.deepEqual(queryCalls, ["BEGIN", "ROLLBACK"]);
  assert.equal(responses.length, 2);
  assert.match(responses[1].text, /Deployment dep-123 finished/);
  assert.match(responses[1].text, /could not commit deployment state/);
  assert.match(responses[1].text, /Deployment state transaction rolled back/);
  assert.match(responses[1].text, /No deploy records or PR statuses were committed/);
});

test("registerCalypsoCommand whitelist command denies non-admin, non-whitelisted user", async () => {
  let commandHandler;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: false }),
  });

  let payload;
  await commandHandler({
    command: { text: "whitelist <@U999>", user_id: "U123" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Only workspace admins or whitelisted users can manage deploy whitelist/);
});

test("registerCalypsoCommand whitelist command adds user for admin", async () => {
  let commandHandler;
  const captured = {};

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true, source: "workspace_admin" }),
    isWorkspaceAdminFn: async () => true,
    addUserToDeployWhitelistFn: async (_pool, targetUserId, addedBy) => {
      captured.targetUserId = targetUserId;
      captured.addedBy = addedBy;
      return { added: true };
    },
  });

  let payload;
  await commandHandler({
    command: { text: "whitelist <@U999>", user_id: "UADMIN" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(captured.targetUserId, "U999");
  assert.equal(captured.addedBy, "UADMIN");
  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Added <@U999> to deploy whitelist/);
});

test("registerCalypsoCommand whitelist command adds user for whitelisted caller", async () => {
  let commandHandler;
  const captured = {};

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true, source: "deploy_whitelist" }),
    isWorkspaceAdminFn: async () => false,
    addUserToDeployWhitelistFn: async (_pool, targetUserId, addedBy) => {
      captured.targetUserId = targetUserId;
      captured.addedBy = addedBy;
      return { added: true };
    },
  });

  let payload;
  await commandHandler({
    command: { text: "whitelist <@U777>", user_id: "UWHITELISTED" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(captured.targetUserId, "U777");
  assert.equal(captured.addedBy, "UWHITELISTED");
  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Added <@U777> to deploy whitelist/);
});

test("registerCalypsoCommand whitelist command resolves @handle to user id", async () => {
  let commandHandler;
  const captured = {};

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true, source: "workspace_admin" }),
    isWorkspaceAdminFn: async () => true,
    addUserToDeployWhitelistFn: async (_pool, targetUserId, addedBy) => {
      captured.targetUserId = targetUserId;
      captured.addedBy = addedBy;
      return { added: true };
    },
  });

  let payload;
  await commandHandler({
    command: { text: "whitelist @travis", user_id: "UADMIN" },
    client: {
      users: {
        list: async () => ({
          members: [{ id: "U092UMU4T4Z", name: "travis", deleted: false }],
          response_metadata: {},
        }),
      },
    },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(captured.targetUserId, "U092UMU4T4Z");
  assert.equal(captured.addedBy, "UADMIN");
  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Added <@U092UMU4T4Z> to deploy whitelist/);
});

test("registerCalypsoCommand whitelist command reports unresolved @handle", async () => {
  let commandHandler;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true, source: "workspace_admin" }),
    isWorkspaceAdminFn: async () => true,
    addUserToDeployWhitelistFn: async () => {
      throw new Error("should not be called for unresolved handle");
    },
  });

  let payload;
  await commandHandler({
    command: { text: "whitelist @travis", user_id: "UADMIN" },
    client: {
      users: {
        list: async () => ({
          members: [{ id: "U111", name: "someone-else", deleted: false }],
          response_metadata: {},
        }),
      },
    },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Could not resolve `@travis`/);
});

test("registerCalypsoCommand whitelist command reports missing scope for @handle lookup", async () => {
  let commandHandler;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true, source: "workspace_admin" }),
    isWorkspaceAdminFn: async () => true,
    addUserToDeployWhitelistFn: async () => {
      throw new Error("should not be called when Slack user lookup is unauthorized");
    },
  });

  let payload;
  await commandHandler({
    command: { text: "whitelist @travis", user_id: "UADMIN" },
    client: {
      users: {
        list: async () => {
          const error = new Error("An API error occurred: missing_scope");
          error.data = {
            error: "missing_scope",
            needed: "users:read",
            provided: "commands,chat:write",
          };
          throw error;
        },
      },
    },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /missing_scope/);
  assert.match(payload.text, /users:read/);
  assert.match(payload.text, /\/calypso whitelist U123ABC/);
});

test("registerCalypsoCommand whitelist command returns usage for missing target user", async () => {
  let commandHandler;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true, source: "workspace_admin" }),
    isWorkspaceAdminFn: async () => true,
    addUserToDeployWhitelistFn: async () => {
      throw new Error("should not be called for invalid whitelist input");
    },
  });

  let payload;
  await commandHandler({
    command: { text: "whitelist", user_id: "UADMIN" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.equal(payload.text, "Usage: `/calypso whitelist <@USER>`");
});

test("registerCalypsoCommand config command updates time format", async () => {
  let commandHandler;
  const capturedCalls = [];

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    setConfiguredTimeFormatFn: async (pool, timeFormat, updatedBy) => {
      capturedCalls.push({ pool, timeFormat, updatedBy });
      return { time_format: timeFormat, updated_by: updatedBy };
    },
  });

  let payload;
  await commandHandler({
    command: { text: "config time-format:long", user_id: "UADMIN" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Updated your time format to `long`/);
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].timeFormat, "long");
  assert.equal(capturedCalls[0].updatedBy, "UADMIN");
});

test("registerCalypsoCommand config command denies non-admin, non-whitelisted user", async () => {
  let commandHandler;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: false }),
  });

  let payload;
  await commandHandler({
    command: { text: "config time-format:human", user_id: "U123" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Config update denied/);
});

test("registerCalypsoCommand config command returns usage when argument is missing", async () => {
  let commandHandler;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
  });

  let payload;
  await commandHandler({
    command: { text: "config", user_id: "UADMIN" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /^Usage:/);
  assert.match(payload.text, /`\/calypso config time-format:human`/);
  assert.match(payload.text, /`\/calypso config timezone:America\/New_York`/);
});

test("registerCalypsoCommand config command updates timezone when valid", async () => {
  let commandHandler;
  const capturedCalls = [];

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    isValidTimeZoneFn: () => true,
    setConfiguredTimeZoneFn: async (pool, timeZone, updatedBy) => {
      capturedCalls.push({ type: "user", pool, timeZone, updatedBy });
      return { timezone: timeZone, updated_by: updatedBy };
    },
    setReviewRecapTimeZoneFn: async (pool, timeZone, updatedBy) => {
      capturedCalls.push({ type: "recap", pool, timeZone, updatedBy });
      return { timezone: timeZone, updated_by: updatedBy };
    },
  });

  let payload;
  await commandHandler({
    command: { text: "config timezone:America/Los_Angeles", user_id: "UADMIN" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Timezone `America\/Los_Angeles` is valid/);
  assert.match(payload.text, /Updated timezone for human timestamps and review recap schedule/);
  assert.equal(capturedCalls.length, 2);
  assert.equal(capturedCalls[0].timeZone, "America/Los_Angeles");
  assert.equal(capturedCalls[0].updatedBy, "UADMIN");
  assert.equal(capturedCalls[1].timeZone, "America/Los_Angeles");
  assert.equal(capturedCalls[1].updatedBy, "UADMIN");
});

test("registerCalypsoCommand config command reports invalid timezone", async () => {
  let commandHandler;
  let setTimezoneCalled = false;

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    isValidTimeZoneFn: () => false,
    setConfiguredTimeZoneFn: async () => {
      setTimezoneCalled = true;
      return {};
    },
    setReviewRecapTimeZoneFn: async () => {
      setTimezoneCalled = true;
      return {};
    },
  });

  let payload;
  await commandHandler({
    command: { text: "config timezone:Mars/Olympus", user_id: "UADMIN" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Timezone `Mars\/Olympus` is invalid/);
  assert.equal(setTimezoneCalled, false);
});

test("registerCalypsoCommand config command updates github-slack user map", async () => {
  let commandHandler;
  const capturedCalls = [];

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    setGithubSlackUserMappingFn: async (pool, githubUsername, slackUsername, updatedBy) => {
      capturedCalls.push({ pool, githubUsername, slackUsername, updatedBy });
      return { github_username: githubUsername, slack_username: slackUsername, updated_by: updatedBy };
    },
  });

  let payload;
  await commandHandler({
    command: { text: "config github-slack-user-map:octocat=@willa", user_id: "UADMIN" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "in_channel");
  assert.match(payload.text, /Mapped GitHub user `octocat` to Slack user `@willa`/);
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].githubUsername, "octocat");
  assert.equal(capturedCalls[0].slackUsername, "willa");
  assert.equal(capturedCalls[0].updatedBy, "UADMIN");
});

test("registerCalypsoCommand config command updates github-slack user map with slack user id", async () => {
  let commandHandler;
  const capturedCalls = [];

  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    setGithubSlackUserMappingFn: async (pool, githubUsername, slackUsername, updatedBy) => {
      capturedCalls.push({ pool, githubUsername, slackUsername, updatedBy });
      return { github_username: githubUsername, slack_username: slackUsername, updated_by: updatedBy };
    },
  });

  let payload;
  await commandHandler({
    command: { text: "config github-slack-user-map:octocat=<@U123ABC>", user_id: "UADMIN" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "in_channel");
  assert.match(payload.text, /Mapped GitHub user `octocat` to Slack user `<@U123ABC>`/);
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].githubUsername, "octocat");
  assert.equal(capturedCalls[0].slackUsername, "U123ABC");
  assert.equal(capturedCalls[0].updatedBy, "UADMIN");
});

test("registerCalypsoCommand config command updates review recap channel", async () => {
  let commandHandler;
  const capturedCalls = [];
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    setReviewRecapChannelFn: async (pool, targetChannelId, updatedBy) => {
      capturedCalls.push({ pool, targetChannelId, updatedBy });
      return { target_channel_id: targetChannelId, updated_by: updatedBy };
    },
  });

  let payload;
  await commandHandler({
    command: { text: "config review-recap-channel:<#C999ABC|deploys>", user_id: "UADMIN" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "in_channel");
  assert.match(payload.text, /Updated review recap channel to <#C999ABC>/);
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].targetChannelId, "C999ABC");
  assert.equal(capturedCalls[0].updatedBy, "UADMIN");
});

test("registerCalypsoCommand config command resolves review recap channel name to channel id", async () => {
  let commandHandler;
  const capturedCalls = [];
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    setReviewRecapChannelFn: async (pool, targetChannelId, updatedBy) => {
      capturedCalls.push({ pool, targetChannelId, updatedBy });
      return { target_channel_id: targetChannelId, updated_by: updatedBy };
    },
  });

  let payload;
  await commandHandler({
    command: { text: "config review-recap-channel:social", user_id: "UADMIN" },
    client: {
      conversations: {
        list: async () => ({
          channels: [{ id: "C999ABC", name: "social" }],
          response_metadata: { next_cursor: "" },
        }),
      },
    },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "in_channel");
  assert.match(payload.text, /Updated review recap channel to <#C999ABC>/);
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].targetChannelId, "C999ABC");
  assert.equal(capturedCalls[0].updatedBy, "UADMIN");
});

test("registerCalypsoCommand config command resolves invoking channel name without conversations.list", async () => {
  let commandHandler;
  const capturedCalls = [];
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    setReviewRecapChannelFn: async (pool, targetChannelId, updatedBy) => {
      capturedCalls.push({ pool, targetChannelId, updatedBy });
      return { target_channel_id: targetChannelId, updated_by: updatedBy };
    },
  });

  let payload;
  await commandHandler({
    command: {
      text: "config review-recap-channel:new-channel",
      user_id: "UADMIN",
      channel_id: "C24680",
      channel_name: "new-channel",
    },
    client: {
      conversations: {
        info: async () => ({ channel: { id: "C24680", is_member: true } }),
      },
    },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "in_channel");
  assert.match(payload.text, /Updated review recap channel to <#C24680>/);
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].targetChannelId, "C24680");
  assert.equal(capturedCalls[0].updatedBy, "UADMIN");
});

test("registerCalypsoCommand config command reports channel access error when bot is not in channel", async () => {
  let commandHandler;
  let setChannelCalled = false;
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    botName: "Calypso",
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    setReviewRecapChannelFn: async () => {
      setChannelCalled = true;
      return {};
    },
  });

  let payload;
  await commandHandler({
    command: { text: "config review-recap-channel:<#C999ABC|social>", user_id: "UADMIN" },
    client: {
      conversations: {
        list: async () => ({
          channels: [{ id: "C999ABC", name: "social", is_member: false }],
          response_metadata: { next_cursor: "" },
        }),
      },
    },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Calypso is not in that channel/);
  assert.match(payload.text, /Invite Calypso to the channel/);
  assert.equal(setChannelCalled, false);
});

test("registerCalypsoCommand config command reports channel name resolution when list API is unavailable", async () => {
  let commandHandler;
  let setChannelCalled = false;
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    setReviewRecapChannelFn: async () => {
      setChannelCalled = true;
      return {};
    },
  });

  let payload;
  await commandHandler({
    command: { text: "config review-recap-channel:social", user_id: "UADMIN" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /Cannot resolve channel name `social`/);
  assert.match(payload.text, /Use a channel mention/i);
  assert.equal(setChannelCalled, false);
});

test("registerCalypsoCommand config command reports channel access verification failures", async () => {
  let commandHandler;
  let setChannelCalled = false;
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    botName: "Calypso",
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    setReviewRecapChannelFn: async () => {
      setChannelCalled = true;
      return {};
    },
  });

  let payload;
  await commandHandler({
    command: { text: "config review-recap-channel:<#C999ABC|social>", user_id: "UADMIN" },
    client: {
      conversations: {
        list: async () => {
          const error = new Error("An API error occurred: internal_error");
          error.data = { error: "internal_error" };
          throw error;
        },
      },
    },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /could not verify access/i);
  assert.match(payload.text, /internal_error/i);
  assert.equal(setChannelCalled, false);
});

test("registerCalypsoCommand config command reports missing scopes for channel access verification", async () => {
  let commandHandler;
  let setChannelCalled = false;
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    botName: "Calypso",
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    setReviewRecapChannelFn: async () => {
      setChannelCalled = true;
      return {};
    },
  });

  let payload;
  await commandHandler({
    command: { text: "config review-recap-channel:<#C999ABC|social>", user_id: "UADMIN" },
    client: {
      conversations: {
        list: async () => {
          const error = new Error("An API error occurred: missing_scope");
          error.data = {
            error: "missing_scope",
            needed: "channels:read,groups:read",
            provided: "chat:write,commands",
          };
          throw error;
        },
      },
    },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "ephemeral");
  assert.match(payload.text, /missing_scope/i);
  assert.match(payload.text, /channels:read, groups:read/i);
  assert.match(payload.text, /chat:write, commands/i);
  assert.equal(setChannelCalled, false);
});

test("registerCalypsoCommand config command updates review recap recency", async () => {
  let commandHandler;
  const capturedCalls = [];
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    setReviewRecapRecencyFn: async (pool, recencyValue, recencyUnit, updatedBy) => {
      capturedCalls.push({ pool, recencyValue, recencyUnit, updatedBy });
      return { recency_value: recencyValue, recency_unit: recencyUnit, updated_by: updatedBy };
    },
  });

  let payload;
  await commandHandler({
    command: { text: "config review-recap-recency:2w", user_id: "UADMIN" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "in_channel");
  assert.match(payload.text, /Updated review recap recency to `2w`/);
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].recencyValue, 2);
  assert.equal(capturedCalls[0].recencyUnit, "w");
  assert.equal(capturedCalls[0].updatedBy, "UADMIN");
});

test("registerCalypsoCommand config command updates review recap window", async () => {
  let commandHandler;
  const capturedCalls = [];
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    setReviewRecapScopeFn: async (pool, reviewScope, updatedBy) => {
      capturedCalls.push({ pool, reviewScope, updatedBy });
      return { review_scope: reviewScope, updated_by: updatedBy };
    },
  });

  let payload;
  await commandHandler({
    command: { text: "config review-recap-window:last-month", user_id: "UADMIN" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "in_channel");
  assert.match(payload.text, /Updated review recap window to `last month`/);
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].reviewScope, "month");
  assert.equal(capturedCalls[0].updatedBy, "UADMIN");
});

test("registerCalypsoCommand config command updates review recap schedule", async () => {
  let commandHandler;
  const capturedCalls = [];
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    setReviewRecapScheduleFn: async (pool, scheduleWeekday, scheduleTime, updatedBy) => {
      capturedCalls.push({ pool, scheduleWeekday, scheduleTime, updatedBy });
      return { schedule_weekday: scheduleWeekday, schedule_time: scheduleTime, updated_by: updatedBy };
    },
  });

  let payload;
  await commandHandler({
    command: { text: "config review-recap-schedule:tue@10:15", user_id: "UADMIN" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "in_channel");
  assert.match(payload.text, /Updated review recap schedule to `tue@10:15`/);
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].scheduleWeekday, "tue");
  assert.equal(capturedCalls[0].scheduleTime, "10:15");
  assert.equal(capturedCalls[0].updatedBy, "UADMIN");
});

test("registerCalypsoCommand config command updates daily review recap schedule", async () => {
  let commandHandler;
  const capturedCalls = [];
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    setReviewRecapScheduleFn: async (pool, scheduleWeekday, scheduleTime, updatedBy) => {
      capturedCalls.push({ pool, scheduleWeekday, scheduleTime, updatedBy });
      return { schedule_weekday: scheduleWeekday, schedule_time: scheduleTime, updated_by: updatedBy };
    },
  });

  let payload;
  await commandHandler({
    command: { text: "config review-recap-schedule:daily@09:00", user_id: "UADMIN" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "in_channel");
  assert.match(payload.text, /Updated review recap schedule to `daily@09:00`/);
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].scheduleWeekday, "daily");
  assert.equal(capturedCalls[0].scheduleTime, "09:00");
  assert.equal(capturedCalls[0].updatedBy, "UADMIN");
});

test("registerCalypsoCommand config command updates multi-time daily review recap schedule", async () => {
  let commandHandler;
  const capturedCalls = [];
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    setReviewRecapScheduleFn: async (pool, scheduleWeekday, scheduleTime, updatedBy) => {
      capturedCalls.push({ pool, scheduleWeekday, scheduleTime, updatedBy });
      return { schedule_weekday: scheduleWeekday, schedule_time: scheduleTime, updated_by: updatedBy };
    },
  });

  let payload;
  await commandHandler({
    command: { text: "config review-recap-schedule:daily@09:00,17:00", user_id: "UADMIN" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "in_channel");
  assert.match(payload.text, /Updated review recap schedule to `daily@09:00,17:00`/);
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].scheduleWeekday, "daily");
  assert.equal(capturedCalls[0].scheduleTime, "09:00,17:00");
  assert.equal(capturedCalls[0].updatedBy, "UADMIN");
});

test("registerCalypsoCommand config command updates review recap weekend delivery", async () => {
  let commandHandler;
  const capturedCalls = [];
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    setReviewRecapSendWeekendsFn: async (pool, sendOnWeekends, updatedBy) => {
      capturedCalls.push({ pool, sendOnWeekends, updatedBy });
      return { send_on_weekends: sendOnWeekends, updated_by: updatedBy };
    },
  });

  let payload;
  await commandHandler({
    command: { text: "config review-recap-send-weekends:off", user_id: "UADMIN" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "in_channel");
  assert.match(payload.text, /Updated review recap weekend sending to `off`/);
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].sendOnWeekends, false);
  assert.equal(capturedCalls[0].updatedBy, "UADMIN");
});

test("registerCalypsoCommand config command updates review recap holiday delivery", async () => {
  let commandHandler;
  const capturedCalls = [];
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    setReviewRecapSendHolidaysFn: async (pool, sendOnHolidays, updatedBy) => {
      capturedCalls.push({ pool, sendOnHolidays, updatedBy });
      return { send_on_holidays: sendOnHolidays, updated_by: updatedBy };
    },
  });

  let payload;
  await commandHandler({
    command: { text: "config review-recap-send-holidays:off", user_id: "UADMIN" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "in_channel");
  assert.match(payload.text, /Updated review recap holiday sending to `off`/);
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].sendOnHolidays, false);
  assert.equal(capturedCalls[0].updatedBy, "UADMIN");
});

test("registerCalypsoCommand config command updates communication provider", async () => {
  let commandHandler;
  const capturedCalls = [];
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    setConfiguredCommunicationProviderFn: async (pool, provider, updatedBy) => {
      capturedCalls.push({ pool, provider, updatedBy });
      return { communication_provider: provider, updated_by: updatedBy };
    },
  });

  let payload;
  await commandHandler({
    command: { text: "config communication-provider:slack", user_id: "UADMIN" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "in_channel");
  assert.match(payload.text, /Updated communication provider to `slack`/);
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].provider, "slack");
  assert.equal(capturedCalls[0].updatedBy, "UADMIN");
});

test("registerCalypsoCommand config command updates code-host provider", async () => {
  let commandHandler;
  const capturedCalls = [];
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    setConfiguredCodeHostProviderFn: async (pool, provider, updatedBy) => {
      capturedCalls.push({ pool, provider, updatedBy });
      return { code_host_provider: provider, updated_by: updatedBy };
    },
  });

  let payload;
  await commandHandler({
    command: { text: "config code-host-provider:github", user_id: "UADMIN" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "in_channel");
  assert.match(payload.text, /Updated code-host provider to `github`/);
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].provider, "github");
  assert.equal(capturedCalls[0].updatedBy, "UADMIN");
});

test("registerCalypsoCommand config command updates deploy provider", async () => {
  let commandHandler;
  const capturedCalls = [];
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    setConfiguredDeployProviderFn: async (pool, provider, updatedBy) => {
      capturedCalls.push({ pool, provider, updatedBy });
      return { deploy_provider: provider, updated_by: updatedBy };
    },
  });

  let payload;
  await commandHandler({
    command: { text: "config deploy-provider:digitalocean", user_id: "UADMIN" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "in_channel");
  assert.match(payload.text, /Updated deploy provider to `digitalocean`/);
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].provider, "digitalocean");
  assert.equal(capturedCalls[0].updatedBy, "UADMIN");
});

test("registerCalypsoCommand config command updates default deploy environment", async () => {
  let commandHandler;
  const capturedCalls = [];
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    setConfiguredDeployEnvironmentFn: async (pool, environment, updatedBy) => {
      capturedCalls.push({ pool, environment, updatedBy });
      return { deploy_environment: environment, updated_by: updatedBy };
    },
  });

  let payload;
  await commandHandler({
    command: { text: "config deploy-environment:staging", user_id: "UADMIN" },
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "in_channel");
  assert.match(payload.text, /Updated default deploy environment to `staging`/);
  assert.deepEqual(capturedCalls, [
    { pool: {}, environment: "staging", updatedBy: "UADMIN" },
  ]);
});

test("registerCalypsoCommand config command updates microsoft teams provider", async () => {
  let commandHandler;
  const capturedCalls = [];
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    setConfiguredCommunicationProviderFn: async (pool, provider, updatedBy) => {
      capturedCalls.push({ pool, provider, updatedBy });
      return { communication_provider: provider, updated_by: updatedBy };
    },
  });

  let payload;
  await commandHandler({
    command: { text: "config communication-provider:microsoft_teams", user_id: "UADMIN" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "in_channel");
  assert.match(payload.text, /Updated communication provider to `microsoft_teams`/);
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].provider, "microsoft_teams");
  assert.equal(capturedCalls[0].updatedBy, "UADMIN");
});

test("registerCalypsoCommand config command updates bitbucket code-host provider", async () => {
  let commandHandler;
  const capturedCalls = [];
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    setConfiguredCodeHostProviderFn: async (pool, provider, updatedBy) => {
      capturedCalls.push({ pool, provider, updatedBy });
      return { code_host_provider: provider, updated_by: updatedBy };
    },
  });

  let payload;
  await commandHandler({
    command: { text: "config code-host-provider:bitbucket", user_id: "UADMIN" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "in_channel");
  assert.match(payload.text, /Updated code-host provider to `bitbucket`/);
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].provider, "bitbucket");
  assert.equal(capturedCalls[0].updatedBy, "UADMIN");
});

test("registerCalypsoCommand config command updates aws deploy provider", async () => {
  let commandHandler;
  const capturedCalls = [];
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    setConfiguredDeployProviderFn: async (pool, provider, updatedBy) => {
      capturedCalls.push({ pool, provider, updatedBy });
      return { deploy_provider: provider, updated_by: updatedBy };
    },
  });

  let payload;
  await commandHandler({
    command: { text: "config deploy-provider:aws", user_id: "UADMIN" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "in_channel");
  assert.match(payload.text, /Updated deploy provider to `aws`/);
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].provider, "aws");
  assert.equal(capturedCalls[0].updatedBy, "UADMIN");
});

test("registerCalypsoCommand config command updates email provider", async () => {
  let commandHandler;
  const capturedCalls = [];
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    setConfiguredEmailProviderFn: async (pool, provider, updatedBy) => {
      capturedCalls.push({ pool, provider, updatedBy });
      return { email_provider: provider, updated_by: updatedBy };
    },
  });

  let payload;
  await commandHandler({
    command: { text: "config email-provider:outlook", user_id: "UADMIN" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "in_channel");
  assert.match(payload.text, /Updated email provider to `outlook`/);
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].provider, "outlook");
  assert.equal(capturedCalls[0].updatedBy, "UADMIN");
});

test("registerCalypsoCommand config command updates ai provider", async () => {
  let commandHandler;
  const capturedCalls = [];
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    setConfiguredAiProviderFn: async (pool, provider, updatedBy) => {
      capturedCalls.push({ pool, provider, updatedBy });
      return { ai_provider: provider, updated_by: updatedBy };
    },
  });

  let payload;
  await commandHandler({
    command: { text: "config ai-provider:anthropic", user_id: "UADMIN" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "in_channel");
  assert.match(payload.text, /Updated ai provider to `anthropic`/);
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].provider, "anthropic");
  assert.equal(capturedCalls[0].updatedBy, "UADMIN");
});

test("registerCalypsoCommand config command updates error-tracking provider", async () => {
  let commandHandler;
  const capturedCalls = [];
  const app = {
    command(_name, handler) {
      commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, {
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    setConfiguredErrorTrackingProviderFn: async (pool, provider, updatedBy) => {
      capturedCalls.push({ pool, provider, updatedBy });
      return { error_tracking_provider: provider, updated_by: updatedBy };
    },
  });

  let payload;
  await commandHandler({
    command: { text: "config error-tracking-provider:rollbar", user_id: "UADMIN" },
    client: {},
    ack: async () => {},
    respond: async (message) => {
      payload = message;
    },
  });

  assert.equal(payload.response_type, "in_channel");
  assert.match(payload.text, /Updated error-tracking provider to `rollbar`/);
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].provider, "rollbar");
  assert.equal(capturedCalls[0].updatedBy, "UADMIN");
});
