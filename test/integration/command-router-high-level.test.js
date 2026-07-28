const assert = require("node:assert/strict");
const test = require("node:test");

const { registerCalypsoCommand } = require("../../src/commands/command_router");

test("high-level command lifecycle: status -> tested -> deploy -> status", async () => {
  const state = createInMemoryState();
  const { app, commandHandler } = createCommandHandler({
    enableDeploymentCompletionNotifications: true,
    pool: createPoolTransactionRecorder(state),
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    deployConfig: {
      digitaloceanToken: "token",
      doAppIdProd: "app",
    },
    getLastProdDeployAtFn: async () => state.lastProductionDeploymentAt,
    listBlockingPullRequestsFn: async (_pool, lastDeployAt) =>
      state.pullRequests.filter(
        (pr) =>
          pr.merged_at > lastDeployAt && pr.status !== "tested" && pr.status !== "deployed",
      ),
    listDeployablePullRequestsForDeploymentFn: async (_pool, lastDeployAt, deploymentCutoffAt) =>
      state.pullRequests
        .filter(
          (pr) =>
            pr.merged_at > lastDeployAt &&
            pr.merged_at <= deploymentCutoffAt &&
            pr.status === "tested",
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

  assert.equal(app.commandName, "/calypso");

  const statusBefore = await runSlashCommand(commandHandler, "status", "U_TESTER");
  const deployBlocked = await runSlashCommand(commandHandler, "deploy prod", "U_TESTER");
  const markTested = await runSlashCommand(commandHandler, "tested 700", "U_TESTER");
  const deployResponses = await runSlashCommandResponses(commandHandler, "deploy prod", "U_TESTER");
  const deployStarted = deployResponses[0];
  const deploySuccess = deployResponses[1];
  const statusAfter = await runSlashCommand(commandHandler, "status", "U_TESTER");

  assert.match(statusBefore.text, /Blocking PRs since last prod deploy/);
  assert.match(
    statusBefore.text,
    /<https:\/\/github\.com\/croft-eng\/croft\/pull\/700\|croft-eng\/croft#700> \(untested\)/,
  );

  assert.match(deployBlocked.text, /Deploy blocked due to untested PRs/);
  assert.match(markTested.text, /Marked PR #700 as tested/);
  assert.equal(deployStarted.response_type, "in_channel");
  assert.match(deployStarted.text, /Deploy to prod is in progress \(id: dep-999\)/);
  assert.match(deployStarted.text, /Triggered by <@U_TESTER>/);
  assert.match(deployStarted.text, /PRs to deploy:/);
  assert.match(deployStarted.text, /Feature PR> by <@U123ABC> \(tested\)\./);
  assert.doesNotMatch(deployStarted.text, /Marked 1 PR\(s\) deployed/);
  assert.equal(deploySuccess.response_type, "in_channel");
  assert.match(deploySuccess.text, /Deployment dep-999 finished successfully with phase ACTIVE/);
  assert.match(deploySuccess.text, /Marked 1 PR\(s\) deployed/);
  assert.match(deploySuccess.text, /Deployed PRs:/);
  assert.match(
    deploySuccess.text,
    /<https:\/\/github\.com\/croft-eng\/croft\/pull\/700\|Feature PR> by <@U123ABC> \(tested\)\./,
  );
  assert.match(statusAfter.text, /No blockers since last prod deploy/);

  assert.deepEqual(state.transactionStatements, ["BEGIN", "COMMIT"]);
  assert.equal(state.deployments.length, 1);
  assert.equal(state.pullRequests[0].status, "deployed");
  assert.equal(state.pullRequests[0].tested_by, "U_TESTER");
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
