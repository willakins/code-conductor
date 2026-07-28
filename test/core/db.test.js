const assert = require("node:assert/strict");
const test = require("node:test");

const {
  addUserToDeployWhitelist,
  completeDeploymentRun,
  consumeDeploymentConfirmation,
  createDeploymentConfirmation,
  createPool,
  getConfiguredTimeFormat,
  getDeploymentGateState,
  getConfiguredTimeZone,
  getRuntimeProviderConfig,
  getReviewRecapConfig,
  isUserWhitelistedForDeploy,
  insertDeployment,
  insertAuditEvent,
  listDeployablePullRequestsForDeployment,
  listBlockingPullRequests,
  listAuditEvents,
  listGithubSlackUserMappings,
  listOpenPullRequestsForReviewRecapSince,
  listOpenPullRequestsWaitingOnReviewSince,
  listRecentlyTestedPullRequests,
  markAllUntestedPullRequestsTested,
  markDeploymentRunTriggered,
  markPullRequestsDeployed,
  markPullRequestsDeployedSince,
  setConfiguredCodeHostProvider,
  setConfiguredCommunicationProvider,
  setConfiguredDeployEnvironment,
  setConfiguredDeployProvider,
  setConfiguredEmailProvider,
  setConfiguredAiProvider,
  setConfiguredErrorTrackingProvider,
  setDeploymentGateState,
  setDeploymentGateStateWithAudit,
  setGithubSlackUserMapping,
  setPullRequestForceDeployBlocked,
  reserveDeploymentRun,
  markStaleOpenPullRequestsClosed,
  markReviewRecapSent,
  setConfiguredTimeFormat,
  setConfiguredTimeZone,
  setReviewRecapChannel,
  setReviewRecapRecency,
  setReviewRecapScope,
  setReviewRecapSendHolidays,
  setReviewRecapSendWeekends,
  setReviewRecapSchedule,
  setReviewRecapTimeZone,
  updatePullRequestCodexApproval,
  updatePullRequestReviewSubmission,
  upsertOpenPullRequestReviewState,
  upsertPullRequestAsUntestedFromSync,
} = require("../../src/db");

test("deployment gate state is persisted as an authoritative environment setting", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return {
        rows: [{
          changed_by: "U1",
          environment: "prod",
          reason: "Incident",
          status: "closed",
        }],
      };
    },
  };

  const state = await setDeploymentGateState(pool, {
    actorUserId: "U1",
    environment: "prod",
    reason: "Incident",
    status: "closed",
  });
  await getDeploymentGateState(pool, "prod");

  assert.equal(state.status, "closed");
  assert.match(calls[0].sql, /ON CONFLICT \(environment\) DO UPDATE/);
  assert.deepEqual(calls[0].params, ["prod", "closed", "Incident", "U1"]);
  assert.match(calls[1].sql, /FROM deployment_gate_state/);
});

test("gate state and its audit event commit in one transaction", async () => {
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(String(sql).trim());
      if (/RETURNING environment, status/.test(sql)) {
        return { rows: [{ environment: "prod", reason: "Incident", status: "closed" }] };
      }
      if (/RETURNING id, event_type/.test(sql)) {
        return { rows: [{ id: 1, event_type: "gate_closed" }] };
      }
      return { rows: [] };
    },
    release() {
      calls.push("RELEASE");
    },
  };
  const result = await setDeploymentGateStateWithAudit(
    { connect: async () => client },
    {
      actorUserId: "U1",
      environment: "prod",
      reason: "Incident",
      status: "closed",
      summary: "Production gate closed.",
    },
  );

  assert.equal(result.state.status, "closed");
  assert.equal(result.event.event_type, "gate_closed");
  assert.equal(calls[0], "BEGIN");
  assert.equal(calls.at(-2), "COMMIT");
  assert.equal(calls.at(-1), "RELEASE");
});

test("deployment confirmations are user-bound, expiring, and single-use", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return {
        rows: [{
          environment: "prod",
          requested_by: "U1",
          token: "confirm-token",
        }],
      };
    },
  };

  await createDeploymentConfirmation(pool, {
    environment: "prod",
    requestedBy: "U1",
    token: "confirm-token",
  });
  await consumeDeploymentConfirmation(pool, {
    environment: "prod",
    requestedBy: "U1",
    token: "confirm-token",
  });

  assert.match(calls[0].sql, /INTERVAL '10 minutes'/);
  assert.match(calls[1].sql, /consumed_at IS NULL/);
  assert.match(calls[1].sql, /expires_at > NOW/);
  assert.deepEqual(calls[1].params, ["confirm-token", "prod", "U1"]);
});

test("deployment run lifecycle reserves, triggers, and completes one run", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ id: 7, environment: "prod" }] };
    },
  };

  const reservation = await reserveDeploymentRun(pool, {
    actorUserId: "U1",
    environment: "prod",
    provider: "digitalocean",
  });
  await markDeploymentRunTriggered(pool, 7, {
    externalDeploymentId: "dep-7",
    provider: "digitalocean",
  });
  await completeDeploymentRun(pool, 7, { status: "succeeded" });

  assert.equal(reservation.acquired, true);
  assert.match(calls[0].sql, /INSERT INTO deployment_runs/);
  assert.match(calls[1].sql, /status = 'triggered'/);
  assert.match(calls[2].sql, /completed_at = NOW/);
});

test("audit history writes structured metadata and lists newest events", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ id: 1, summary: "Production gate closed." }] };
    },
  };

  await insertAuditEvent(pool, {
    actorUserId: "U1",
    environment: "prod",
    eventType: "gate_closed",
    metadata: { reason: "Incident" },
    summary: "Production gate closed.",
  });
  const events = await listAuditEvents(pool, { environment: "prod", limit: 10 });

  assert.equal(events[0].summary, "Production gate closed.");
  assert.equal(calls[0].params[4], JSON.stringify({ reason: "Incident" }));
  assert.match(calls[1].sql, /ORDER BY created_at DESC/);
});

test("createPool requires DATABASE_URL", () => {
  assert.throws(() => createPool(""), /DATABASE_URL is required/);
});

test("createPool does not force SSL when sslmode is absent", async () => {
  const pool = createPool("postgresql://user:pass@localhost:5432/calypso");
  assert.equal(pool.options.ssl, undefined);
  await pool.end();
});

test("createPool enables SSL for sslmode=require", async () => {
  const pool = createPool("postgresql://user:pass@localhost:5432/calypso?sslmode=require");
  assert.deepEqual(pool.options.ssl, { rejectUnauthorized: false });
  assert.equal(pool.options.connectionString, "postgresql://user:pass@localhost:5432/calypso");
  await pool.end();
});

test("createPool enables SSL for sslmode=verify-full", async () => {
  const pool = createPool("postgresql://user:pass@localhost:5432/calypso?sslmode=verify-full");
  assert.deepEqual(pool.options.ssl, { rejectUnauthorized: false });
  assert.equal(pool.options.connectionString, "postgresql://user:pass@localhost:5432/calypso");
  await pool.end();
});

test("createPool keeps SSL disabled for sslmode=disable", async () => {
  const pool = createPool("postgresql://user:pass@localhost:5432/calypso?sslmode=disable");
  assert.equal(pool.options.ssl, undefined);
  assert.equal(pool.options.connectionString, "postgresql://user:pass@localhost:5432/calypso");
  await pool.end();
});

test("createPool strips SSL query parameters that override explicit ssl config", async () => {
  const pool = createPool(
    "postgresql://user:pass@localhost:5432/calypso?sslmode=require&sslrootcert=%2Ftmp%2Fcert.pem&x=1",
  );
  assert.deepEqual(pool.options.ssl, { rejectUnauthorized: false });
  assert.equal(pool.options.connectionString, "postgresql://user:pass@localhost:5432/calypso?x=1");
  await pool.end();
});

test("markAllUntestedPullRequestsTested returns updated row count", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return { rowCount: 5 };
    },
  };

  const updatedCount = await markAllUntestedPullRequestsTested(pool, "U123");

  assert.equal(updatedCount, 5);
  assert.match(captured.sql, /WHERE status = 'untested'/);
  assert.deepEqual(captured.params, ["U123"]);
});

test("listRecentlyTestedPullRequests returns queried rows", async () => {
  const sinceTimestamp = new Date("2026-02-12T00:00:00.000Z");
  const row = {
    repo: "croft-eng/croft",
    pr_number: 99,
    status: "tested",
    tested_at: new Date("2026-02-13T00:00:00.000Z"),
    tested_by: "U123",
  };
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return { rows: [row] };
    },
  };

  const rows = await listRecentlyTestedPullRequests(pool, sinceTimestamp);

  assert.deepEqual(rows, [row]);
  assert.match(captured.sql, /tested_at >= \$1/);
  assert.deepEqual(captured.params, [sinceTimestamp]);
});

test("listBlockingPullRequests returns blocker rows including force-deploy flag", async () => {
  const sinceTimestamp = new Date("2026-02-12T00:00:00.000Z");
  const row = {
    repo: "croft-eng/croft",
    pr_number: 77,
    status: "untested",
    force_deploy_blocked: true,
  };
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return { rows: [row] };
    },
  };

  const rows = await listBlockingPullRequests(pool, sinceTimestamp);

  assert.deepEqual(rows, [row]);
  assert.match(captured.sql, /force_deploy_blocked/);
  assert.deepEqual(captured.params, [sinceTimestamp]);
});

test("listDeployablePullRequestsForDeployment returns tested PRs up to deployment cutoff", async () => {
  const sinceTimestamp = new Date("2026-02-12T00:00:00.000Z");
  const deploymentCutoffAt = new Date("2026-02-13T17:00:00.000Z");
  const row = {
    repo: "croft-eng/croft",
    pr_number: 77,
    status: "tested",
    author_login: "octocat",
  };
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return { rows: [row] };
    },
  };

  const rows = await listDeployablePullRequestsForDeployment(
    pool,
    sinceTimestamp,
    deploymentCutoffAt,
  );

  assert.deepEqual(rows, [row]);
  assert.match(captured.sql, /merged_at > \$1/);
  assert.match(captured.sql, /merged_at <= \$2/);
  assert.match(captured.sql, /status = ANY\(\$3::text\[\]\)/);
  assert.match(captured.sql, /author_login/);
  assert.deepEqual(captured.params, [sinceTimestamp, deploymentCutoffAt, ["tested"]]);
});

test("listDeployablePullRequestsForDeployment includes untested PRs for force deploy", async () => {
  const sinceTimestamp = new Date("2026-02-12T00:00:00.000Z");
  const deploymentCutoffAt = new Date("2026-02-13T17:00:00.000Z");
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return { rows: [] };
    },
  };

  await listDeployablePullRequestsForDeployment(
    pool,
    sinceTimestamp,
    deploymentCutoffAt,
    { includeUntested: true },
  );

  assert.deepEqual(captured.params, [sinceTimestamp, deploymentCutoffAt, ["tested", "untested"]]);
});

test("setPullRequestForceDeployBlocked updates most recent pull request flag", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (calls.length === 1) {
        return {
          rows: [{ id: 99, pr_number: 77, status: "untested", force_deploy_blocked: false }],
        };
      }

      return {
        rows: [{ id: 99, pr_number: 77, status: "untested", force_deploy_blocked: true }],
      };
    },
  };

  const result = await setPullRequestForceDeployBlocked(pool, 77, true);

  assert.equal(result.found, true);
  assert.equal(result.alreadySet, false);
  assert.equal(result.pullRequest.force_deploy_blocked, true);
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /FROM pull_requests/);
  assert.match(calls[1].sql, /UPDATE pull_requests/);
  assert.deepEqual(calls[1].params, [99, true]);
});

test("setPullRequestForceDeployBlocked returns idempotent result when already set", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return {
        rows: [{ id: 88, pr_number: 55, status: "untested", force_deploy_blocked: true }],
      };
    },
  };

  const result = await setPullRequestForceDeployBlocked(pool, 55, true);

  assert.equal(result.found, true);
  assert.equal(result.alreadySet, true);
  assert.equal(result.pullRequest.force_deploy_blocked, true);
  assert.equal(calls.length, 1);
});

test("setPullRequestForceDeployBlocked returns not found when PR does not exist", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };

  const result = await setPullRequestForceDeployBlocked(pool, 404, true);

  assert.deepEqual(result, { found: false });
});

test("isUserWhitelistedForDeploy returns true when user is present", async () => {
  const pool = {
    async query(_sql, _params) {
      return { rowCount: 1 };
    },
  };

  const isWhitelisted = await isUserWhitelistedForDeploy(pool, "U123");
  assert.equal(isWhitelisted, true);
});

test("isUserWhitelistedForDeploy returns false when user is absent", async () => {
  const pool = {
    async query(_sql, _params) {
      return { rowCount: 0 };
    },
  };

  const isWhitelisted = await isUserWhitelistedForDeploy(pool, "U123");
  assert.equal(isWhitelisted, false);
});

test("addUserToDeployWhitelist returns added=false when already present", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (calls.length === 1) {
        return { rowCount: 1 };
      }
      return { rowCount: 0 };
    },
  };

  const result = await addUserToDeployWhitelist(pool, "U123", "UADMIN");

  assert.deepEqual(result, { added: false });
  assert.equal(calls.length, 1);
});

test("addUserToDeployWhitelist inserts when user is not present", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (calls.length === 1) {
        return { rowCount: 0 };
      }
      return { rowCount: 1 };
    },
  };

  const result = await addUserToDeployWhitelist(pool, "U123", "UADMIN");

  assert.deepEqual(result, { added: true });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].params, ["U123", "UADMIN"]);
});

test("setGithubSlackUserMapping upserts normalized usernames", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ github_username: "octocat", slack_username: "willa", updated_by: "UADMIN" }],
      };
    },
  };

  const result = await setGithubSlackUserMapping(pool, "@OctoCat", "@Willa", "UADMIN");

  assert.match(captured.sql, /INSERT INTO github_slack_user_mappings/);
  assert.deepEqual(captured.params, ["octocat", "willa", "UADMIN"]);
  assert.deepEqual(result, {
    github_username: "octocat",
    slack_username: "willa",
    updated_by: "UADMIN",
  });
});

test("setGithubSlackUserMapping normalizes slack mention to user id", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ github_username: "octocat", slack_username: "U123ABC", updated_by: "UADMIN" }],
      };
    },
  };

  const result = await setGithubSlackUserMapping(pool, "octocat", "<@U123ABC>", "UADMIN");

  assert.match(captured.sql, /INSERT INTO github_slack_user_mappings/);
  assert.deepEqual(captured.params, ["octocat", "U123ABC", "UADMIN"]);
  assert.deepEqual(result, {
    github_username: "octocat",
    slack_username: "U123ABC",
    updated_by: "UADMIN",
  });
});

test("setGithubSlackUserMapping rejects invalid github usernames", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };

  await assert.rejects(async () => {
    await setGithubSlackUserMapping(pool, "bad user", "willa", "UADMIN");
  }, /Unsupported GitHub username/);
});

test("listGithubSlackUserMappings returns mapping map by normalized github username", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ github_username: "octocat", slack_username: "willa" }],
      };
    },
  };

  const result = await listGithubSlackUserMappings(pool, ["@OctoCat", "bad user"]);

  assert.match(captured.sql, /FROM github_slack_user_mappings/);
  assert.deepEqual(captured.params, [["octocat"]]);
  assert.deepEqual(result, new Map([["octocat", "willa"]]));
});

test("insertDeployment uses provided deployed timestamp when present", async () => {
  const deployedAt = new Date("2026-02-13T17:00:00.000Z");
  const captured = {};
  const row = {
    id: 1,
    environment: "prod",
    provider: "digitalocean",
    external_deploy_id: "dep-123",
    deployed_at: deployedAt,
  };
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return { rows: [row] };
    },
  };

  const result = await insertDeployment(pool, {
    environment: "prod",
    provider: "digitalocean",
    externalDeployId: "dep-123",
    deployedAt,
  });

  assert.deepEqual(result, row);
  assert.match(captured.sql, /COALESCE\(\$4, NOW\(\)\)/);
  assert.deepEqual(captured.params, ["prod", "digitalocean", "dep-123", deployedAt]);
});

test("markPullRequestsDeployedSince returns deployed count and pull request details", async () => {
  const captured = {};
  const sinceTimestamp = new Date("2026-02-12T00:00:00.000Z");
  const deployedAt = new Date("2026-02-13T00:00:00.000Z");
  const row = {
    repo: "croft-eng/croft",
    pr_number: 42,
    title: "Stabilize deploy flow",
    url: "https://github.com/croft-eng/croft/pull/42",
    author_login: "octocat",
  };
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rowCount: 1,
        rows: [row],
      };
    },
  };

  const result = await markPullRequestsDeployedSince(pool, sinceTimestamp, deployedAt);

  assert.match(captured.sql, /UPDATE pull_requests/);
  assert.match(captured.sql, /status IN \('tested', 'untested'\)/);
  assert.match(captured.sql, /RETURNING/);
  assert.match(captured.sql, /author_login/);
  assert.deepEqual(captured.params, [sinceTimestamp, deployedAt]);
  assert.deepEqual(result, {
    deployedPullRequestCount: 1,
    deployedPullRequests: [row],
  });
});

test("markPullRequestsDeployed marks only exact normalized pull request targets", async () => {
  const deployedAt = new Date("2026-02-13T00:00:00.000Z");
  const row = {
    repo: "croft-eng/croft",
    pr_number: 42,
    title: "Stabilize deploy flow",
    url: "https://github.com/croft-eng/croft/pull/42",
    author_login: "octocat",
  };
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [row],
      };
    },
  };

  const result = await markPullRequestsDeployed(
    pool,
    [
      { repo: "croft-eng/croft", pr_number: 42 },
      { repo: "croft-eng/croft", prNumber: 42 },
      { repo: "", pr_number: 43 },
      { repo: "croft-eng/croft", pr_number: "not-a-number" },
    ],
    deployedAt,
  );

  assert.match(captured.sql, /UNNEST\(\$1::text\[\], \$2::integer\[\]\)/);
  assert.match(captured.sql, /pull_requests.status IN \('tested', 'untested'\)/);
  assert.match(captured.sql, /ORDER BY target_order ASC/);
  assert.deepEqual(captured.params, [["croft-eng/croft"], [42], deployedAt]);
  assert.deepEqual(result, {
    deployedPullRequestCount: 1,
    deployedPullRequests: [row],
  });
});

test("markPullRequestsDeployed skips database call when no valid targets exist", async () => {
  let queried = false;
  const pool = {
    async query() {
      queried = true;
      return { rows: [] };
    },
  };

  const result = await markPullRequestsDeployed(pool, [{ repo: "", pr_number: 42 }], new Date());

  assert.equal(queried, false);
  assert.deepEqual(result, {
    deployedPullRequestCount: 0,
    deployedPullRequests: [],
  });
});

test("getConfiguredTimeFormat returns configured value", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ time_format: "long" }],
      };
    },
  };

  const result = await getConfiguredTimeFormat(pool, "U123");
  assert.equal(result, "long");
  assert.match(captured.sql, /FROM runtime_user_config/);
  assert.deepEqual(captured.params, ["U123"]);
});

test("getConfiguredTimeFormat falls back to human when unset", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [],
      };
    },
  };

  const result = await getConfiguredTimeFormat(pool, "U123");
  assert.equal(result, "human");
  assert.match(captured.sql, /FROM runtime_user_config/);
  assert.deepEqual(captured.params, ["U123"]);
});

test("getConfiguredTimeFormat falls back to human when user id missing", async () => {
  let queryCalled = false;
  const pool = {
    async query() {
      queryCalled = true;
      return { rows: [] };
    },
  };

  const result = await getConfiguredTimeFormat(pool);
  assert.equal(result, "human");
  assert.equal(queryCalled, false);
});

test("setConfiguredTimeFormat upserts selected format", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ time_format: "long", updated_by: "UADMIN" }],
      };
    },
  };

  const result = await setConfiguredTimeFormat(pool, "long", "UADMIN");

  assert.match(captured.sql, /INSERT INTO runtime_user_config/);
  assert.deepEqual(captured.params, ["long", "UADMIN"]);
  assert.deepEqual(result, { time_format: "long", updated_by: "UADMIN" });
});

test("setConfiguredTimeFormat rejects unsupported values", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };

  await assert.rejects(async () => {
    await setConfiguredTimeFormat(pool, "invalid", "UADMIN");
  }, /Unsupported time format/);
});

test("setConfiguredTimeFormat requires user id", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };

  await assert.rejects(async () => {
    await setConfiguredTimeFormat(pool, "human", "");
  }, /user id is required/);
});

test("getConfiguredTimeZone returns configured value", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ timezone: "America/Los_Angeles" }],
      };
    },
  };

  const result = await getConfiguredTimeZone(pool, "U123");
  assert.equal(result, "America/Los_Angeles");
  assert.match(captured.sql, /FROM runtime_user_config/);
  assert.deepEqual(captured.params, ["U123"]);
});

test("getConfiguredTimeZone falls back to default when unset", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [],
      };
    },
  };

  const result = await getConfiguredTimeZone(pool, "U123");
  assert.equal(result, "America/New_York");
  assert.match(captured.sql, /FROM runtime_user_config/);
  assert.deepEqual(captured.params, ["U123"]);
});

test("getConfiguredTimeZone falls back to default when user id missing", async () => {
  let queryCalled = false;
  const pool = {
    async query() {
      queryCalled = true;
      return { rows: [] };
    },
  };

  const result = await getConfiguredTimeZone(pool);
  assert.equal(result, "America/New_York");
  assert.equal(queryCalled, false);
});

test("setConfiguredTimeZone upserts selected timezone", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ timezone: "America/Los_Angeles", updated_by: "UADMIN" }],
      };
    },
  };

  const result = await setConfiguredTimeZone(pool, "America/Los_Angeles", "UADMIN");

  assert.match(captured.sql, /INSERT INTO runtime_user_config/);
  assert.deepEqual(captured.params, ["America/Los_Angeles", "UADMIN"]);
  assert.deepEqual(result, { timezone: "America/Los_Angeles", updated_by: "UADMIN" });
});

test("setConfiguredTimeZone rejects unsupported values", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };

  await assert.rejects(async () => {
    await setConfiguredTimeZone(pool, "", "UADMIN");
  }, /Unsupported timezone/);
});

test("setConfiguredTimeZone requires user id", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };

  await assert.rejects(async () => {
    await setConfiguredTimeZone(pool, "America/New_York", "");
  }, /user id is required/);
});

test("upsertOpenPullRequestReviewState upserts expected fields", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ repo: "croft-eng/croft", pr_number: 77, review_state: "waiting" }],
      };
    },
  };

  const result = await upsertOpenPullRequestReviewState(pool, {
    repo: "croft-eng/croft",
    prNumber: 77,
    title: "Add observability",
    url: "https://github.com/croft-eng/croft/pull/77",
    authorLogin: "octocat",
    baseBranch: "main",
    isDraft: false,
    lifecycleState: "open",
    reviewState: "waiting",
    openedAt: "2026-02-16T13:00:00.000Z",
    openedForReviewAt: "2026-02-16T13:00:00.000Z",
    closedAt: null,
    mergedAt: null,
    lastReviewedAt: null,
  });

  assert.match(captured.sql, /INSERT INTO open_pr_review_state/);
  assert.equal(captured.params[0], "croft-eng/croft");
  assert.equal(captured.params[1], 77);
  assert.equal(captured.params[8], "waiting");
  assert.equal(captured.params[14], null);
  assert.deepEqual(result, { repo: "croft-eng/croft", pr_number: 77, review_state: "waiting" });
});

test("upsertPullRequestAsUntestedFromSync preserves tested/deployed states on conflict", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ repo: "croft-eng/croft", pr_number: 88, status: "tested" }],
      };
    },
  };

  const result = await upsertPullRequestAsUntestedFromSync(pool, {
    repo: "croft-eng/croft",
    prNumber: 88,
    title: "Backfilled merged PR",
    url: "https://github.com/croft-eng/croft/pull/88",
    mergedAt: "2026-02-16T14:00:00.000Z",
  });

  assert.match(captured.sql, /INSERT INTO pull_requests/);
  assert.match(captured.sql, /ON CONFLICT \(repo, pr_number\)/);
  assert.match(captured.sql, /WHEN pull_requests.status = 'untested' THEN 'untested'/);
  assert.deepEqual(captured.params, [
    "croft-eng/croft",
    88,
    "Backfilled merged PR",
    "https://github.com/croft-eng/croft/pull/88",
    "2026-02-16T14:00:00.000Z",
  ]);
  assert.equal(result.status, "tested");
});

test("updatePullRequestReviewSubmission updates approved review state", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ repo: "croft-eng/croft", pr_number: 77, review_state: "approved" }],
      };
    },
  };

  const result = await updatePullRequestReviewSubmission(pool, {
    repo: "croft-eng/croft",
    prNumber: 77,
    reviewState: "approved",
    lastReviewedAt: "2026-02-16T14:00:00.000Z",
  });

  assert.match(captured.sql, /UPDATE open_pr_review_state/);
  assert.deepEqual(captured.params, [
    "croft-eng/croft",
    77,
    "approved",
    "2026-02-16T14:00:00.000Z",
  ]);
  assert.equal(result.review_state, "approved");
});

test("updatePullRequestReviewSubmission supports timestamp-only updates", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ repo: "croft-eng/croft", pr_number: 77, review_state: "waiting" }],
      };
    },
  };

  const result = await updatePullRequestReviewSubmission(pool, {
    repo: "croft-eng/croft",
    prNumber: 77,
    reviewState: null,
    lastReviewedAt: "2026-02-16T14:00:00.000Z",
  });

  assert.match(captured.sql, /COALESCE\(\$3, review_state\)/);
  assert.deepEqual(captured.params, [
    "croft-eng/croft",
    77,
    null,
    "2026-02-16T14:00:00.000Z",
  ]);
  assert.equal(result.review_state, "waiting");
});

test("updatePullRequestReviewSubmission rejects unsupported review state", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };

  await assert.rejects(async () => {
    await updatePullRequestReviewSubmission(pool, {
      repo: "croft-eng/croft",
      prNumber: 77,
      reviewState: "dismissed",
      lastReviewedAt: "2026-02-16T14:00:00.000Z",
    });
  }, /Unsupported review state/);
});

test("updatePullRequestCodexApproval updates codex approval state", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ repo: "croft-eng/croft", pr_number: 77, codex_approved: true }],
      };
    },
  };

  const result = await updatePullRequestCodexApproval(pool, {
    repo: "croft-eng/croft",
    prNumber: 77,
    codexApproved: true,
  });

  assert.match(captured.sql, /UPDATE open_pr_review_state/);
  assert.match(captured.sql, /SET codex_approved = \$3/);
  assert.deepEqual(captured.params, ["croft-eng/croft", 77, true]);
  assert.equal(result.codex_approved, true);
});

test("listOpenPullRequestsWaitingOnReviewSince returns rows in recency window", async () => {
  const captured = {};
  const sinceTimestamp = new Date("2026-02-09T14:00:00.000Z");
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ repo: "croft-eng/croft", pr_number: 71, author_login: "octocat" }],
      };
    },
  };

  const result = await listOpenPullRequestsWaitingOnReviewSince(pool, sinceTimestamp);

  assert.match(captured.sql, /FROM open_pr_review_state/);
  assert.match(captured.sql, /lifecycle_state = 'open'/);
  assert.match(captured.sql, /review_state IN \('waiting', 'changes_requested'\)/);
  assert.match(captured.sql, /COALESCE\(last_reviewed_at, opened_for_review_at, opened_at\) AS last_modified_at/);
  assert.doesNotMatch(captured.sql, /updated_at, opened_for_review_at, opened_at\) AS last_modified_at/);
  assert.deepEqual(captured.params, [sinceTimestamp]);
  assert.equal(result.length, 1);
  assert.equal(result[0].pr_number, 71);
});

test("listOpenPullRequestsForReviewRecapSince returns open non-draft rows", async () => {
  const captured = {};
  const sinceTimestamp = new Date("2026-02-09T14:00:00.000Z");
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ repo: "croft-eng/croft", pr_number: 71, author_login: "octocat" }],
      };
    },
  };

  const result = await listOpenPullRequestsForReviewRecapSince(pool, sinceTimestamp);

  assert.match(captured.sql, /FROM open_pr_review_state/);
  assert.match(captured.sql, /lifecycle_state = 'open'/);
  assert.match(captured.sql, /is_draft = false/);
  assert.match(captured.sql, /COALESCE\(last_reviewed_at, opened_for_review_at, opened_at\) AS last_modified_at/);
  assert.doesNotMatch(captured.sql, /updated_at, opened_for_review_at, opened_at\) AS last_modified_at/);
  assert.match(captured.sql, /COALESCE\(opened_for_review_at, opened_at\) >= \$1/);
  assert.deepEqual(captured.params, [sinceTimestamp]);
  assert.equal(result.length, 1);
  assert.equal(result[0].pr_number, 71);
});

test("markStaleOpenPullRequestsClosed closes unmatched open rows for repo and branch", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return { rowCount: 3 };
    },
  };

  const closedCount = await markStaleOpenPullRequestsClosed(pool, {
    repo: "croft-eng/croft",
    baseBranch: "main",
    openPrNumbers: [71, 72],
    closedAt: "2026-02-16T14:00:00.000Z",
  });

  assert.match(captured.sql, /UPDATE open_pr_review_state/);
  assert.match(captured.sql, /NOT \(pr_number = ANY\(\$3::INT\[\]\)\)/);
  assert.deepEqual(captured.params, [
    "croft-eng/croft",
    "main",
    [71, 72],
    "2026-02-16T14:00:00.000Z",
  ]);
  assert.equal(closedCount, 3);
});

test("getReviewRecapConfig returns defaults when singleton row is missing", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };

  const result = await getReviewRecapConfig(pool);

  assert.equal(result.targetChannelId, null);
  assert.equal(result.reviewScope, "all");
  assert.equal(result.recencyValue, 1);
  assert.equal(result.recencyUnit, "w");
  assert.equal(result.scheduleWeekday, "mon");
  assert.equal(result.scheduleTime, "09:00");
  assert.equal(result.sendOnWeekends, false);
  assert.equal(result.sendOnHolidays, false);
  assert.equal(result.timeZone, "America/New_York");
  assert.equal(result.lastSentSlotAt, null);
});

test("getReviewRecapConfig returns configured values", async () => {
  const pool = {
    async query() {
      return {
        rows: [
          {
            target_channel_id: "C123",
            review_scope: "month",
            recency_value: 2,
            recency_unit: "d",
            schedule_weekday: "tue",
            schedule_time: "10:15",
            send_on_weekends: false,
            send_on_holidays: false,
            timezone: "America/Los_Angeles",
            last_sent_slot_at: "2026-02-16T17:00:00.000Z",
          },
        ],
      };
    },
  };

  const result = await getReviewRecapConfig(pool);

  assert.equal(result.targetChannelId, "C123");
  assert.equal(result.reviewScope, "month");
  assert.equal(result.recencyValue, 2);
  assert.equal(result.recencyUnit, "d");
  assert.equal(result.scheduleWeekday, "tue");
  assert.equal(result.scheduleTime, "10:15");
  assert.equal(result.sendOnWeekends, false);
  assert.equal(result.sendOnHolidays, false);
  assert.equal(result.timeZone, "America/Los_Angeles");
  assert.equal(result.lastSentSlotAt, "2026-02-16T17:00:00.000Z");
});

test("getReviewRecapConfig supports daily schedule weekday", async () => {
  const pool = {
    async query() {
      return {
        rows: [
          {
            target_channel_id: "C123",
            recency_value: 1,
            recency_unit: "w",
            schedule_weekday: "daily",
            schedule_time: "09:00",
            timezone: "America/New_York",
            last_sent_slot_at: null,
          },
        ],
      };
    },
  };

  const result = await getReviewRecapConfig(pool);

  assert.equal(result.scheduleWeekday, "daily");
  assert.equal(result.scheduleTime, "09:00");
  assert.equal(result.reviewScope, "all");
});

test("getRuntimeProviderConfig returns defaults when singleton row is missing", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };

  const result = await getRuntimeProviderConfig(pool);

  assert.deepEqual(result, {
    communicationProvider: "slack",
    codeHostProvider: "github",
    deployEnvironment: "prod",
    deployProvider: "digitalocean",
    emailProvider: "gmail",
    aiProvider: "openai",
    errorTrackingProvider: "sentry",
  });
});

test("getRuntimeProviderConfig returns configured providers", async () => {
  const pool = {
    async query() {
      return {
        rows: [
          {
            communication_provider: "microsoft_teams",
            code_host_provider: "bitbucket",
            deploy_environment: "staging",
            deploy_provider: "aws",
            email_provider: "outlook",
            ai_provider: "anthropic",
            error_tracking_provider: "rollbar",
          },
        ],
      };
    },
  };

  const result = await getRuntimeProviderConfig(pool);

  assert.deepEqual(result, {
    communicationProvider: "microsoft_teams",
    codeHostProvider: "bitbucket",
    deployEnvironment: "staging",
    deployProvider: "aws",
    emailProvider: "outlook",
    aiProvider: "anthropic",
    errorTrackingProvider: "rollbar",
  });
});

test("setReviewRecapChannel upserts channel", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ target_channel_id: "C123", updated_by: "UADMIN" }],
      };
    },
  };

  const result = await setReviewRecapChannel(pool, "C123", "UADMIN");

  assert.match(captured.sql, /INSERT INTO review_recap_config/);
  assert.deepEqual(captured.params.slice(0, 2), ["C123", null]);
  assert.equal(result.target_channel_id, "C123");
});

test("setReviewRecapChannel rejects missing channel", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };

  await assert.rejects(async () => {
    await setReviewRecapChannel(pool, "", "UADMIN");
  }, /Unsupported review recap channel id/);
});

test("setReviewRecapRecency upserts recency", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ recency_value: 2, recency_unit: "w", updated_by: "UADMIN" }],
      };
    },
  };

  const result = await setReviewRecapRecency(pool, 2, "w", "UADMIN");

  assert.match(captured.sql, /INSERT INTO review_recap_config/);
  assert.equal(captured.params[1], "legacy");
  assert.equal(captured.params[2], 2);
  assert.equal(captured.params[3], "w");
  assert.equal(result.recency_value, 2);
  assert.equal(result.recency_unit, "w");
});

test("setReviewRecapRecency rejects unsupported unit", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };

  await assert.rejects(async () => {
    await setReviewRecapRecency(pool, 2, "month", "UADMIN");
  }, /Unsupported review recap recency unit/);
});

test("setReviewRecapSchedule upserts schedule", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ schedule_weekday: "tue", schedule_time: "10:15", updated_by: "UADMIN" }],
      };
    },
  };

  const result = await setReviewRecapSchedule(pool, "tue", "10:15", "UADMIN");

  assert.match(captured.sql, /INSERT INTO review_recap_config/);
  assert.match(captured.sql, /COALESCE\(\$8::timestamptz, NULL\)/);
  assert.equal(captured.params[4], "tue");
  assert.equal(captured.params[5], "10:15");
  assert.ok(captured.params[7]);
  assert.equal(Number.isNaN(Date.parse(captured.params[7])), false);
  assert.equal(result.schedule_weekday, "tue");
  assert.equal(result.schedule_time, "10:15");
});

test("setReviewRecapSchedule accepts daily schedule keyword", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ schedule_weekday: "daily", schedule_time: "09:00", updated_by: "UADMIN" }],
      };
    },
  };

  const result = await setReviewRecapSchedule(pool, "daily", "09:00", "UADMIN");

  assert.match(captured.sql, /INSERT INTO review_recap_config/);
  assert.equal(captured.params[4], "daily");
  assert.equal(captured.params[5], "09:00");
  assert.ok(captured.params[7]);
  assert.equal(Number.isNaN(Date.parse(captured.params[7])), false);
  assert.equal(result.schedule_weekday, "daily");
  assert.equal(result.schedule_time, "09:00");
});

test("setReviewRecapSchedule accepts and normalizes multiple schedule times", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ schedule_weekday: "daily", schedule_time: "09:00,17:00", updated_by: "UADMIN" }],
      };
    },
  };

  const result = await setReviewRecapSchedule(pool, "daily", "17:00,09:00,17:00", "UADMIN");

  assert.match(captured.sql, /INSERT INTO review_recap_config/);
  assert.equal(captured.params[4], "daily");
  assert.equal(captured.params[5], "09:00,17:00");
  assert.equal(result.schedule_weekday, "daily");
  assert.equal(result.schedule_time, "09:00,17:00");
});

test("setReviewRecapScope upserts recap window scope", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ review_scope: "week", updated_by: "UADMIN" }],
      };
    },
  };

  const result = await setReviewRecapScope(pool, "week", "UADMIN");

  assert.match(captured.sql, /INSERT INTO review_recap_config/);
  assert.equal(captured.params[1], "week");
  assert.equal(result.review_scope, "week");
});

test("setReviewRecapScope rejects unsupported scope", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };

  await assert.rejects(async () => {
    await setReviewRecapScope(pool, "quarter", "UADMIN");
  }, /Unsupported review recap scope/);
});

test("setReviewRecapSchedule rejects invalid time", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };

  await assert.rejects(async () => {
    await setReviewRecapSchedule(pool, "mon", "25:10", "UADMIN");
  }, /Unsupported review recap schedule time/);
});

test("setReviewRecapTimeZone upserts timezone", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ timezone: "America/Chicago", updated_by: "UADMIN" }],
      };
    },
  };

  const result = await setReviewRecapTimeZone(pool, "America/Chicago", "UADMIN");

  assert.match(captured.sql, /INSERT INTO review_recap_config/);
  assert.equal(captured.params[6], "America/Chicago");
  assert.equal(result.timezone, "America/Chicago");
});

test("setReviewRecapSendWeekends upserts weekend delivery flag", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ send_on_weekends: false, updated_by: "UADMIN" }],
      };
    },
  };

  const result = await setReviewRecapSendWeekends(pool, false, "UADMIN");

  assert.match(captured.sql, /INSERT INTO review_recap_config/);
  assert.equal(captured.params[8], false);
  assert.equal(result.send_on_weekends, false);
});

test("setReviewRecapSendWeekends rejects unsupported values", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };

  await assert.rejects(async () => {
    await setReviewRecapSendWeekends(pool, "maybe", "UADMIN");
  }, /Unsupported review recap weekend toggle/);
});

test("setReviewRecapSendHolidays upserts holiday delivery flag", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ send_on_holidays: false, updated_by: "UADMIN" }],
      };
    },
  };

  const result = await setReviewRecapSendHolidays(pool, false, "UADMIN");

  assert.match(captured.sql, /INSERT INTO review_recap_config/);
  assert.equal(captured.params[9], false);
  assert.equal(result.send_on_holidays, false);
});

test("setReviewRecapSendHolidays rejects unsupported values", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };

  await assert.rejects(async () => {
    await setReviewRecapSendHolidays(pool, "maybe", "UADMIN");
  }, /Unsupported review recap holiday toggle/);
});

test("setConfiguredCommunicationProvider upserts provider", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ communication_provider: "slack", updated_by: "UADMIN" }],
      };
    },
  };

  const result = await setConfiguredCommunicationProvider(pool, "slack", "UADMIN");

  assert.match(captured.sql, /INSERT INTO runtime_config/);
  assert.equal(captured.params[0], "slack");
  assert.equal(result.communication_provider, "slack");
});

test("setConfiguredCodeHostProvider upserts provider", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ code_host_provider: "github", updated_by: "UADMIN" }],
      };
    },
  };

  const result = await setConfiguredCodeHostProvider(pool, "github", "UADMIN");

  assert.match(captured.sql, /INSERT INTO runtime_config/);
  assert.equal(captured.params[1], "github");
  assert.equal(result.code_host_provider, "github");
});

test("setConfiguredDeployProvider upserts provider", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ deploy_provider: "digitalocean", updated_by: "UADMIN" }],
      };
    },
  };

  const result = await setConfiguredDeployProvider(pool, "digitalocean", "UADMIN");

  assert.match(captured.sql, /INSERT INTO runtime_config/);
  assert.equal(captured.params[2], "digitalocean");
  assert.equal(result.deploy_provider, "digitalocean");
});

test("setConfiguredDeployProvider rejects unsupported provider", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };

  await assert.rejects(async () => {
    await setConfiguredDeployProvider(pool, "render", "UADMIN");
  }, /Unsupported deploy provider/);
});

test("setConfiguredDeployEnvironment upserts the default environment", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ deploy_environment: "staging", updated_by: "UADMIN" }],
      };
    },
  };

  const result = await setConfiguredDeployEnvironment(pool, "staging", "UADMIN");

  assert.match(captured.sql, /INSERT INTO runtime_config/);
  assert.equal(captured.params[7], "staging");
  assert.equal(result.deploy_environment, "staging");
});

test("setConfiguredEmailProvider updates runtime config and clears email sync state", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
        return { rows: [] };
      }
      if (/INSERT INTO runtime_config/.test(sql)) {
        return {
          rows: [{ email_provider: "outlook", updated_by: "UADMIN" }],
        };
      }
      if (/INSERT INTO support_email_config/.test(sql)) {
        return {
          rows: [{ enabled: false }],
        };
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  const result = await setConfiguredEmailProvider(pool, "outlook", "UADMIN");

  assert.deepEqual(result, { emailProvider: "outlook" });
  assert.equal(calls[0].sql, "BEGIN");
  assert.equal(calls[1].params[3], "outlook");
  assert.equal(calls[1].params[6], "UADMIN");
  assert.equal(calls[2].params[9], "UADMIN");
  assert.equal(calls[2].params[11], true);
  assert.equal(calls[2].params[12], true);
  assert.equal(calls[2].params[13], true);
  assert.equal(calls[2].params[14], true);
  assert.equal(calls[2].params[15], true);
  assert.equal(calls[3].sql, "COMMIT");
});

test("setConfiguredAiProvider upserts provider", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ ai_provider: "anthropic", updated_by: "UADMIN" }],
      };
    },
  };

  const result = await setConfiguredAiProvider(pool, "anthropic", "UADMIN");

  assert.match(captured.sql, /INSERT INTO runtime_config/);
  assert.equal(captured.params[4], "anthropic");
  assert.equal(result.ai_provider, "anthropic");
});

test("setConfiguredErrorTrackingProvider updates runtime config and clears error tracking state", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
        return { rows: [] };
      }
      if (/INSERT INTO runtime_config/.test(sql)) {
        return {
          rows: [{ error_tracking_provider: "rollbar", updated_by: "UADMIN" }],
        };
      }
      if (/INSERT INTO error_tracking_config/.test(sql)) {
        return {
          rows: [{ enabled: false }],
        };
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  const result = await setConfiguredErrorTrackingProvider(pool, "rollbar", "UADMIN");

  assert.deepEqual(result, { errorTrackingProvider: "rollbar" });
  assert.equal(calls[0].sql, "BEGIN");
  assert.equal(calls[1].params[5], "rollbar");
  assert.equal(calls[1].params[6], "UADMIN");
  assert.equal(calls[2].params[7], "UADMIN");
  assert.equal(calls[2].params[9], true);
  assert.equal(calls[2].params[10], true);
  assert.equal(calls[2].params[11], true);
  assert.equal(calls[2].params[12], true);
  assert.equal(calls[3].sql, "COMMIT");
});

test("markReviewRecapSent updates last sent slot", async () => {
  const captured = {};
  const pool = {
    async query(sql, params) {
      captured.sql = sql;
      captured.params = params;
      return {
        rows: [{ id: 1, last_sent_slot_at: "2026-02-16T14:00:00.000Z" }],
      };
    },
  };

  const result = await markReviewRecapSent(pool, "2026-02-16T14:00:00.000Z");

  assert.match(captured.sql, /UPDATE review_recap_config/);
  assert.deepEqual(captured.params, ["2026-02-16T14:00:00.000Z"]);
  assert.equal(result.id, 1);
});
