const assert = require("node:assert/strict");
const test = require("node:test");

const { registerCalypsoCommand } = require("../../src/commands/command_router");

test("high-level command lifecycle: status -> confirmed deploy -> status", async () => {
  const state = createInMemoryState();
  const { app, commandHandler } = createCommandHandler({
    enableDeploymentCompletionNotifications: true,
    enableGateControl: true,
    pool: createPoolTransactionRecorder(state),
    consumeDeploymentConfirmationFn: async (_pool, confirmation) => confirmation,
    getActiveDeploymentRunFn: async () => null,
    getDeploymentGateStateFn: async () => ({ status: "open" }),
    insertAuditEventFn: async () => {},
    markDeploymentRunTriggeredFn: async () => {},
    reserveDeploymentRunFn: async () => ({ acquired: true, run: { id: 248 } }),
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    deployConfig: {
      digitaloceanToken: "token",
      doAppIdProd: "app",
    },
    getLastProdDeployAtFn: async () => state.lastProductionDeploymentAt,
    getEnvironmentStatusConfigFn: async () => ({
      enabled: true,
      lastCheckedAt: new Date("2026-02-13T18:05:10.000Z"),
      lastHttpStatus: 200,
      lastObservedState: "healthy",
    }),
    listBlockingPullRequestsFn: async (_pool, lastDeployAt) =>
      state.pullRequests.filter(
        (pr) =>
          pr.merged_at > lastDeployAt && pr.status !== "tested" && pr.status !== "deployed",
      ),
    listDeployablePullRequestsForDeploymentFn: async (
      _pool,
      lastDeployAt,
      deploymentCutoffAt,
      { includeUntested } = {},
    ) =>
      state.pullRequests
        .filter(
          (pr) =>
            pr.merged_at > lastDeployAt &&
            pr.merged_at <= deploymentCutoffAt &&
            (pr.status === "tested" || (includeUntested && pr.status === "untested")),
        )
        .map(mapPullRequestForDeployment),
    markPullRequestTestedFn: async (_pool, prNumber, testedBy) => {
      const pullRequest = state.pullRequests.find((pr) => pr.pr_number === prNumber);
      if (!pullRequest) {
        return { found: false };
      }
      if (pullRequest.status === "tested") {
        return { found: true, alreadyTested: true, pullRequest };
      }
      pullRequest.status = "tested";
      pullRequest.tested_by = testedBy;
      pullRequest.tested_at = new Date("2026-02-13T18:00:00.000Z");
      return { found: true, alreadyTested: false, pullRequest };
    },
    triggerProdDeployFn: async () => ({ externalDeployId: "dep-999" }),
    waitForProdDeployCompletionFn: async () => ({ id: "dep-999", phase: "ACTIVE" }),
    completeDeploymentRunFn: async () => ({
      id: 248,
      provider: "digitalocean",
      started_at: new Date("2026-02-13T18:00:48.000Z"),
      completed_at: new Date("2026-02-13T18:05:00.000Z"),
    }),
    insertDeploymentFn: async (_pool, deployment) => {
      const deploymentRecord = {
        deployed_at: deployment.deployedAt,
      };
      state.lastProductionDeploymentAt = deploymentRecord.deployed_at;
      state.deployments.push(deploymentRecord);
      return deploymentRecord;
    },
    listGithubSlackUserMappingsFn: async () => new Map([["octocat", "U123ABC"]]),
    markPullRequestsDeployedFn: async (_pool, plannedPullRequests, deployedAt) => {
      const deployedPullRequests = [];

      for (const plannedPullRequest of plannedPullRequests) {
        const pullRequest = state.pullRequests.find(
          (candidate) =>
            candidate.repo === plannedPullRequest.repo &&
            candidate.pr_number === plannedPullRequest.pr_number,
        );
        if (pullRequest && (pullRequest.status === "tested" || pullRequest.status === "untested")) {
          pullRequest.status = "deployed";
          pullRequest.deployed_at = deployedAt;
          deployedPullRequests.push(mapPullRequestForDeployment(pullRequest));
        }
      }

      return {
        deployedPullRequestCount: deployedPullRequests.length,
        deployedPullRequests,
      };
    },
  });

  assert.equal(app.commandName, "/conductor");

  const statusBefore = await runSlashCommand(commandHandler, "status", "U_TESTER");
  const deployResponses = await runSlashCommandResponses(
    commandHandler,
    "deploy prod confirm confirm-token",
    "U_TESTER",
  );
  const deployStarted = deployResponses[0];
  const deploySuccess = deployResponses[1];
  const statusAfter = await runSlashCommand(commandHandler, "status", "U_TESTER");

  assert.match(readResponseText(statusBefore), /No blockers since last prod deploy/);
  assert.match(readResponseText(statusBefore), /1 ordinary untested PR\(s\) will be included by force deploy/);
  assert.equal(statusBefore.attachments[0].color, "#2EB67D");
  const statusBeforeBlocks = readSlackBlocks(statusBefore);
  assert.equal(statusBeforeBlocks[0].type, "header");
  assert.equal(statusBeforeBlocks[0].text.text, "✅ Production readiness");
  assert.match(
    statusBeforeBlocks.find((block) => block.type === "section" && block.text)?.text.text,
    /Ready to deploy/,
  );
  assert.match(JSON.stringify(statusBeforeBlocks), /Production app/);
  assert.match(JSON.stringify(statusBeforeBlocks), /Healthy/);
  assert.match(JSON.stringify(statusBeforeBlocks), /Feature PR/);
  assert.match(JSON.stringify(statusBeforeBlocks), /Untested/);
  assert.match(JSON.stringify(statusBeforeBlocks), /Review deployment/);

  assert.equal(deployStarted.response_type, "in_channel");
  assert.match(readResponseText(deployStarted), /Deploy to prod is in progress \(id: dep-999\)/);
  assert.match(readResponseText(deployStarted), /Triggered by <@U_TESTER>/);
  assert.match(readResponseText(deployStarted), /PRs to deploy:/);
  assert.match(readResponseText(deployStarted), /Feature PR> by <@U123ABC>\./);
  assert.doesNotMatch(readResponseText(deployStarted), /Marked 1 PR\(s\) deployed/);
  const deployStartedBlocks = readSlackBlocks(deployStarted);
  assert.equal(deployStartedBlocks[0].text.text, "🚀 Production deployment started");
  assert.match(deployStartedBlocks[1].text.text, /Production is now deploying/);
  assert.equal((JSON.stringify(deployStartedBlocks).match(/🚀/g) || []).length, 1);
  const changesIncludedBlock = deployStartedBlocks.find(
    (block) =>
      block.type === "section"
      && block.text?.text.includes("Changes included"),
  );
  assert.match(
    changesIncludedBlock.text.text,
    /<https:\/\/github\.com\/croft-eng\/croft\/pull\/700\|Feature PR> by <@U123ABC> · croft-eng\/croft#700 · Included/,
  );
  assert.equal(
    deployStartedBlocks.filter((block) =>
      block.type === "section" && block.fields?.some((field) => field.text.includes("Feature PR"))
    ).length,
    0,
  );
  assert.equal(deploySuccess.response_type, "in_channel");
  assert.match(readResponseText(deploySuccess), /Deployment dep-999 finished successfully with phase ACTIVE/);
  assert.match(readResponseText(deploySuccess), /Marked 1 PR\(s\) deployed/);
  assert.match(readResponseText(deploySuccess), /Deployed PRs:/);
  assert.match(
    readResponseText(deploySuccess),
    /<https:\/\/github\.com\/croft-eng\/croft\/pull\/700\|Feature PR> by <@U123ABC>\./,
  );
  const deploySuccessBlocks = readSlackBlocks(deploySuccess);
  assert.equal(deploySuccessBlocks[0].text.text, "✅ Production deployment complete");
  assert.match(deploySuccessBlocks[1].text.text, /\*Live\*  •  Deployment completed/);
  assert.equal(deploySuccessBlocks[2].type, "divider");
  const deploymentSummaryBlock = deploySuccessBlocks.find((block) =>
    block.type === "section"
      && block.fields?.some((field) => field.text.includes("Deployment details")),
  );
  assert.equal(deploymentSummaryBlock.fields.length, 2);
  assert.match(deploymentSummaryBlock.fields[0].text, /🔀 1 pull request/);
  assert.match(deploymentSummaryBlock.fields[0].text, /🏗️ DigitalOcean · Deployment dep-999/);
  assert.match(deploymentSummaryBlock.fields[0].text, /🕒 Completed in 4m 12s/);
  assert.match(deploymentSummaryBlock.fields[1].text, /Production health/);
  assert.match(deploymentSummaryBlock.fields[1].text, /✅ Healthy · HTTP 200/);
  assert.doesNotMatch(JSON.stringify(deploySuccessBlocks), /Provider status/);
  const deploymentFooter = deploySuccessBlocks.find((block) =>
    block.type === "section" && block.accessory?.action_id === "calypso:history_prod",
  );
  assert.equal(deploySuccessBlocks[deploySuccessBlocks.indexOf(deploymentFooter) - 1].type, "divider");
  assert.match(deploymentFooter.text.text, /Monitoring continues automatically/);
  assert.equal(deploymentFooter.accessory.text.text, "View deployment history");
  assert.match(readResponseText(statusAfter), /No blockers since last prod deploy/);
  assert.equal(readSlackBlocks(statusAfter)[0].text.text, "✅ Production readiness");

  assert.deepEqual(state.transactionStatements, ["BEGIN", "COMMIT"]);
  assert.equal(state.deployments.length, 1);
  assert.equal(state.pullRequests[0].status, "deployed");
  assert.equal(state.pullRequests[0].tested_by, undefined);
});

function mapPullRequestForDeployment(pullRequest) {
  return {
    repo: pullRequest.repo,
    pr_number: pullRequest.pr_number,
    title: pullRequest.title || null,
    url: pullRequest.url || null,
    author_login: pullRequest.author_login || "unknown",
    tested: pullRequest.status === "tested" || Boolean(pullRequest.tested_at),
  };
}

function createInMemoryState() {
  return {
    deployments: [],
    lastProductionDeploymentAt: new Date("1970-01-01T00:00:00.000Z"),
    pullRequests: [
      {
        merged_at: new Date("2026-02-13T17:00:00.000Z"),
        pr_number: 700,
        repo: "croft-eng/croft",
        status: "untested",
        title: "Feature PR",
        url: "https://github.com/croft-eng/croft/pull/700",
        author_login: "octocat",
      },
    ],
    transactionStatements: [],
  };
}

function createPoolTransactionRecorder(state) {
  return {
    async query(statement) {
      if (statement === "BEGIN" || statement === "COMMIT" || statement === "ROLLBACK") {
        state.transactionStatements.push(statement);
      }
      return { rows: [] };
    },
  };
}

function createCommandHandler(serviceOptions) {
  const app = {
    commandName: null,
    commandHandler: null,
    command(name, handler) {
      this.commandName = name;
      this.commandHandler = handler;
    },
  };

  registerCalypsoCommand(app, serviceOptions);

  return {
    app,
    commandHandler: app.commandHandler,
  };
}

async function runSlashCommand(commandHandler, text, userId) {
  const responses = await runSlashCommandResponses(commandHandler, text, userId);
  return responses[responses.length - 1];
}

async function runSlashCommandResponses(commandHandler, text, userId) {
  const responses = [];
  await commandHandler({
    command: {
      text,
      user_id: userId,
    },
    ack: async () => {},
    respond: async (message) => {
      responses.push(message);
    },
  });

  return responses;
}

function readSlackBlocks(message) {
  return message.attachments[0].blocks;
}

function readResponseText(message) {
  return message.text || message.attachments?.[0]?.fallback || "";
}
