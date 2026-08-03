const assert = require("node:assert/strict");
const test = require("node:test");

const { registerCalypsoCommand } = require("../../src/commands/command_router");

function buildRegisteredHandler(options) {
  let handler;
  registerCalypsoCommand({
    command(_name, registeredHandler) {
      handler = registeredHandler;
    },
  }, options);
  return handler;
}

async function runCommand(handler, text) {
  let payload;
  await handler({
    ack: async () => {},
    client: null,
    command: { text, user_id: "UADMIN" },
    respond: async (response) => {
      payload = response;
    },
  });
  return payload;
}

test("gate close persists an audited reason and announces the transition", async () => {
  const writes = [];
  const handler = buildRegisteredHandler({
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    getDeploymentGateStateFn: async () => null,
    setDeploymentGateStateWithAuditFn: async (_pool, change) => {
      writes.push(change);
      return {
        state: {
          changed_by: change.actorUserId,
          environment: change.environment,
          reason: change.reason,
          status: change.status,
        },
      };
    },
    updateCurrentChannelTopicFn: async () => true,
  });

  const payload = await runCommand(handler, "gate close prod Incident in progress");

  assert.equal(payload.response_type, "in_channel");
  assert.match(payload.text, /gate closed by UADMIN/);
  assert.equal(writes[0].status, "closed");
  assert.equal(writes[0].reason, "Incident in progress");
  assert.ok(payload.blocks.some((block) => block.type === "actions"));
});

test("history renders audited gate and deployment events", async () => {
  const handler = buildRegisteredHandler({
    communicationProvider: "slack",
    pool: {},
    listAuditEventsFn: async () => [
      {
        actor_user_id: "U092UMU4T4Z",
        created_at: "2026-07-28T20:33:00.000Z",
        metadata: {
          deployedPullRequestCount: 4,
          externalDeploymentId: "9fc5cf12-b518-40a2-900b-e46edd19f5b8",
          runId: 1,
        },
        summary: "Production deployment run #1 succeeded.",
      },
      {
        actor_user_id: "U092UMU4T4Z",
        created_at: "2026-07-28T20:24:00.000Z",
        summary: "Production deployment run #1 triggered.",
      },
      {
        actor_user_id: "U092UMU4T4Z",
        created_at: "2026-07-28T20:24:00.000Z",
        summary: "Production deployment run #1 reserved.",
      },
    ],
  });

  const payload = await runCommand(handler, "history prod");
  const eventBlocks = payload.blocks.filter(
    (block) =>
      block.type === "section"
      && block.text?.text.includes("Production deployment run #1"),
  );

  assert.equal(eventBlocks.length, 3);
  assert.match(eventBlocks[0].text.text, /by <@U092UMU4T4Z>/);
  assert.doesNotMatch(eventBlocks[0].text.text, /by U092UMU4T4Z/);
  assert.doesNotMatch(eventBlocks[0].text.text, /triggered/);
  assert.match(
    eventBlocks[0].text.text,
    /by <@U092UMU4T4Z> · .+\ndeployment 9fc5cf12-b518-40a2-900b-e46edd19f5b8 · run #1 · 4 PR\(s\)/,
  );
});

test("gate status reports the actual channel-topic fallback", async () => {
  const handler = buildRegisteredHandler({
    getDeploymentGateStateFn: async () => null,
    pool: {},
    resolveCurrentChannelTopicFn: async () => "Production: :red_circle:",
  });

  const payload = await runCommand(handler, "gate status prod");

  assert.match(payload.text, /gate is closed from the channel-topic fallback/);
  assert.match(JSON.stringify(payload.blocks), /channel-topic fallback is closed/);
});

test("doctor renders operational checks without leaking secrets", async () => {
  const handler = buildRegisteredHandler({
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    runDoctorDiagnosticsFn: async () => [
      { label: "Database", status: "ok", detail: "Connected." },
      { label: "Deploy provider", status: "warning", detail: "Target missing." },
    ],
  });

  const payload = await runCommand(handler, "doctor");

  assert.match(payload.text, /1 Code Conductor diagnostic check/);
  assert.match(JSON.stringify(payload.blocks), /Target missing/);
});

test("explicit open gate overrides a red fallback topic in status", async () => {
  const handler = buildRegisteredHandler({
    enableGateControl: true,
    pool: {},
    getActiveDeploymentRunFn: async () => null,
    getDeploymentGateStateFn: async () => ({ status: "open" }),
    getLastProdDeployAtFn: async () => "2026-07-28T12:00:00.000Z",
    listBlockingPullRequestsFn: async () => [],
  });

  let payload;
  await handler({
    ack: async () => {},
    client: {
      conversations: {
        info: async () => ({ channel: { topic: { value: "Production: :red_circle:" } } }),
      },
    },
    command: { channel_id: "C1", text: "status", user_id: "UADMIN" },
    respond: async (response) => {
      payload = response;
    },
  });

  assert.match(payload.blocks[0].text.text, /Production deploy is clear/);
  assert.match(JSON.stringify(payload.blocks), /Open \(explicit\)/);
});

test("active deployment blocks a second deploy before provider trigger", async () => {
  let triggered = false;
  const handler = buildRegisteredHandler({
    deployConfig: { digitaloceanToken: "token", doAppIdProd: "prod-app" },
    enableGateControl: true,
    getActiveDeploymentRunFn: async () => ({ id: 91 }),
    getDeploymentGateStateFn: async () => ({ status: "open" }),
    getLastProdDeployAtFn: async () => new Date(0),
    listBlockingPullRequestsFn: async () => [],
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    triggerProdDeployFn: async () => {
      triggered = true;
    },
  });

  const payload = await runCommand(handler, "deploy prod");

  assert.match(payload.text, /run #91 is already active/);
  assert.equal(triggered, false);
});

test("production deploy bypasses ordinary untested PRs", async () => {
  let deploymentPlanOptions;
  const handler = buildRegisteredHandler({
    createDeploymentConfirmationFn: async () => ({
      expires_at: "2026-07-28T18:10:00.000Z",
      token: "confirm-token",
    }),
    deployConfig: { digitaloceanToken: "token", doAppIdProd: "prod-app" },
    enableGateControl: true,
    getActiveDeploymentRunFn: async () => null,
    getDeploymentGateStateFn: async () => ({ status: "open" }),
    getLastProdDeployAtFn: async () => new Date(0),
    listBlockingPullRequestsFn: async () => [{
      force_deploy_blocked: false,
      pr_number: 3958,
      repo: "croft-eng/croft",
      status: "untested",
    }],
    listDeployablePullRequestsForDeploymentFn: async (
      _pool,
      _lastDeployAt,
      _deploymentCutoffAt,
      options,
    ) => {
      deploymentPlanOptions = options;
      return [];
    },
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
  });

  const payload = await runCommand(handler, "deploy prod");

  assert.match(payload.text, /ready for confirmation/);
  assert.match(JSON.stringify(payload.blocks), /deploy prod confirm confirm-token/);
  assert.doesNotMatch(payload.text, /Deploy blocked due to untested PRs/);
  assert.deepEqual(deploymentPlanOptions, { includeUntested: true });
});

test("production deploy rechecks must-test state from the deployment plan", async () => {
  let confirmationCreated = false;
  const handler = buildRegisteredHandler({
    createDeploymentConfirmationFn: async () => {
      confirmationCreated = true;
      return { token: "should-not-be-created" };
    },
    deployConfig: { digitaloceanToken: "token", doAppIdProd: "prod-app" },
    enableGateControl: true,
    getActiveDeploymentRunFn: async () => null,
    getDeploymentGateStateFn: async () => ({ status: "open" }),
    getLastProdDeployAtFn: async () => new Date(0),
    listBlockingPullRequestsFn: async () => [{
      force_deploy_blocked: false,
      pr_number: 3958,
      repo: "croft-eng/croft",
      status: "untested",
    }],
    listDeployablePullRequestsForDeploymentFn: async () => [{
      force_deploy_blocked: true,
      pr_number: 3958,
      repo: "croft-eng/croft",
      status: "untested",
    }],
    pool: {},
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
  });

  const payload = await runCommand(handler, "deploy prod");

  assert.match(payload.text, /Force deploy blocked/);
  assert.match(payload.text, /must-test and cannot be bypassed/);
  assert.equal(confirmationCreated, false);
});

test("Slack action values execute through the same command router", async () => {
  let actionHandler;
  registerCalypsoCommand({
    action(_pattern, handler) {
      actionHandler = handler;
    },
    command() {},
  }, { pool: {} });

  let payload;
  await actionHandler({
    ack: async () => {},
    action: { value: "help" },
    body: { channel: { id: "C1" }, user: { id: "U1" } },
    client: null,
    respond: async (response) => {
      payload = response;
    },
  });

  assert.match(payload.text, /\/conductor status/);
  assert.match(payload.blocks[0].text.text, /Code Conductor help/);
});

test("confirmed production deploy posts its announcement publicly to the Slack channel", async () => {
  let actionHandler;
  const actionResponses = [];
  registerCalypsoCommand({
    action(_pattern, handler) {
      actionHandler = handler;
    },
    command() {},
  }, {
    communicationProvider: "slack",
    consumeDeploymentConfirmationFn: async (_pool, confirmation) => confirmation,
    deployConfig: { digitaloceanToken: "token", doAppIdProd: "prod-app" },
    enableGateControl: true,
    getActiveDeploymentRunFn: async () => null,
    getDeploymentGateStateFn: async () => ({ status: "open" }),
    getLastProdDeployAtFn: async () => new Date(0),
    insertAuditEventFn: async () => {},
    listBlockingPullRequestsFn: async () => [],
    listDeployablePullRequestsForDeploymentFn: async () => [],
    markDeploymentRunTriggeredFn: async () => {},
    pool: {},
    reserveDeploymentRunFn: async () => ({ acquired: true, run: { id: 12 } }),
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    triggerProdDeployFn: async () => ({ externalDeployId: null }),
  });

  await actionHandler({
    ack: async () => {},
    action: { value: "deploy prod confirm confirm-token" },
    body: { channel: { id: "C_DEPLOYS" }, user: { id: "UADMIN" } },
    client: {},
    respond: async (response) => {
      actionResponses.push(response);
    },
  });

  assert.equal(actionResponses.length, 1);
  assert.equal(actionResponses[0].response_type, "in_channel");
  assert.equal(actionResponses[0].replace_original, false);
  assert.match(actionResponses[0].blocks[0].text.text, /Production deployment started/);
});

test("production deploy requires a user-bound server-side confirmation", async () => {
  let triggerCount = 0;
  const handler = buildRegisteredHandler({
    consumeDeploymentConfirmationFn: async (_pool, confirmation) =>
      confirmation.token === "confirm-token" ? confirmation : null,
    createDeploymentConfirmationFn: async () => ({
      expires_at: "2026-07-28T18:10:00.000Z",
      token: "confirm-token",
    }),
    deployConfig: { digitaloceanToken: "token", doAppIdProd: "prod-app" },
    enableGateControl: true,
    getActiveDeploymentRunFn: async () => null,
    getDeploymentGateStateFn: async () => ({ status: "open" }),
    getLastProdDeployAtFn: async () => new Date(0),
    insertAuditEventFn: async () => {},
    listBlockingPullRequestsFn: async () => [],
    listDeployablePullRequestsForDeploymentFn: async () => [],
    markDeploymentRunTriggeredFn: async () => {},
    pool: {},
    reserveDeploymentRunFn: async () => ({ acquired: true, run: { id: 12 } }),
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    triggerProdDeployFn: async () => {
      triggerCount += 1;
      return { externalDeployId: null };
    },
  });

  const preview = await runCommand(handler, "deploy prod");
  assert.equal(triggerCount, 0);
  assert.match(preview.text, /ready for confirmation/);
  assert.match(JSON.stringify(preview.blocks), /deploy prod confirm confirm-token/);

  const confirmed = await runCommand(handler, "deploy prod confirm confirm-token");
  assert.equal(triggerCount, 1);
  assert.match(confirmed.text, /Deploy to prod is in progress/);
});

test("post-trigger bookkeeping failures do not release the active deployment run", async () => {
  let completed = false;
  const handler = buildRegisteredHandler({
    completeDeploymentRunFn: async () => {
      completed = true;
    },
    consumeDeploymentConfirmationFn: async (_pool, confirmation) => confirmation,
    deployConfig: { digitaloceanToken: "token", doAppIdProd: "prod-app" },
    enableGateControl: true,
    getActiveDeploymentRunFn: async () => null,
    getDeploymentGateStateFn: async () => ({ status: "open" }),
    getLastProdDeployAtFn: async () => new Date(0),
    insertAuditEventFn: async () => {},
    listBlockingPullRequestsFn: async () => [],
    listDeployablePullRequestsForDeploymentFn: async () => [],
    markDeploymentRunTriggeredFn: async () => {
      throw new Error("tracking write failed");
    },
    pool: {},
    reserveDeploymentRunFn: async () => ({ acquired: true, run: { id: 44 } }),
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    triggerProdDeployFn: async () => ({ externalDeployId: null }),
  });

  const payload = await runCommand(handler, "deploy prod confirm valid-token");

  assert.match(payload.text, /accepted by the provider/);
  assert.match(payload.text, /post-trigger tracking error/);
  assert.equal(completed, false);
});
