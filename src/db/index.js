const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");

const MIGRATIONS_DIRECTORY_PATH = path.join(__dirname, "migrations");
const EPOCH_UTC_TIMESTAMP_SQL = "TIMESTAMPTZ '1970-01-01 00:00:00+00'";
const TLS_SSL_MODES = new Set(["require", "verify-ca", "verify-full"]);
const TIME_FORMATS = Object.freeze({
  human: "human",
  long: "long",
});
const DEFAULT_TIME_FORMAT = TIME_FORMATS.human;
const DEFAULT_TIME_ZONE = "America/New_York";
const REVIEW_RECAP_RECENCY_UNITS = Object.freeze({
  day: "d",
  week: "w",
});
const REVIEW_RECAP_SCOPES = Object.freeze({
  all: "all",
  day: "day",
  week: "week",
  month: "month",
  legacy: "legacy",
});
const REVIEW_RECAP_WEEKDAYS = Object.freeze({
  daily: "daily",
  mon: "mon",
  tue: "tue",
  wed: "wed",
  thu: "thu",
  fri: "fri",
  sat: "sat",
  sun: "sun",
});
const REVIEW_RECAP_DEFAULTS = Object.freeze({
  reviewScope: REVIEW_RECAP_SCOPES.all,
  recencyValue: 1,
  recencyUnit: REVIEW_RECAP_RECENCY_UNITS.week,
  scheduleWeekday: REVIEW_RECAP_WEEKDAYS.mon,
  scheduleTime: "09:00",
  sendOnWeekends: false,
  sendOnHolidays: false,
  timeZone: DEFAULT_TIME_ZONE,
});
const RUNTIME_PROVIDER_DEFAULTS = Object.freeze({
  communicationProvider: "slack",
  codeHostProvider: "github",
  deployEnvironment: "prod",
  deployProvider: "digitalocean",
  emailProvider: "gmail",
  aiProvider: "openai",
  errorTrackingProvider: "sentry",
});
const ENVIRONMENT_STATUS_STATES = Object.freeze({
  unknown: "unknown",
  healthy: "healthy",
  unhealthy: "unhealthy",
});
const ENVIRONMENT_CONNECTIVITY_STATES = Object.freeze({
  unknown: "unknown",
  reachable: "reachable",
  unreachable: "unreachable",
});
const ENVIRONMENT_STATUS_DEFAULTS = Object.freeze({
  enabled: false,
  targetChannelId: null,
  targetUrl: null,
  lastObservedState: ENVIRONMENT_STATUS_STATES.unknown,
  lastStateChangedAt: null,
  lastCheckedAt: null,
  lastHttpStatus: null,
  lastErrorMessage: null,
  consecutiveFailureCount: 0,
  lastConnectivityState: ENVIRONMENT_CONNECTIVITY_STATES.unknown,
  lastConnectivityCheckedAt: null,
  lastConnectivityErrorMessage: null,
  lastNotifiedState: null,
  lastNotifiedAt: null,
});
const SUPPORT_EMAIL_THREAD_STATUSES = Object.freeze({
  pending: "pending",
  responded: "responded",
});
const SUPPORT_EMAIL_DEFAULTS = Object.freeze({
  enabled: false,
  targetChannelId: null,
  onCallUserId: null,
  onCallExpiresAt: null,
  lastProcessedHistoryId: null,
  pendingHistoryId: null,
  watchExpirationAt: null,
  backfillCompletedAt: null,
  lastSyncAt: null,
});
const ERROR_TRACKING_DEFAULTS = Object.freeze({
  enabled: false,
  targetChannelId: null,
  projectSlug: null,
  environment: null,
  baselineCompletedAt: null,
  lastSyncAt: null,
  lastSyncError: null,
});
const ERROR_TRACKING_ISSUE_STATUSES = Object.freeze({
  unresolved: "unresolved",
  resolved: "resolved",
});
const COMMUNICATION_PROVIDERS = Object.freeze({
  slack: "slack",
  microsoftTeams: "microsoft_teams",
});
const CODE_HOST_PROVIDERS = Object.freeze({
  github: "github",
  bitbucket: "bitbucket",
});
const DEPLOY_PROVIDERS = Object.freeze({
  digitalocean: "digitalocean",
  aws: "aws",
});
const EMAIL_PROVIDERS = Object.freeze({
  gmail: "gmail",
  outlook: "outlook",
});
const AI_PROVIDERS = Object.freeze({
  openai: "openai",
  anthropic: "anthropic",
});
const ERROR_TRACKING_PROVIDERS = Object.freeze({
  sentry: "sentry",
  rollbar: "rollbar",
});

function createPool(databaseConnectionString) {
  if (!databaseConnectionString || databaseConnectionString.trim() === "") {
    throw new Error("DATABASE_URL is required");
  }

  return new Pool(buildPoolConfiguration(databaseConnectionString));
}

function buildPoolConfiguration(databaseConnectionString) {
  const poolConfiguration = {
    connectionString: stripSslUrlParameters(databaseConnectionString),
  };

  if (isTlsRequiredByDatabaseUrl(databaseConnectionString)) {
    // DigitalOcean managed Postgres commonly uses sslmode=require. In local/dev
    // environments this stays disabled unless explicitly requested in DATABASE_URL.
    poolConfiguration.ssl = { rejectUnauthorized: false };
  }

  return poolConfiguration;
}

function stripSslUrlParameters(databaseConnectionString) {
  const SSL_PARAMETER_NAMES = new Set(["sslmode", "sslcert", "sslkey", "sslrootcert"]);

  try {
    const parsedDatabaseUrl = new URL(databaseConnectionString);
    const parameterNames = [...parsedDatabaseUrl.searchParams.keys()];
    for (const parameterName of parameterNames) {
      if (SSL_PARAMETER_NAMES.has(parameterName.toLowerCase())) {
        parsedDatabaseUrl.searchParams.delete(parameterName);
      }
    }
    return parsedDatabaseUrl.toString();
  } catch (_error) {
    return stripSslUrlParametersFromMalformedUrl(databaseConnectionString, SSL_PARAMETER_NAMES);
  }
}

function stripSslUrlParametersFromMalformedUrl(databaseConnectionString, parameterNames) {
  const [baseAndQuery, hashFragment = ""] = String(databaseConnectionString).split("#");
  const [baseUrl, rawQuery = ""] = baseAndQuery.split("?");
  if (rawQuery === "") {
    return databaseConnectionString;
  }

  const filteredParameters = rawQuery
    .split("&")
    .filter((parameter) => parameter !== "")
    .filter((parameter) => {
      const [rawName] = parameter.split("=");
      return !parameterNames.has(decodeURIComponent(rawName || "").toLowerCase());
    });

  const rebuiltUrl =
    filteredParameters.length > 0
      ? `${baseUrl}?${filteredParameters.join("&")}`
      : baseUrl;

  return hashFragment === "" ? rebuiltUrl : `${rebuiltUrl}#${hashFragment}`;
}

function isTlsRequiredByDatabaseUrl(databaseConnectionString) {
  const sslMode = readSslModeFromDatabaseUrl(databaseConnectionString);
  return TLS_SSL_MODES.has(sslMode);
}

function readSslModeFromDatabaseUrl(databaseConnectionString) {
  try {
    const parsedDatabaseUrl = new URL(databaseConnectionString);
    return (parsedDatabaseUrl.searchParams.get("sslmode") || "").toLowerCase();
  } catch (_error) {
    const match = databaseConnectionString.match(/(?:\?|&)sslmode=([^&]+)/i);
    return match ? decodeURIComponent(match[1]).toLowerCase() : "";
  }
}

async function verifyConnection(pool) {
  await pool.query("SELECT 1");
}

async function runMigrations(pool) {
  const migrationFilePaths = readMigrationFilePaths(MIGRATIONS_DIRECTORY_PATH);
  for (const migrationFilePath of migrationFilePaths) {
    const migrationSql = fs.readFileSync(migrationFilePath, "utf8");
    await pool.query(migrationSql);
  }
}

function readMigrationFilePaths(migrationsDirectoryPath) {
  return fs
    .readdirSync(migrationsDirectoryPath)
    .filter((filename) => filename.endsWith(".sql"))
    .sort()
    .map((filename) => path.join(migrationsDirectoryPath, filename));
}

async function getLastProdDeployAt(pool) {
  const query = `
    SELECT COALESCE(MAX(deployed_at), ${EPOCH_UTC_TIMESTAMP_SQL}) AS last_deploy_at
    FROM deployments
    WHERE environment = 'prod'
  `;
  const result = await pool.query(query);
  return result.rows[0].last_deploy_at;
}

async function listBlockingPullRequests(pool, lastDeployAt) {
  const query = `
    SELECT repo, pr_number, title, url, status, merged_at, force_deploy_blocked
    FROM pull_requests
    WHERE merged_at > $1
      AND status NOT IN ('tested', 'deployed')
    ORDER BY merged_at ASC, pr_number ASC
  `;
  const result = await pool.query(query, [lastDeployAt]);
  return result.rows;
}

async function listDeployablePullRequestsForDeployment(
  pool,
  lastDeployAt,
  deploymentCutoffAt,
  options = {},
) {
  const deployableStatuses = options.includeUntested
    ? ["tested", "untested"]
    : ["tested"];
  const query = `
    SELECT
      repo,
      pr_number,
      title,
      url,
      status,
      tested_at,
      merged_at,
      force_deploy_blocked,
      (
        SELECT author_login
        FROM open_pr_review_state
        WHERE open_pr_review_state.repo = pull_requests.repo
          AND open_pr_review_state.pr_number = pull_requests.pr_number
      ) AS author_login
    FROM pull_requests
    WHERE merged_at > $1
      AND merged_at <= $2
      AND status = ANY($3::text[])
    ORDER BY merged_at ASC, pr_number ASC
  `;
  const result = await pool.query(query, [lastDeployAt, deploymentCutoffAt, deployableStatuses]);
  return result.rows;
}

async function upsertPullRequestAsUntested(pool, pullRequest) {
  const query = `
    INSERT INTO pull_requests (
      repo,
      pr_number,
      title,
      url,
      status,
      merged_at,
      tested_at,
      tested_by,
      deployed_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, 'untested', $5, NULL, NULL, NULL, NOW())
    ON CONFLICT (repo, pr_number)
    DO UPDATE SET
      title = EXCLUDED.title,
      url = EXCLUDED.url,
      status = 'untested',
      merged_at = EXCLUDED.merged_at,
      tested_at = NULL,
      tested_by = NULL,
      deployed_at = NULL,
      updated_at = NOW()
    RETURNING id, repo, pr_number, status, merged_at
  `;
  const queryValues = [
    pullRequest.repo,
    pullRequest.prNumber,
    pullRequest.title,
    pullRequest.url,
    pullRequest.mergedAt,
  ];
  const result = await pool.query(query, queryValues);
  return result.rows[0];
}

async function upsertPullRequestAsUntestedFromSync(pool, pullRequest) {
  const query = `
    INSERT INTO pull_requests (
      repo,
      pr_number,
      title,
      url,
      status,
      merged_at,
      tested_at,
      tested_by,
      deployed_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, 'untested', $5, NULL, NULL, NULL, NOW())
    ON CONFLICT (repo, pr_number)
    DO UPDATE SET
      title = EXCLUDED.title,
      url = EXCLUDED.url,
      merged_at = EXCLUDED.merged_at,
      status = CASE
        WHEN pull_requests.status = 'untested' THEN 'untested'
        ELSE pull_requests.status
      END,
      tested_at = CASE
        WHEN pull_requests.status = 'untested' THEN NULL
        ELSE pull_requests.tested_at
      END,
      tested_by = CASE
        WHEN pull_requests.status = 'untested' THEN NULL
        ELSE pull_requests.tested_by
      END,
      deployed_at = CASE
        WHEN pull_requests.status = 'untested' THEN NULL
        ELSE pull_requests.deployed_at
      END,
      updated_at = NOW()
    RETURNING id, repo, pr_number, status, merged_at
  `;
  const queryValues = [
    pullRequest.repo,
    pullRequest.prNumber,
    pullRequest.title,
    pullRequest.url,
    pullRequest.mergedAt,
  ];
  const result = await pool.query(query, queryValues);
  return result.rows[0];
}

async function markPullRequestTested(pool, prNumber, testedBy) {
  const existingPullRequest = await findMostRecentPullRequestByNumber(pool, prNumber);
  if (!existingPullRequest) {
    return { found: false };
  }

  if (existingPullRequest.status === "tested") {
    return {
      found: true,
      alreadyTested: true,
      pullRequest: existingPullRequest,
    };
  }

  const updateQuery = `
    UPDATE pull_requests
    SET status = 'tested',
        tested_at = NOW(),
        tested_by = $2,
        updated_at = NOW()
    WHERE id = $1
    RETURNING id, pr_number, status, tested_at, tested_by
  `;
  const updatedResult = await pool.query(updateQuery, [existingPullRequest.id, testedBy || null]);

  return {
    found: true,
    alreadyTested: false,
    pullRequest: updatedResult.rows[0],
  };
}

async function setPullRequestForceDeployBlocked(pool, prNumber, forceDeployBlocked) {
  const existingPullRequest = await findMostRecentPullRequestByNumber(pool, prNumber);
  if (!existingPullRequest) {
    return { found: false };
  }

  const normalizedForceDeployBlocked = Boolean(forceDeployBlocked);
  if (existingPullRequest.force_deploy_blocked === normalizedForceDeployBlocked) {
    return {
      found: true,
      alreadySet: true,
      pullRequest: existingPullRequest,
    };
  }

  const updateQuery = `
    UPDATE pull_requests
    SET force_deploy_blocked = $2,
        updated_at = NOW()
    WHERE id = $1
    RETURNING id, pr_number, status, force_deploy_blocked
  `;
  const updatedResult = await pool.query(updateQuery, [
    existingPullRequest.id,
    normalizedForceDeployBlocked,
  ]);

  return {
    found: true,
    alreadySet: false,
    pullRequest: updatedResult.rows[0],
  };
}

async function findMostRecentPullRequestByNumber(pool, prNumber) {
  const query = `
    SELECT id, pr_number, status, tested_at, tested_by, force_deploy_blocked
    FROM pull_requests
    WHERE pr_number = $1
    ORDER BY merged_at DESC
    LIMIT 1
  `;
  const result = await pool.query(query, [prNumber]);
  return result.rows[0] || null;
}

async function insertDeployment(pool, deployment) {
  const query = `
    INSERT INTO deployments (environment, provider, external_deploy_id, deployed_at)
    VALUES ($1, $2, $3, COALESCE($4, NOW()))
    RETURNING id, environment, provider, external_deploy_id, deployed_at
  `;
  const queryValues = [
    deployment.environment,
    deployment.provider,
    deployment.externalDeployId || null,
    deployment.deployedAt || null,
  ];
  const result = await pool.query(query, queryValues);
  return result.rows[0];
}

async function getDeploymentGateState(pool, environment) {
  const result = await pool.query(
    `
      SELECT environment, status, reason, changed_by, changed_at
      FROM deployment_gate_state
      WHERE environment = $1
    `,
    [normalizeDeployEnvironment(environment)],
  );
  return result.rows[0] || null;
}

async function setDeploymentGateState(pool, {
  actorUserId,
  environment,
  reason,
  status,
}) {
  const normalizedEnvironment = normalizeDeployEnvironment(environment);
  const normalizedStatus = status === "closed" ? "closed" : "open";
  const normalizedReason = normalizedStatus === "closed"
    ? String(reason || "").trim() || "Closed without a reason."
    : null;
  const result = await pool.query(
    `
      INSERT INTO deployment_gate_state (
        environment, status, reason, changed_by, changed_at
      )
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (environment) DO UPDATE SET
        status = EXCLUDED.status,
        reason = EXCLUDED.reason,
        changed_by = EXCLUDED.changed_by,
        changed_at = NOW()
      RETURNING environment, status, reason, changed_by, changed_at
    `,
    [normalizedEnvironment, normalizedStatus, normalizedReason, actorUserId || null],
  );
  return result.rows[0];
}

async function setDeploymentGateStateWithAudit(pool, {
  actorUserId,
  environment,
  reason,
  status,
  summary,
}) {
  const client = typeof pool.connect === "function" ? await pool.connect() : pool;
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    const state = await setDeploymentGateState(client, {
      actorUserId,
      environment,
      reason,
      status,
    });
    const event = await insertAuditEvent(client, {
      actorUserId,
      environment: state.environment,
      eventType: `gate_${state.status}`,
      metadata: { reason: state.reason },
      summary,
    });
    await client.query("COMMIT");
    transactionStarted = false;
    return { event, state };
  } catch (error) {
    if (transactionStarted) {
      await client.query("ROLLBACK");
    }
    throw error;
  } finally {
    if (client !== pool && typeof client.release === "function") {
      client.release();
    }
  }
}

async function createDeploymentConfirmation(pool, {
  environment,
  requestedBy,
  token,
}) {
  const result = await pool.query(
    `
      INSERT INTO deployment_confirmations (
        token, environment, requested_by, expires_at
      )
      VALUES ($1, $2, $3, NOW() + INTERVAL '10 minutes')
      RETURNING token, environment, requested_by, expires_at
    `,
    [token, normalizeDeployEnvironment(environment), requestedBy],
  );
  return result.rows[0];
}

async function consumeDeploymentConfirmation(pool, {
  environment,
  requestedBy,
  token,
}) {
  const result = await pool.query(
    `
      UPDATE deployment_confirmations
      SET consumed_at = NOW()
      WHERE token = $1
        AND environment = $2
        AND requested_by = $3
        AND consumed_at IS NULL
        AND expires_at > NOW()
      RETURNING token, environment, requested_by, expires_at, consumed_at
    `,
    [token, normalizeDeployEnvironment(environment), requestedBy],
  );
  return result.rows[0] || null;
}

async function insertAuditEvent(pool, {
  actorUserId,
  environment,
  eventType,
  metadata,
  summary,
}) {
  const result = await pool.query(
    `
      INSERT INTO calypso_audit_events (
        event_type, environment, actor_user_id, summary, metadata
      )
      VALUES ($1, $2, $3, $4, $5::jsonb)
      RETURNING id, event_type, environment, actor_user_id, summary, metadata, created_at
    `,
    [
      String(eventType || "unknown"),
      environment ? normalizeDeployEnvironment(environment) : null,
      actorUserId || null,
      String(summary || ""),
      JSON.stringify(metadata || {}),
    ],
  );
  return result.rows[0];
}

async function listAuditEvents(pool, { environment = null, limit = 20 } = {}) {
  const normalizedLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const normalizedEnvironment = environment ? normalizeDeployEnvironment(environment) : null;
  const result = await pool.query(
    `
      SELECT id, event_type, environment, actor_user_id, summary, metadata, created_at
      FROM calypso_audit_events
      WHERE ($1::text IS NULL OR environment = $1)
      ORDER BY created_at DESC, id DESC
      LIMIT $2
    `,
    [normalizedEnvironment, normalizedLimit],
  );
  return result.rows;
}

async function reserveDeploymentRun(pool, {
  actorUserId,
  environment,
  provider,
}) {
  try {
    const result = await pool.query(
      `
        WITH expired_runs AS (
          UPDATE deployment_runs
          SET status = 'failed',
              failure_message = 'Deployment reservation expired before completion.',
              completed_at = NOW(),
              updated_at = NOW()
          WHERE environment = $1
            AND status IN ('reserved', 'triggered')
            AND updated_at < NOW() - INTERVAL '2 hours'
          RETURNING id
        )
        INSERT INTO deployment_runs (
          environment, provider, status, requested_by
        )
        VALUES ($1, $2, 'reserved', $3)
        RETURNING *
      `,
      [normalizeDeployEnvironment(environment), provider || null, actorUserId || null],
    );
    return { acquired: true, run: result.rows[0] };
  } catch (error) {
    if (error?.code !== "23505") {
      throw error;
    }
    return {
      acquired: false,
      run: await getActiveDeploymentRun(pool, environment),
    };
  }
}

async function getActiveDeploymentRun(pool, environment) {
  const result = await pool.query(
    `
      SELECT *
      FROM deployment_runs
      WHERE environment = $1
        AND status IN ('reserved', 'triggered')
      ORDER BY started_at DESC
      LIMIT 1
    `,
    [normalizeDeployEnvironment(environment)],
  );
  return result.rows[0] || null;
}

async function markDeploymentRunTriggered(pool, runId, {
  externalDeploymentId,
  provider,
}) {
  const result = await pool.query(
    `
      UPDATE deployment_runs
      SET status = 'triggered',
          provider = COALESCE($2, provider),
          external_deploy_id = $3,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [runId, provider || null, externalDeploymentId || null],
  );
  return result.rows[0] || null;
}

async function completeDeploymentRun(pool, runId, {
  failureMessage = null,
  status,
}) {
  const normalizedStatus = status === "succeeded"
    ? "succeeded"
    : status === "untracked"
      ? "untracked"
      : "failed";
  const result = await pool.query(
    `
      UPDATE deployment_runs
      SET status = $2,
          failure_message = $3,
          completed_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [runId, normalizedStatus, failureMessage],
  );
  return result.rows[0] || null;
}

async function markPullRequestsDeployedSince(pool, lastDeployAt, deployedAt) {
  const query = `
    UPDATE pull_requests
    SET status = 'deployed',
        deployed_at = $2,
        updated_at = NOW()
    WHERE merged_at > $1
      AND status IN ('tested', 'untested')
    RETURNING
      repo,
      pr_number,
      title,
      url,
      (
        SELECT author_login
        FROM open_pr_review_state
        WHERE open_pr_review_state.repo = pull_requests.repo
          AND open_pr_review_state.pr_number = pull_requests.pr_number
      ) AS author_login
  `;
  const result = await pool.query(query, [lastDeployAt, deployedAt]);
  return {
    deployedPullRequestCount: result.rowCount,
    deployedPullRequests: result.rows,
  };
}

async function markPullRequestsDeployed(pool, pullRequests, deployedAt) {
  const deploymentTargets = normalizeDeploymentPullRequestTargets(pullRequests);
  if (deploymentTargets.length === 0) {
    return {
      deployedPullRequestCount: 0,
      deployedPullRequests: [],
    };
  }

  const query = `
    WITH targets AS (
      SELECT *
      FROM UNNEST($1::text[], $2::integer[]) WITH ORDINALITY AS target(repo, pr_number, target_order)
    ),
    updated AS (
      UPDATE pull_requests
      SET status = 'deployed',
          deployed_at = $3,
          updated_at = NOW()
      FROM targets
      WHERE pull_requests.repo = targets.repo
        AND pull_requests.pr_number = targets.pr_number
        AND pull_requests.status IN ('tested', 'untested')
      RETURNING
        pull_requests.repo,
        pull_requests.pr_number,
        pull_requests.title,
        pull_requests.url,
        (pull_requests.tested_at IS NOT NULL) AS tested,
        (
          SELECT author_login
          FROM open_pr_review_state
          WHERE open_pr_review_state.repo = pull_requests.repo
            AND open_pr_review_state.pr_number = pull_requests.pr_number
        ) AS author_login,
        targets.target_order
    )
    SELECT repo, pr_number, title, url, author_login, tested
    FROM updated
    ORDER BY target_order ASC
  `;
  const result = await pool.query(query, [
    deploymentTargets.map((target) => target.repo),
    deploymentTargets.map((target) => target.prNumber),
    deployedAt,
  ]);

  return {
    deployedPullRequestCount: result.rows.length,
    deployedPullRequests: result.rows,
  };
}

async function markAllUntestedPullRequestsTested(pool, testedBy) {
  const query = `
    UPDATE pull_requests
    SET status = 'tested',
        tested_at = NOW(),
        tested_by = $1,
        updated_at = NOW()
    WHERE status = 'untested'
    RETURNING id
  `;
  const result = await pool.query(query, [testedBy || null]);
  return result.rowCount;
}

async function listRecentlyTestedPullRequests(pool, sinceTimestamp) {
  const query = `
    SELECT repo, pr_number, title, url, status, tested_at, tested_by
    FROM pull_requests
    WHERE tested_at IS NOT NULL
      AND tested_at >= $1
    ORDER BY tested_at DESC, pr_number DESC
  `;
  const result = await pool.query(query, [sinceTimestamp]);
  return result.rows;
}

async function upsertOpenPullRequestReviewState(pool, pullRequestState) {
  const query = `
    INSERT INTO open_pr_review_state (
      repo,
      pr_number,
      title,
      url,
      author_login,
      base_branch,
      is_draft,
      lifecycle_state,
      review_state,
      opened_at,
      opened_for_review_at,
      closed_at,
      merged_at,
      last_reviewed_at,
      last_modified_at,
      codex_approved,
      updated_at
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, COALESCE($16, false), NOW()
    )
    ON CONFLICT (repo, pr_number)
    DO UPDATE SET
      title = EXCLUDED.title,
      url = EXCLUDED.url,
      author_login = EXCLUDED.author_login,
      base_branch = EXCLUDED.base_branch,
      is_draft = EXCLUDED.is_draft,
      lifecycle_state = EXCLUDED.lifecycle_state,
      review_state = EXCLUDED.review_state,
      opened_at = EXCLUDED.opened_at,
      opened_for_review_at = EXCLUDED.opened_for_review_at,
      closed_at = EXCLUDED.closed_at,
      merged_at = EXCLUDED.merged_at,
      last_reviewed_at = COALESCE(EXCLUDED.last_reviewed_at, open_pr_review_state.last_reviewed_at),
      last_modified_at = GREATEST(
        EXCLUDED.last_modified_at,
        open_pr_review_state.last_modified_at
      ),
      codex_approved = CASE
        WHEN $16 IS NULL THEN open_pr_review_state.codex_approved
        ELSE EXCLUDED.codex_approved
      END,
      updated_at = NOW()
    RETURNING
      repo,
      pr_number,
      title,
      author_login,
      lifecycle_state,
      review_state,
      codex_approved,
      opened_for_review_at
  `;
  const queryValues = [
    pullRequestState.repo,
    pullRequestState.prNumber,
    pullRequestState.title || null,
    pullRequestState.url || null,
    pullRequestState.authorLogin,
    pullRequestState.baseBranch,
    Boolean(pullRequestState.isDraft),
    pullRequestState.lifecycleState,
    pullRequestState.reviewState,
    pullRequestState.openedAt,
    pullRequestState.openedForReviewAt || null,
    pullRequestState.closedAt || null,
    pullRequestState.mergedAt || null,
    pullRequestState.lastReviewedAt || null,
    pullRequestState.lastModifiedAt || pullRequestState.openedAt,
    pullRequestState.codexApproved ?? null,
  ];
  const result = await pool.query(query, queryValues);
  return result.rows[0];
}

async function updatePullRequestReviewSubmission(pool, reviewStateUpdate) {
  const hasReviewState = reviewStateUpdate.reviewState !== undefined && reviewStateUpdate.reviewState !== null;
  const normalizedReviewState = hasReviewState
    ? normalizePullRequestReviewState(reviewStateUpdate.reviewState)
    : null;
  if (hasReviewState && !normalizedReviewState) {
    throw new Error(`Unsupported review state: ${reviewStateUpdate.reviewState}`);
  }

  const query = `
    UPDATE open_pr_review_state
    SET review_state = COALESCE($3, review_state),
        last_reviewed_at = $4,
        last_modified_at = GREATEST(COALESCE($4, last_modified_at), last_modified_at),
        updated_at = NOW()
    WHERE repo = $1
      AND pr_number = $2
    RETURNING repo, pr_number, review_state, last_reviewed_at
  `;
  const queryValues = [
    reviewStateUpdate.repo,
    reviewStateUpdate.prNumber,
    normalizedReviewState,
    reviewStateUpdate.lastReviewedAt || null,
  ];
  const result = await pool.query(query, queryValues);
  return result.rows[0] || null;
}

async function updatePullRequestCodexApproval(pool, approvalUpdate) {
  const query = `
    UPDATE open_pr_review_state
    SET codex_approved = $3,
        updated_at = NOW()
    WHERE repo = $1
      AND pr_number = $2
      AND lifecycle_state = 'open'
    RETURNING repo, pr_number, codex_approved
  `;
  const queryValues = [
    approvalUpdate.repo,
    approvalUpdate.prNumber,
    Boolean(approvalUpdate.codexApproved),
  ];
  const result = await pool.query(query, queryValues);
  return result.rows[0] || null;
}

async function listOpenPullRequestsWaitingOnReviewSince(pool, sinceTimestamp) {
  const query = `
    SELECT
      repo,
      pr_number,
      title,
      url,
      author_login,
      is_draft,
      review_state,
      codex_approved,
      opened_for_review_at,
      COALESCE(last_modified_at, last_reviewed_at, opened_for_review_at, opened_at) AS last_modified_at
    FROM open_pr_review_state
    WHERE lifecycle_state = 'open'
      AND is_draft = false
      AND review_state IN ('waiting', 'changes_requested')
      AND opened_for_review_at IS NOT NULL
      AND opened_for_review_at >= $1
    ORDER BY opened_for_review_at ASC, pr_number ASC
  `;
  const result = await pool.query(query, [sinceTimestamp]);
  return result.rows;
}

async function listOpenPullRequestsForReviewRecapSince(
  pool,
  sinceTimestamp,
  backburnerBeforeTimestamp = new Date(0),
) {
  const query = `
    SELECT
      repo,
      pr_number,
      title,
      url,
      author_login,
      is_draft,
      review_state,
      codex_approved,
      opened_at,
      opened_for_review_at,
      COALESCE(last_modified_at, last_reviewed_at, opened_for_review_at, opened_at) AS last_modified_at
    FROM open_pr_review_state
    WHERE lifecycle_state = 'open'
      AND is_draft = false
      AND (
        COALESCE(opened_for_review_at, opened_at) >= $1
        OR COALESCE(last_modified_at, last_reviewed_at, opened_for_review_at, opened_at) < $2
      )
    ORDER BY COALESCE(opened_for_review_at, opened_at) ASC, pr_number ASC
  `;
  const result = await pool.query(query, [sinceTimestamp, backburnerBeforeTimestamp]);
  return result.rows;
}

async function listTrackedOpenPullRequestsForCodexApproval(pool, options) {
  const query = `
    SELECT
      repo,
      pr_number,
      codex_approved
    FROM open_pr_review_state
    WHERE repo = $1
      AND base_branch = $2
      AND lifecycle_state = 'open'
    ORDER BY pr_number ASC
  `;
  const result = await pool.query(query, [
    options.repo,
    options.baseBranch,
  ]);
  return result.rows;
}

async function markStaleOpenPullRequestsClosed(pool, options) {
  const result = await pool.query(
    `
      UPDATE open_pr_review_state
      SET lifecycle_state = 'closed',
          closed_at = $4,
          updated_at = NOW()
      WHERE repo = $1
        AND base_branch = $2
        AND lifecycle_state = 'open'
        AND NOT (pr_number = ANY($3::INT[]))
      RETURNING id
    `,
    [
      options.repo,
      options.baseBranch,
      Array.isArray(options.openPrNumbers) ? options.openPrNumbers : [],
      options.closedAt || null,
    ],
  );
  return result.rowCount;
}

async function getReviewRecapConfig(pool) {
  const result = await pool.query(
    `
      SELECT
        target_channel_id,
        review_scope,
        recency_value,
        recency_unit,
        schedule_weekday,
        schedule_time,
        send_on_weekends,
        send_on_holidays,
        timezone,
        last_sent_slot_at
      FROM review_recap_config
      WHERE id = 1
      LIMIT 1
    `,
  );

  const row = result.rows[0];
  if (!row) {
    return {
      targetChannelId: null,
      reviewScope: REVIEW_RECAP_DEFAULTS.reviewScope,
      recencyValue: REVIEW_RECAP_DEFAULTS.recencyValue,
      recencyUnit: REVIEW_RECAP_DEFAULTS.recencyUnit,
      scheduleWeekday: REVIEW_RECAP_DEFAULTS.scheduleWeekday,
      scheduleTime: REVIEW_RECAP_DEFAULTS.scheduleTime,
      sendOnWeekends: REVIEW_RECAP_DEFAULTS.sendOnWeekends,
      sendOnHolidays: REVIEW_RECAP_DEFAULTS.sendOnHolidays,
      timeZone: REVIEW_RECAP_DEFAULTS.timeZone,
      lastSentSlotAt: null,
    };
  }

  return {
    targetChannelId: row.target_channel_id || null,
    reviewScope:
      normalizeReviewRecapScope(row.review_scope) || REVIEW_RECAP_DEFAULTS.reviewScope,
    recencyValue: row.recency_value || REVIEW_RECAP_DEFAULTS.recencyValue,
    recencyUnit: normalizeReviewRecencyUnit(row.recency_unit) || REVIEW_RECAP_DEFAULTS.recencyUnit,
    scheduleWeekday:
      normalizeReviewScheduleWeekday(row.schedule_weekday) || REVIEW_RECAP_DEFAULTS.scheduleWeekday,
    scheduleTime:
      normalizeReviewScheduleTime(row.schedule_time) || REVIEW_RECAP_DEFAULTS.scheduleTime,
    sendOnWeekends: normalizeReviewRecapBoolean(
      row.send_on_weekends,
      REVIEW_RECAP_DEFAULTS.sendOnWeekends,
    ),
    sendOnHolidays: normalizeReviewRecapBoolean(
      row.send_on_holidays,
      REVIEW_RECAP_DEFAULTS.sendOnHolidays,
    ),
    timeZone: normalizeTimeZone(row.timezone) || REVIEW_RECAP_DEFAULTS.timeZone,
    lastSentSlotAt: row.last_sent_slot_at || null,
  };
}

async function getEnvironmentStatusConfig(pool) {
  const result = await pool.query(
    `
      SELECT
        enabled,
        target_url,
        target_channel_id,
        last_observed_state,
        last_state_changed_at,
        last_checked_at,
        last_http_status,
        last_error_message,
        consecutive_failure_count,
        last_connectivity_state,
        last_connectivity_checked_at,
        last_connectivity_error_message,
        last_notified_state,
        last_notified_at
      FROM environment_status_config
      WHERE id = 1
      LIMIT 1
    `,
  );

  return mapEnvironmentStatusConfigRow(result.rows[0]) || { ...ENVIRONMENT_STATUS_DEFAULTS };
}

async function getSupportEmailConfig(pool) {
  const result = await pool.query(
    `
      SELECT
        enabled,
        target_channel_id,
        on_call_user_id,
        on_call_expires_at,
        last_processed_history_id,
        pending_history_id,
        watch_expiration_at,
        backfill_completed_at,
        last_sync_at
      FROM support_email_config
      WHERE id = 1
      LIMIT 1
    `,
  );

  return mapSupportEmailConfigRow(result.rows[0]) || { ...SUPPORT_EMAIL_DEFAULTS };
}

async function getErrorTrackingConfig(pool) {
  const result = await pool.query(
    `
      SELECT
        enabled,
        target_channel_id,
        project_slug,
        environment,
        baseline_completed_at,
        last_sync_at,
        last_sync_error
      FROM error_tracking_config
      WHERE id = 1
      LIMIT 1
    `,
  );

  return mapErrorTrackingConfigRow(result.rows[0]) || { ...ERROR_TRACKING_DEFAULTS };
}

async function getRuntimeProviderConfig(pool) {
  const result = await pool.query(
    `
      SELECT
        communication_provider,
        code_host_provider,
        deploy_environment,
        deploy_provider,
        email_provider,
        ai_provider,
        error_tracking_provider
      FROM runtime_config
      WHERE id = 1
      LIMIT 1
    `,
  );

  const row = result.rows[0] || {};
  return {
    communicationProvider:
      normalizeCommunicationProvider(row.communication_provider) ||
      RUNTIME_PROVIDER_DEFAULTS.communicationProvider,
    codeHostProvider:
      normalizeCodeHostProvider(row.code_host_provider) ||
      RUNTIME_PROVIDER_DEFAULTS.codeHostProvider,
    deployEnvironment:
      normalizeDeployEnvironment(row.deploy_environment) ||
      RUNTIME_PROVIDER_DEFAULTS.deployEnvironment,
    deployProvider:
      normalizeDeployProvider(row.deploy_provider) ||
      RUNTIME_PROVIDER_DEFAULTS.deployProvider,
    emailProvider:
      normalizeEmailProvider(row.email_provider) ||
      RUNTIME_PROVIDER_DEFAULTS.emailProvider,
    aiProvider:
      normalizeAiProvider(row.ai_provider) ||
      RUNTIME_PROVIDER_DEFAULTS.aiProvider,
    errorTrackingProvider:
      normalizeErrorTrackingProvider(row.error_tracking_provider) ||
      RUNTIME_PROVIDER_DEFAULTS.errorTrackingProvider,
  };
}

async function setReviewRecapChannel(pool, targetChannelId, updatedBy) {
  const normalizedChannelId = normalizeReviewRecapChannelId(targetChannelId);
  const normalizedUserId = normalizeUserId(updatedBy);
  if (!normalizedChannelId) {
    throw new Error(`Unsupported review recap channel id: ${targetChannelId}`);
  }
  if (!normalizedUserId) {
    throw new Error("user id is required");
  }

  return upsertReviewRecapConfig(pool, {
    targetChannelId: normalizedChannelId,
    updatedBy: normalizedUserId,
  });
}

async function setReviewRecapRecency(pool, recencyValue, recencyUnit, updatedBy) {
  const normalizedRecencyValue = normalizePositiveInteger(recencyValue);
  const normalizedRecencyUnit = normalizeReviewRecencyUnit(recencyUnit);
  const normalizedUserId = normalizeUserId(updatedBy);
  if (!normalizedRecencyValue) {
    throw new Error(`Unsupported review recap recency value: ${recencyValue}`);
  }
  if (!normalizedRecencyUnit) {
    throw new Error(`Unsupported review recap recency unit: ${recencyUnit}`);
  }
  if (!normalizedUserId) {
    throw new Error("user id is required");
  }

  return upsertReviewRecapConfig(pool, {
    reviewScope: REVIEW_RECAP_SCOPES.legacy,
    recencyValue: normalizedRecencyValue,
    recencyUnit: normalizedRecencyUnit,
    updatedBy: normalizedUserId,
  });
}

async function setReviewRecapScope(pool, reviewScope, updatedBy) {
  const normalizedReviewScope = normalizeReviewRecapScope(reviewScope);
  const normalizedUserId = normalizeUserId(updatedBy);
  if (!normalizedReviewScope || normalizedReviewScope === REVIEW_RECAP_SCOPES.legacy) {
    throw new Error(`Unsupported review recap scope: ${reviewScope}`);
  }
  if (!normalizedUserId) {
    throw new Error("user id is required");
  }

  return upsertReviewRecapConfig(pool, {
    reviewScope: normalizedReviewScope,
    updatedBy: normalizedUserId,
  });
}

async function setReviewRecapSchedule(pool, scheduleWeekday, scheduleTime, updatedBy) {
  const normalizedScheduleWeekday = normalizeReviewScheduleWeekday(scheduleWeekday);
  const normalizedScheduleTime = normalizeReviewScheduleTime(scheduleTime);
  const normalizedUserId = normalizeUserId(updatedBy);
  const scheduleUpdatedAt = new Date().toISOString();
  if (!normalizedScheduleWeekday) {
    throw new Error(`Unsupported review recap schedule weekday: ${scheduleWeekday}`);
  }
  if (!normalizedScheduleTime) {
    throw new Error(`Unsupported review recap schedule time: ${scheduleTime}`);
  }
  if (!normalizedUserId) {
    throw new Error("user id is required");
  }

  return upsertReviewRecapConfig(pool, {
    scheduleWeekday: normalizedScheduleWeekday,
    scheduleTime: normalizedScheduleTime,
    lastSentSlotAt: scheduleUpdatedAt,
    updatedBy: normalizedUserId,
  });
}

async function setReviewRecapTimeZone(pool, timeZone, updatedBy) {
  const normalizedTimeZone = normalizeTimeZone(timeZone);
  const normalizedUserId = normalizeUserId(updatedBy);
  if (!normalizedTimeZone) {
    throw new Error(`Unsupported review recap timezone: ${timeZone}`);
  }
  if (!normalizedUserId) {
    throw new Error("user id is required");
  }

  return upsertReviewRecapConfig(pool, {
    timeZone: normalizedTimeZone,
    updatedBy: normalizedUserId,
  });
}

async function setReviewRecapSendWeekends(pool, sendOnWeekends, updatedBy) {
  const normalizedSendOnWeekends = normalizeReviewRecapBoolean(sendOnWeekends, null);
  const normalizedUserId = normalizeUserId(updatedBy);
  if (normalizedSendOnWeekends === null) {
    throw new Error(`Unsupported review recap weekend toggle: ${sendOnWeekends}`);
  }
  if (!normalizedUserId) {
    throw new Error("user id is required");
  }

  return upsertReviewRecapConfig(pool, {
    sendOnWeekends: normalizedSendOnWeekends,
    updatedBy: normalizedUserId,
  });
}

async function setReviewRecapSendHolidays(pool, sendOnHolidays, updatedBy) {
  const normalizedSendOnHolidays = normalizeReviewRecapBoolean(sendOnHolidays, null);
  const normalizedUserId = normalizeUserId(updatedBy);
  if (normalizedSendOnHolidays === null) {
    throw new Error(`Unsupported review recap holiday toggle: ${sendOnHolidays}`);
  }
  if (!normalizedUserId) {
    throw new Error("user id is required");
  }

  return upsertReviewRecapConfig(pool, {
    sendOnHolidays: normalizedSendOnHolidays,
    updatedBy: normalizedUserId,
  });
}

async function setEnvironmentStatusEnabled(pool, enabled, updatedBy) {
  const normalizedEnabled = normalizeBoolean(enabled, null);
  const normalizedUserId = normalizeUserId(updatedBy);
  if (normalizedEnabled === null) {
    throw new Error(`Unsupported environment status enabled value: ${enabled}`);
  }
  if (!normalizedUserId) {
    throw new Error("user id is required");
  }

  return upsertEnvironmentStatusConfig(pool, {
    enabled: normalizedEnabled,
    updatedBy: normalizedUserId,
    lastObservedState: ENVIRONMENT_STATUS_STATES.unknown,
    consecutiveFailureCount: 0,
    lastConnectivityState: ENVIRONMENT_CONNECTIVITY_STATES.unknown,
    clearLastStateChangedAt: true,
    clearLastCheckedAt: true,
    clearLastHttpStatus: true,
    clearLastErrorMessage: true,
    clearLastConnectivityCheckedAt: true,
    clearLastConnectivityErrorMessage: true,
    clearLastNotifiedState: true,
    clearLastNotifiedAt: true,
  });
}

async function setEnvironmentStatusUrl(pool, targetUrl, updatedBy) {
  const normalizedTargetUrl = normalizeUrl(targetUrl);
  const normalizedUserId = normalizeUserId(updatedBy);
  if (!normalizedTargetUrl) {
    throw new Error(`Unsupported environment status url: ${targetUrl}`);
  }
  if (!normalizedUserId) {
    throw new Error("user id is required");
  }

  return upsertEnvironmentStatusConfig(pool, {
    targetUrl: normalizedTargetUrl,
    updatedBy: normalizedUserId,
    lastObservedState: ENVIRONMENT_STATUS_STATES.unknown,
    consecutiveFailureCount: 0,
    lastConnectivityState: ENVIRONMENT_CONNECTIVITY_STATES.unknown,
    clearLastStateChangedAt: true,
    clearLastCheckedAt: true,
    clearLastHttpStatus: true,
    clearLastErrorMessage: true,
    clearLastConnectivityCheckedAt: true,
    clearLastConnectivityErrorMessage: true,
    clearLastNotifiedState: true,
    clearLastNotifiedAt: true,
  });
}

async function setEnvironmentStatusChannel(pool, targetChannelId, updatedBy) {
  const normalizedChannelId = normalizeOptionalText(targetChannelId);
  const normalizedUserId = normalizeUserId(updatedBy);
  if (!normalizedChannelId) {
    throw new Error(`Unsupported environment status channel id: ${targetChannelId}`);
  }
  if (!normalizedUserId) {
    throw new Error("user id is required");
  }

  return upsertEnvironmentStatusConfig(pool, {
    targetChannelId: normalizedChannelId,
    updatedBy: normalizedUserId,
  });
}

async function recordEnvironmentStatusObservation(
  pool,
  {
    lastObservedState,
    lastStateChangedAt,
    lastCheckedAt,
    lastHttpStatus,
    lastErrorMessage,
    consecutiveFailureCount,
  },
) {
  const normalizedObservedState = normalizeEnvironmentStatusState(lastObservedState);
  const normalizedHttpStatus = normalizeNullableInteger(lastHttpStatus);
  const normalizedErrorMessage = normalizeOptionalText(lastErrorMessage);
  const normalizedFailureCount = normalizeNonNegativeInteger(consecutiveFailureCount);
  if (!normalizedObservedState) {
    throw new Error(`Unsupported environment status state: ${lastObservedState}`);
  }
  if (
    consecutiveFailureCount !== undefined &&
    consecutiveFailureCount !== null &&
    normalizedFailureCount === null
  ) {
    throw new Error(
      `Unsupported environment consecutive failure count: ${consecutiveFailureCount}`,
    );
  }

  const result = await pool.query(
    `
      UPDATE environment_status_config
      SET last_observed_state = $1,
          last_state_changed_at = COALESCE($2::timestamptz, environment_status_config.last_state_changed_at),
          last_checked_at = COALESCE($3::timestamptz, NOW()),
          last_http_status = $4,
          last_error_message = $5,
          consecutive_failure_count = COALESCE($6, environment_status_config.consecutive_failure_count),
          updated_at = NOW()
      WHERE id = 1
      RETURNING
        enabled,
        target_url,
        target_channel_id,
        last_observed_state,
        last_state_changed_at,
        last_checked_at,
        last_http_status,
        last_error_message,
        consecutive_failure_count,
        last_connectivity_state,
        last_connectivity_checked_at,
        last_connectivity_error_message,
        last_notified_state,
        last_notified_at
    `,
    [
      normalizedObservedState,
      lastStateChangedAt || null,
      lastCheckedAt || null,
      normalizedHttpStatus,
      normalizedErrorMessage,
      normalizedFailureCount,
    ],
  );

  return mapEnvironmentStatusConfigRow(result.rows[0]);
}

async function updateEnvironmentStatusRuntimeState(pool, updates = {}) {
  return upsertEnvironmentStatusConfig(pool, updates);
}

async function markEnvironmentStatusNotificationSent(pool, state, notifiedAt) {
  const normalizedState = normalizeEnvironmentNotifiedState(state);
  if (!normalizedState) {
    throw new Error(`Unsupported environment status notified state: ${state}`);
  }

  const result = await pool.query(
    `
      UPDATE environment_status_config
      SET last_notified_state = $1,
          last_notified_at = COALESCE($2::timestamptz, NOW()),
          updated_at = NOW()
      WHERE id = 1
      RETURNING
        enabled,
        target_url,
        target_channel_id,
        last_observed_state,
        last_state_changed_at,
        last_checked_at,
        last_http_status,
        last_error_message,
        consecutive_failure_count,
        last_connectivity_state,
        last_connectivity_checked_at,
        last_connectivity_error_message,
        last_notified_state,
        last_notified_at
    `,
    [normalizedState, notifiedAt || null],
  );

  return mapEnvironmentStatusConfigRow(result.rows[0]);
}

async function setSupportEmailMonitorEnabled(pool, enabled, updatedBy) {
  const normalizedEnabled = normalizeBoolean(enabled, null);
  const normalizedUserId = normalizeUserId(updatedBy);
  if (normalizedEnabled === null) {
    throw new Error(`Unsupported support email enabled value: ${enabled}`);
  }
  if (!normalizedUserId) {
    throw new Error("user id is required");
  }

  return upsertSupportEmailConfig(pool, {
    enabled: normalizedEnabled,
    updatedBy: normalizedUserId,
  });
}

async function setSupportEmailChannel(pool, targetChannelId, updatedBy) {
  const normalizedChannelId = normalizeOptionalText(targetChannelId);
  const normalizedUserId = normalizeUserId(updatedBy);
  if (!normalizedChannelId) {
    throw new Error(`Unsupported support email channel id: ${targetChannelId}`);
  }
  if (!normalizedUserId) {
    throw new Error("user id is required");
  }

  return upsertSupportEmailConfig(pool, {
    targetChannelId: normalizedChannelId,
    updatedBy: normalizedUserId,
  });
}

async function setSupportEmailOnCall(pool, userId, expiresAt, updatedBy) {
  const normalizedOnCallUserId = normalizeUserId(userId);
  const normalizedUserId = normalizeUserId(updatedBy);
  if (!normalizedOnCallUserId) {
    throw new Error(`Unsupported support email on-call user id: ${userId}`);
  }
  if (!expiresAt) {
    throw new Error("support email on-call expiration is required");
  }
  if (!normalizedUserId) {
    throw new Error("user id is required");
  }

  return upsertSupportEmailConfig(pool, {
    onCallUserId: normalizedOnCallUserId,
    onCallExpiresAt: expiresAt,
    updatedBy: normalizedUserId,
  });
}

async function clearSupportEmailOnCall(pool, updatedBy) {
  const normalizedUserId = normalizeUserId(updatedBy);
  if (!normalizedUserId) {
    throw new Error("user id is required");
  }

  return upsertSupportEmailConfig(pool, {
    clearOnCall: true,
    updatedBy: normalizedUserId,
  });
}

async function setErrorTrackingEnabled(pool, enabled, updatedBy) {
  const normalizedEnabled = normalizeBoolean(enabled, null);
  const normalizedUserId = normalizeUserId(updatedBy);
  if (normalizedEnabled === null) {
    throw new Error(`Unsupported error tracking enabled value: ${enabled}`);
  }
  if (!normalizedUserId) {
    throw new Error("user id is required");
  }

  return upsertErrorTrackingConfig(pool, {
    enabled: normalizedEnabled,
    updatedBy: normalizedUserId,
    clearBaselineCompletedAt: true,
    clearLastSyncAt: true,
    clearLastSyncError: true,
  });
}

async function setErrorTrackingChannel(pool, targetChannelId, updatedBy) {
  const normalizedChannelId = normalizeOptionalText(targetChannelId);
  const normalizedUserId = normalizeUserId(updatedBy);
  if (!normalizedChannelId) {
    throw new Error(`Unsupported error tracking channel id: ${targetChannelId}`);
  }
  if (!normalizedUserId) {
    throw new Error("user id is required");
  }

  return upsertErrorTrackingConfig(pool, {
    targetChannelId: normalizedChannelId,
    updatedBy: normalizedUserId,
  });
}

async function setErrorTrackingProject(pool, projectSlug, updatedBy) {
  const normalizedProjectSlug = normalizeErrorTrackingProjectSlug(projectSlug);
  const normalizedUserId = normalizeUserId(updatedBy);
  if (!normalizedProjectSlug) {
    throw new Error(`Unsupported error tracking project slug: ${projectSlug}`);
  }
  if (!normalizedUserId) {
    throw new Error("user id is required");
  }

  return upsertErrorTrackingConfig(pool, {
    projectSlug: normalizedProjectSlug,
    updatedBy: normalizedUserId,
    clearBaselineCompletedAt: true,
    clearLastSyncAt: true,
    clearLastSyncError: true,
  });
}

async function setErrorTrackingEnvironment(pool, environment, updatedBy) {
  const normalizedEnvironment = normalizeErrorTrackingEnvironment(environment);
  const normalizedUserId = normalizeUserId(updatedBy);
  if (normalizedEnvironment === undefined) {
    throw new Error(`Unsupported error tracking environment: ${environment}`);
  }
  if (!normalizedUserId) {
    throw new Error("user id is required");
  }

  return upsertErrorTrackingConfig(pool, {
    environment: normalizedEnvironment,
    updatedBy: normalizedUserId,
    clearEnvironment: normalizedEnvironment === null,
    clearBaselineCompletedAt: true,
    clearLastSyncAt: true,
    clearLastSyncError: true,
  });
}

async function updateErrorTrackingRuntimeState(pool, updates) {
  return upsertErrorTrackingConfig(pool, updates);
}

async function listOpenErrorTrackingIssues(pool, { environment, projectSlug, provider }) {
  const scope = normalizeErrorTrackingScope({ environment, projectSlug, provider });
  const result = await pool.query(
    `
      SELECT
        id,
        provider,
        project_slug,
        environment_key,
        external_issue_id,
        short_id,
        title,
        culprit,
        level,
        permalink,
        event_count,
        status,
        opened_at,
        last_seen_at,
        resolved_at,
        regression_count,
        notification_sent_at
      FROM error_tracking_issues
      WHERE provider = $1
        AND project_slug = $2
        AND environment_key = $3
        AND status = '${ERROR_TRACKING_ISSUE_STATUSES.unresolved}'
      ORDER BY last_seen_at DESC, opened_at DESC, id DESC
    `,
    [scope.provider, scope.projectSlug, scope.environmentKey],
  );

  return result.rows.map(mapErrorTrackingIssueRow);
}

async function listUnnotifiedErrorTrackingIssues(pool, { environment, projectSlug, provider }) {
  const scope = normalizeErrorTrackingScope({ environment, projectSlug, provider });
  const result = await pool.query(
    `
      SELECT
        id,
        provider,
        project_slug,
        environment_key,
        external_issue_id,
        short_id,
        title,
        culprit,
        level,
        permalink,
        event_count,
        status,
        opened_at,
        last_seen_at,
        resolved_at,
        regression_count,
        notification_sent_at
      FROM error_tracking_issues
      WHERE provider = $1
        AND project_slug = $2
        AND environment_key = $3
        AND status = '${ERROR_TRACKING_ISSUE_STATUSES.unresolved}'
        AND notification_sent_at IS NULL
      ORDER BY last_seen_at DESC, opened_at DESC, id DESC
    `,
    [scope.provider, scope.projectSlug, scope.environmentKey],
  );

  return result.rows.map(mapErrorTrackingIssueRow);
}

async function markErrorTrackingIssueNotificationSent(pool, issueId, notificationSentAt) {
  const normalizedIssueId = normalizePositiveInteger(issueId);
  if (!normalizedIssueId) {
    throw new Error(`Unsupported error tracking issue id: ${issueId}`);
  }

  const result = await pool.query(
    `
      UPDATE error_tracking_issues
      SET notification_sent_at = COALESCE($2::timestamptz, NOW()),
          updated_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        provider,
        project_slug,
        environment_key,
        external_issue_id,
        short_id,
        title,
        culprit,
        level,
        permalink,
        event_count,
        status,
        opened_at,
        last_seen_at,
        resolved_at,
        regression_count,
        notification_sent_at
    `,
    [normalizedIssueId, notificationSentAt || null],
  );

  return mapErrorTrackingIssueRow(result.rows[0]);
}

async function syncErrorTrackingIssueSnapshot(
  pool,
  {
    environment,
    issues,
    observedAt,
    projectSlug,
    provider,
    suppressNotifications = false,
  },
) {
  const scope = normalizeErrorTrackingScope({ environment, projectSlug, provider });
  const normalizedObservedAt = normalizeRequiredTimestamp(
    observedAt,
    "error tracking observation timestamp is required",
  );
  const normalizedIssues = dedupeErrorTrackingIssues(issues, scope);
  const result = await pool.query(
    `
      SELECT
        id,
        external_issue_id,
        status,
        regression_count
      FROM error_tracking_issues
      WHERE provider = $1
        AND project_slug = $2
        AND environment_key = $3
    `,
    [scope.provider, scope.projectSlug, scope.environmentKey],
  );

  const existingIssuesByExternalId = new Map(
    result.rows.map((row) => [String(row.external_issue_id), row]),
  );
  const seenExternalIssueIds = new Set();
  const summary = {
    baselineApplied: Boolean(suppressNotifications),
    insertedCount: 0,
    regressionCount: 0,
    resolvedCount: 0,
    touchedCount: 0,
  };

  for (const issue of normalizedIssues) {
    seenExternalIssueIds.add(issue.externalIssueId);
    const existingIssue = existingIssuesByExternalId.get(issue.externalIssueId);

    if (!existingIssue) {
      await pool.query(
        `
          INSERT INTO error_tracking_issues (
            provider,
            project_slug,
            environment_key,
            external_issue_id,
            short_id,
            title,
            culprit,
            level,
            permalink,
            event_count,
            status,
            opened_at,
            last_seen_at,
            resolved_at,
            regression_count,
            notification_sent_at,
            updated_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            '${ERROR_TRACKING_ISSUE_STATUSES.unresolved}',
            $11::timestamptz,
            $12::timestamptz,
            NULL,
            0,
            $13::timestamptz,
            NOW()
          )
        `,
        [
          scope.provider,
          scope.projectSlug,
          scope.environmentKey,
          issue.externalIssueId,
          issue.shortId,
          issue.title,
          issue.culprit,
          issue.level,
          issue.permalink,
          issue.eventCount,
          issue.openedAt,
          issue.lastSeenAt,
          suppressNotifications ? normalizedObservedAt : null,
        ],
      );
      summary.insertedCount += 1;
      summary.touchedCount += 1;
      continue;
    }

    const existingStatus = normalizeErrorTrackingIssueStatus(existingIssue.status);
    const existingRegressionCount = normalizeInteger(existingIssue.regression_count) || 0;
    const nextRegressionCount =
      existingStatus === ERROR_TRACKING_ISSUE_STATUSES.resolved
        ? existingRegressionCount + 1
        : existingRegressionCount;

    await pool.query(
      `
        UPDATE error_tracking_issues
        SET short_id = $2,
            title = $3,
            culprit = $4,
            level = $5,
            permalink = $6,
            event_count = $7,
            status = '${ERROR_TRACKING_ISSUE_STATUSES.unresolved}',
            opened_at = $8::timestamptz,
            last_seen_at = $9::timestamptz,
            resolved_at = NULL,
            regression_count = $10,
            notification_sent_at = CASE
              WHEN $11 THEN $12::timestamptz
              WHEN $13 THEN NULL
              ELSE notification_sent_at
            END,
            updated_at = NOW()
        WHERE id = $1
      `,
      [
        existingIssue.id,
        issue.shortId,
        issue.title,
        issue.culprit,
        issue.level,
        issue.permalink,
        issue.eventCount,
        issue.openedAt,
        issue.lastSeenAt,
        nextRegressionCount,
        suppressNotifications,
        normalizedObservedAt,
        existingStatus === ERROR_TRACKING_ISSUE_STATUSES.resolved,
      ],
    );

    if (existingStatus === ERROR_TRACKING_ISSUE_STATUSES.resolved) {
      summary.regressionCount += 1;
    }
    summary.touchedCount += 1;
  }

  for (const existingIssue of result.rows) {
    if (seenExternalIssueIds.has(String(existingIssue.external_issue_id))) {
      continue;
    }

    if (normalizeErrorTrackingIssueStatus(existingIssue.status) !== ERROR_TRACKING_ISSUE_STATUSES.unresolved) {
      continue;
    }

    await pool.query(
      `
        UPDATE error_tracking_issues
        SET status = '${ERROR_TRACKING_ISSUE_STATUSES.resolved}',
            resolved_at = $2::timestamptz,
            updated_at = NOW()
        WHERE id = $1
      `,
      [existingIssue.id, normalizedObservedAt],
    );
    summary.resolvedCount += 1;
  }

  return summary;
}

async function upsertPendingSupportEmailHistoryId(pool, historyId) {
  const normalizedHistoryId = normalizeHistoryId(historyId);
  if (!normalizedHistoryId) {
    throw new Error(`Unsupported support email history id: ${historyId}`);
  }

  const result = await pool.query(
    `
      INSERT INTO support_email_config (
        id,
        pending_history_id,
        updated_at
      )
      VALUES (1, $1::numeric, NOW())
      ON CONFLICT (id)
      DO UPDATE SET
        pending_history_id = CASE
          WHEN support_email_config.pending_history_id IS NULL THEN $1::numeric
          ELSE GREATEST(support_email_config.pending_history_id, $1::numeric)
        END,
        updated_at = NOW()
      RETURNING pending_history_id
    `,
    [normalizedHistoryId],
  );

  return normalizeHistoryId(result.rows[0]?.pending_history_id) || normalizedHistoryId;
}

async function updateSupportEmailRuntimeState(pool, updates = {}) {
  return upsertSupportEmailConfig(pool, {
    lastProcessedHistoryId: updates.lastProcessedHistoryId,
    pendingHistoryId: updates.pendingHistoryId,
    watchExpirationAt: updates.watchExpirationAt,
    backfillCompletedAt: updates.backfillCompletedAt,
    lastSyncAt: updates.lastSyncAt,
    clearBackfillCompletedAt: Boolean(updates.clearBackfillCompletedAt),
    clearPendingHistoryId: Boolean(updates.clearPendingHistoryId),
  });
}

async function listPendingSupportEmailThreads(pool) {
  const result = await pool.query(
    `
      SELECT
        id,
        gmail_thread_id,
        gmail_first_message_id,
        source_provider,
        first_message_text,
        subject,
        first_sender,
        status,
        first_received_at,
        notification_sent_at,
        responded_at,
        responded_by
      FROM support_email_threads
      WHERE status = 'pending'
      ORDER BY first_received_at ASC, id ASC
    `,
  );

  return result.rows;
}

async function listUnnotifiedSupportEmailThreads(pool) {
  const result = await pool.query(
    `
      SELECT
        id,
        gmail_thread_id,
        gmail_first_message_id,
        source_provider,
        first_message_text,
        subject,
        first_sender,
        status,
        first_received_at,
        notification_sent_at,
        responded_at,
        responded_by
      FROM support_email_threads
      WHERE status = 'pending'
        AND notification_sent_at IS NULL
      ORDER BY first_received_at ASC, id ASC
    `,
  );

  return result.rows;
}

async function insertSupportEmailThread(pool, thread) {
  const normalizedThreadId = normalizeOptionalText(thread.gmailThreadId);
  const normalizedFirstMessageId = normalizeOptionalText(thread.gmailFirstMessageId);
  const normalizedSourceProvider = normalizeEmailProvider(thread.sourceProvider);
  const normalizedFirstMessageText = normalizeOptionalText(thread.firstMessageText);
  const normalizedSubject = normalizeOptionalText(thread.subject);
  const normalizedFirstSender = normalizeOptionalText(thread.firstSender);
  const normalizedFirstReceivedAt = thread.firstReceivedAt || null;
  if (!normalizedThreadId) {
    throw new Error("support email gmail thread id is required");
  }
  if (!normalizedFirstReceivedAt) {
    throw new Error("support email first received timestamp is required");
  }

  const result = await pool.query(
    `
      INSERT INTO support_email_threads (
        gmail_thread_id,
        gmail_first_message_id,
        source_provider,
        first_message_text,
        subject,
        first_sender,
        status,
        first_received_at,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7::timestamptz, NOW(), NOW())
      ON CONFLICT (gmail_thread_id) DO NOTHING
      RETURNING
        id,
        gmail_thread_id,
        gmail_first_message_id,
        source_provider,
        first_message_text,
        subject,
        first_sender,
        status,
        first_received_at,
        notification_sent_at,
        responded_at,
        responded_by
    `,
    [
      normalizedThreadId,
      normalizedFirstMessageId,
      normalizedSourceProvider,
      normalizedFirstMessageText,
      normalizedSubject,
      normalizedFirstSender,
      normalizedFirstReceivedAt,
    ],
  );

  return result.rows[0] || null;
}

async function getSupportEmailThreadById(pool, emailId) {
  const normalizedEmailId = normalizePositiveInteger(emailId);
  if (!normalizedEmailId) {
    throw new Error(`Unsupported support email id: ${emailId}`);
  }

  const result = await pool.query(
    `
      SELECT
        id,
        gmail_thread_id,
        gmail_first_message_id,
        source_provider,
        first_message_text,
        subject,
        first_sender,
        status,
        first_received_at,
        notification_sent_at,
        responded_at,
        responded_by
      FROM support_email_threads
      WHERE id = $1
      LIMIT 1
    `,
    [normalizedEmailId],
  );

  return result.rows[0] || null;
}

async function cacheSupportEmailThreadMessageText(pool, emailId, firstMessageText, sourceProvider = null) {
  const normalizedEmailId = normalizePositiveInteger(emailId);
  const normalizedFirstMessageText = normalizeOptionalText(firstMessageText);
  const normalizedSourceProvider =
    sourceProvider === null || sourceProvider === undefined
      ? null
      : normalizeEmailProvider(sourceProvider);
  if (!normalizedEmailId) {
    throw new Error(`Unsupported support email id: ${emailId}`);
  }
  if (!normalizedFirstMessageText) {
    throw new Error("support email first message text is required");
  }
  if (sourceProvider !== null && sourceProvider !== undefined && !normalizedSourceProvider) {
    throw new Error(`Unsupported support email source provider: ${sourceProvider}`);
  }

  const result = await pool.query(
    `
      UPDATE support_email_threads
      SET first_message_text = $2,
          source_provider = COALESCE($3, source_provider),
          updated_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        gmail_thread_id,
        gmail_first_message_id,
        source_provider,
        first_message_text,
        subject,
        first_sender,
        status,
        first_received_at,
        notification_sent_at,
        responded_at,
        responded_by
    `,
    [normalizedEmailId, normalizedFirstMessageText, normalizedSourceProvider],
  );

  return result.rows[0] || null;
}

async function markSupportEmailThreadNotificationSent(pool, emailId, notificationSentAt) {
  const normalizedEmailId = normalizePositiveInteger(emailId);
  if (!normalizedEmailId) {
    throw new Error(`Unsupported support email id: ${emailId}`);
  }

  const result = await pool.query(
    `
      UPDATE support_email_threads
      SET notification_sent_at = COALESCE($2::timestamptz, NOW()),
          updated_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        gmail_thread_id,
        gmail_first_message_id,
        source_provider,
        first_message_text,
        subject,
        first_sender,
        status,
        first_received_at,
        notification_sent_at,
        responded_at,
        responded_by
    `,
    [normalizedEmailId, notificationSentAt || null],
  );

  return result.rows[0] || null;
}

async function markSupportEmailThreadResponded(pool, emailId, respondedBy, respondedAt = null) {
  const normalizedEmailId = normalizePositiveInteger(emailId);
  const normalizedRespondedBy = normalizeUserId(respondedBy);
  if (!normalizedEmailId) {
    throw new Error(`Unsupported support email id: ${emailId}`);
  }

  const existingResult = await pool.query(
    `
      SELECT
        id,
        subject,
        first_sender,
        status,
        responded_at,
        responded_by
      FROM support_email_threads
      WHERE id = $1
      LIMIT 1
    `,
    [normalizedEmailId],
  );
  const existingThread = existingResult.rows[0];
  if (!existingThread) {
    return { found: false };
  }

  if (existingThread.status === SUPPORT_EMAIL_THREAD_STATUSES.responded) {
    return {
      found: true,
      alreadyResponded: true,
      emailThread: existingThread,
    };
  }

  const result = await pool.query(
    `
      UPDATE support_email_threads
      SET status = 'responded',
          responded_at = COALESCE($2::timestamptz, NOW()),
          responded_by = $3,
          updated_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        subject,
        first_sender,
        status,
        responded_at,
        responded_by
    `,
    [normalizedEmailId, respondedAt || null, normalizedRespondedBy],
  );

  return {
    found: true,
    alreadyResponded: false,
    emailThread: result.rows[0],
  };
}

async function markReviewRecapSent(pool, scheduledSlotAt) {
  const result = await pool.query(
    `
      UPDATE review_recap_config
      SET last_sent_slot_at = $1,
          updated_at = NOW()
      WHERE id = 1
      RETURNING id, last_sent_slot_at
    `,
    [scheduledSlotAt],
  );
  return result.rows[0] || null;
}

async function setConfiguredCommunicationProvider(pool, communicationProvider, updatedBy) {
  const normalizedCommunicationProvider = normalizeCommunicationProvider(communicationProvider);
  const normalizedUserId = normalizeUserId(updatedBy);
  if (!normalizedCommunicationProvider) {
    throw new Error(`Unsupported communication provider: ${communicationProvider}`);
  }
  if (!normalizedUserId) {
    throw new Error("user id is required");
  }

  return upsertRuntimeProviderConfig(pool, {
    communicationProvider: normalizedCommunicationProvider,
    updatedBy: normalizedUserId,
  });
}

async function setConfiguredCodeHostProvider(pool, codeHostProvider, updatedBy) {
  const normalizedCodeHostProvider = normalizeCodeHostProvider(codeHostProvider);
  const normalizedUserId = normalizeUserId(updatedBy);
  if (!normalizedCodeHostProvider) {
    throw new Error(`Unsupported code-host provider: ${codeHostProvider}`);
  }
  if (!normalizedUserId) {
    throw new Error("user id is required");
  }

  return upsertRuntimeProviderConfig(pool, {
    codeHostProvider: normalizedCodeHostProvider,
    updatedBy: normalizedUserId,
  });
}

async function setConfiguredDeployProvider(pool, deployProvider, updatedBy) {
  const normalizedDeployProvider = normalizeDeployProvider(deployProvider);
  const normalizedUserId = normalizeUserId(updatedBy);
  if (!normalizedDeployProvider) {
    throw new Error(`Unsupported deploy provider: ${deployProvider}`);
  }
  if (!normalizedUserId) {
    throw new Error("user id is required");
  }

  return upsertRuntimeProviderConfig(pool, {
    deployProvider: normalizedDeployProvider,
    updatedBy: normalizedUserId,
  });
}

async function setConfiguredDeployEnvironment(pool, deployEnvironment, updatedBy) {
  const normalizedDeployEnvironment = normalizeDeployEnvironment(deployEnvironment);
  const normalizedUserId = normalizeUserId(updatedBy);
  if (!normalizedDeployEnvironment) {
    throw new Error(`Unsupported deploy environment: ${deployEnvironment}`);
  }
  if (!normalizedUserId) {
    throw new Error("user id is required");
  }

  return upsertRuntimeProviderConfig(pool, {
    deployEnvironment: normalizedDeployEnvironment,
    updatedBy: normalizedUserId,
  });
}

async function setConfiguredEmailProvider(pool, emailProvider, updatedBy) {
  const normalizedEmailProvider = normalizeEmailProvider(emailProvider);
  const normalizedUserId = normalizeUserId(updatedBy);
  if (!normalizedEmailProvider) {
    throw new Error(`Unsupported email provider: ${emailProvider}`);
  }
  if (!normalizedUserId) {
    throw new Error("user id is required");
  }

  return withTransaction(pool, async (queryable) => {
    await upsertRuntimeProviderConfig(queryable, {
      emailProvider: normalizedEmailProvider,
      updatedBy: normalizedUserId,
    });

    await upsertSupportEmailConfig(queryable, {
      updatedBy: normalizedUserId,
      clearBackfillCompletedAt: true,
      clearLastProcessedHistoryId: true,
      clearLastSyncAt: true,
      clearPendingHistoryId: true,
      clearWatchExpirationAt: true,
    });

    return {
      emailProvider: normalizedEmailProvider,
    };
  });
}

async function setConfiguredAiProvider(pool, aiProvider, updatedBy) {
  const normalizedAiProvider = normalizeAiProvider(aiProvider);
  const normalizedUserId = normalizeUserId(updatedBy);
  if (!normalizedAiProvider) {
    throw new Error(`Unsupported ai provider: ${aiProvider}`);
  }
  if (!normalizedUserId) {
    throw new Error("user id is required");
  }

  return upsertRuntimeProviderConfig(pool, {
    aiProvider: normalizedAiProvider,
    updatedBy: normalizedUserId,
  });
}

async function setConfiguredErrorTrackingProvider(pool, errorTrackingProvider, updatedBy) {
  const normalizedErrorTrackingProvider = normalizeErrorTrackingProvider(errorTrackingProvider);
  const normalizedUserId = normalizeUserId(updatedBy);
  if (!normalizedErrorTrackingProvider) {
    throw new Error(`Unsupported error tracking provider: ${errorTrackingProvider}`);
  }
  if (!normalizedUserId) {
    throw new Error("user id is required");
  }

  return withTransaction(pool, async (queryable) => {
    await upsertRuntimeProviderConfig(queryable, {
      errorTrackingProvider: normalizedErrorTrackingProvider,
      updatedBy: normalizedUserId,
    });

    await upsertErrorTrackingConfig(queryable, {
      updatedBy: normalizedUserId,
      clearBaselineCompletedAt: true,
      clearLastSyncAt: true,
      clearLastSyncError: true,
      clearProjectSlug: true,
    });

    return {
      errorTrackingProvider: normalizedErrorTrackingProvider,
    };
  });
}

async function upsertReviewRecapConfig(pool, updates) {
  const result = await pool.query(
    `
      INSERT INTO review_recap_config (
        id,
        target_channel_id,
        review_scope,
        recency_value,
        recency_unit,
        schedule_weekday,
        schedule_time,
        timezone,
        last_sent_slot_at,
        send_on_weekends,
        send_on_holidays,
        updated_by,
        updated_at
      )
      VALUES (
        1,
        COALESCE($1, NULL),
        COALESCE($2, '${REVIEW_RECAP_DEFAULTS.reviewScope}'),
        COALESCE($3, ${REVIEW_RECAP_DEFAULTS.recencyValue}),
        COALESCE($4, '${REVIEW_RECAP_DEFAULTS.recencyUnit}'),
        COALESCE($5, '${REVIEW_RECAP_DEFAULTS.scheduleWeekday}'),
        COALESCE($6, '${REVIEW_RECAP_DEFAULTS.scheduleTime}'),
        COALESCE($7, '${REVIEW_RECAP_DEFAULTS.timeZone}'),
        COALESCE($8::timestamptz, NULL),
        COALESCE($9, ${REVIEW_RECAP_DEFAULTS.sendOnWeekends}),
        COALESCE($10, ${REVIEW_RECAP_DEFAULTS.sendOnHolidays}),
        $11,
        NOW()
      )
      ON CONFLICT (id)
      DO UPDATE SET
        target_channel_id = COALESCE($1, review_recap_config.target_channel_id),
        review_scope = COALESCE($2, review_recap_config.review_scope),
        recency_value = COALESCE($3, review_recap_config.recency_value),
        recency_unit = COALESCE($4, review_recap_config.recency_unit),
        schedule_weekday = COALESCE($5, review_recap_config.schedule_weekday),
        schedule_time = COALESCE($6, review_recap_config.schedule_time),
        timezone = COALESCE($7, review_recap_config.timezone),
        last_sent_slot_at = COALESCE($8::timestamptz, review_recap_config.last_sent_slot_at),
        send_on_weekends = COALESCE($9, review_recap_config.send_on_weekends),
        send_on_holidays = COALESCE($10, review_recap_config.send_on_holidays),
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
      RETURNING
        target_channel_id,
        review_scope,
        recency_value,
        recency_unit,
        schedule_weekday,
        schedule_time,
        timezone,
        last_sent_slot_at,
        send_on_weekends,
        send_on_holidays,
        updated_by,
        updated_at
    `,
    [
      updates.targetChannelId || null,
      updates.reviewScope || null,
      updates.recencyValue || null,
      updates.recencyUnit || null,
      updates.scheduleWeekday || null,
      updates.scheduleTime || null,
      updates.timeZone || null,
      updates.lastSentSlotAt || null,
      updates.sendOnWeekends ?? null,
      updates.sendOnHolidays ?? null,
      updates.updatedBy || null,
    ],
  );

  return result.rows[0];
}

async function upsertEnvironmentStatusConfig(pool, updates) {
  const normalizedObservedState =
    updates.lastObservedState === undefined || updates.lastObservedState === null
      ? null
      : normalizeEnvironmentStatusState(updates.lastObservedState);
  const normalizedNotifiedState =
    updates.lastNotifiedState === undefined || updates.lastNotifiedState === null
      ? null
      : normalizeEnvironmentNotifiedState(updates.lastNotifiedState);
  const normalizedConnectivityState =
    updates.lastConnectivityState === undefined || updates.lastConnectivityState === null
      ? null
      : normalizeEnvironmentConnectivityState(updates.lastConnectivityState);
  const normalizedHttpStatus = normalizeNullableInteger(updates.lastHttpStatus);
  const normalizedFailureCount =
    updates.consecutiveFailureCount === undefined || updates.consecutiveFailureCount === null
      ? null
      : normalizeNonNegativeInteger(updates.consecutiveFailureCount);
  if (updates.lastObservedState !== undefined && updates.lastObservedState !== null && !normalizedObservedState) {
    throw new Error(`Unsupported environment status state: ${updates.lastObservedState}`);
  }
  if (updates.lastNotifiedState !== undefined && updates.lastNotifiedState !== null && !normalizedNotifiedState) {
    throw new Error(`Unsupported environment status notified state: ${updates.lastNotifiedState}`);
  }
  if (
    updates.lastConnectivityState !== undefined &&
    updates.lastConnectivityState !== null &&
    !normalizedConnectivityState
  ) {
    throw new Error(
      `Unsupported environment connectivity state: ${updates.lastConnectivityState}`,
    );
  }
  if (
    updates.consecutiveFailureCount !== undefined &&
    updates.consecutiveFailureCount !== null &&
    normalizedFailureCount === null
  ) {
    throw new Error(
      `Unsupported environment consecutive failure count: ${updates.consecutiveFailureCount}`,
    );
  }

  const result = await pool.query(
    `
      INSERT INTO environment_status_config (
        id,
        enabled,
        target_url,
        target_channel_id,
        last_observed_state,
        last_state_changed_at,
        last_checked_at,
        last_http_status,
        last_error_message,
        consecutive_failure_count,
        last_connectivity_state,
        last_connectivity_checked_at,
        last_connectivity_error_message,
        last_notified_state,
        last_notified_at,
        updated_by,
        updated_at
      )
      VALUES (
        1,
        COALESCE($1, ${ENVIRONMENT_STATUS_DEFAULTS.enabled}),
        COALESCE($2, NULL),
        COALESCE($3, NULL),
        COALESCE($4, '${ENVIRONMENT_STATUS_DEFAULTS.lastObservedState}'),
        $5::timestamptz,
        $6::timestamptz,
        $7,
        $8,
        COALESCE($9, ${ENVIRONMENT_STATUS_DEFAULTS.consecutiveFailureCount}),
        COALESCE($10, '${ENVIRONMENT_STATUS_DEFAULTS.lastConnectivityState}'),
        $11::timestamptz,
        $12,
        $13,
        $14::timestamptz,
        $15,
        NOW()
      )
      ON CONFLICT (id)
      DO UPDATE SET
        enabled = COALESCE($1, environment_status_config.enabled),
        target_url = COALESCE($2, environment_status_config.target_url),
        target_channel_id = COALESCE($3, environment_status_config.target_channel_id),
        last_observed_state = COALESCE($4, environment_status_config.last_observed_state),
        last_state_changed_at = CASE
          WHEN $16 THEN NULL
          ELSE COALESCE($5::timestamptz, environment_status_config.last_state_changed_at)
        END,
        last_checked_at = CASE
          WHEN $17 THEN NULL
          ELSE COALESCE($6::timestamptz, environment_status_config.last_checked_at)
        END,
        last_http_status = CASE
          WHEN $18 THEN NULL
          ELSE COALESCE($7, environment_status_config.last_http_status)
        END,
        last_error_message = CASE
          WHEN $19 THEN NULL
          ELSE COALESCE($8, environment_status_config.last_error_message)
        END,
        consecutive_failure_count = COALESCE($9, environment_status_config.consecutive_failure_count),
        last_connectivity_state = COALESCE($10, environment_status_config.last_connectivity_state),
        last_connectivity_checked_at = CASE
          WHEN $20 THEN NULL
          ELSE COALESCE($11::timestamptz, environment_status_config.last_connectivity_checked_at)
        END,
        last_connectivity_error_message = CASE
          WHEN $21 THEN NULL
          ELSE COALESCE($12, environment_status_config.last_connectivity_error_message)
        END,
        last_notified_state = CASE
          WHEN $22 THEN NULL
          ELSE COALESCE($13, environment_status_config.last_notified_state)
        END,
        last_notified_at = CASE
          WHEN $23 THEN NULL
          ELSE COALESCE($14::timestamptz, environment_status_config.last_notified_at)
        END,
        updated_by = COALESCE(EXCLUDED.updated_by, environment_status_config.updated_by),
        updated_at = NOW()
      RETURNING
        enabled,
        target_url,
        target_channel_id,
        last_observed_state,
        last_state_changed_at,
        last_checked_at,
        last_http_status,
        last_error_message,
        consecutive_failure_count,
        last_connectivity_state,
        last_connectivity_checked_at,
        last_connectivity_error_message,
        last_notified_state,
        last_notified_at
    `,
    [
      updates.enabled ?? null,
      updates.targetUrl ?? null,
      updates.targetChannelId ?? null,
      normalizedObservedState,
      updates.lastStateChangedAt ?? null,
      updates.lastCheckedAt ?? null,
      normalizedHttpStatus,
      updates.lastErrorMessage ?? null,
      normalizedFailureCount,
      normalizedConnectivityState,
      updates.lastConnectivityCheckedAt ?? null,
      updates.lastConnectivityErrorMessage ?? null,
      normalizedNotifiedState,
      updates.lastNotifiedAt ?? null,
      updates.updatedBy ?? null,
      Boolean(updates.clearLastStateChangedAt),
      Boolean(updates.clearLastCheckedAt),
      Boolean(updates.clearLastHttpStatus),
      Boolean(updates.clearLastErrorMessage),
      Boolean(updates.clearLastConnectivityCheckedAt),
      Boolean(updates.clearLastConnectivityErrorMessage),
      Boolean(updates.clearLastNotifiedState),
      Boolean(updates.clearLastNotifiedAt),
    ],
  );

  return mapEnvironmentStatusConfigRow(result.rows[0]);
}

async function upsertSupportEmailConfig(pool, updates) {
  const result = await pool.query(
    `
      INSERT INTO support_email_config (
        id,
        enabled,
        target_channel_id,
        on_call_user_id,
        on_call_expires_at,
        last_processed_history_id,
        pending_history_id,
        watch_expiration_at,
        backfill_completed_at,
        last_sync_at,
        updated_by,
        updated_at
      )
      VALUES (
        1,
        COALESCE($1, ${SUPPORT_EMAIL_DEFAULTS.enabled}),
        COALESCE($2, NULL),
        COALESCE($3, NULL),
        $4::timestamptz,
        $5::numeric,
        $6::numeric,
        $7::timestamptz,
        $8::timestamptz,
        $9::timestamptz,
        $10,
        NOW()
      )
      ON CONFLICT (id)
      DO UPDATE SET
        enabled = COALESCE($1, support_email_config.enabled),
        target_channel_id = COALESCE($2, support_email_config.target_channel_id),
        on_call_user_id = CASE
          WHEN $11 THEN NULL
          ELSE COALESCE($3, support_email_config.on_call_user_id)
        END,
        on_call_expires_at = CASE
          WHEN $11 THEN NULL
          ELSE COALESCE($4::timestamptz, support_email_config.on_call_expires_at)
        END,
        last_processed_history_id = CASE
          WHEN $14 THEN NULL
          ELSE COALESCE($5::numeric, support_email_config.last_processed_history_id)
        END,
        pending_history_id = CASE
          WHEN $12 THEN NULL
          ELSE COALESCE($6::numeric, support_email_config.pending_history_id)
        END,
        watch_expiration_at = CASE
          WHEN $15 THEN NULL
          ELSE COALESCE($7::timestamptz, support_email_config.watch_expiration_at)
        END,
        backfill_completed_at = CASE
          WHEN $13 THEN NULL
          ELSE COALESCE($8::timestamptz, support_email_config.backfill_completed_at)
        END,
        last_sync_at = CASE
          WHEN $16 THEN NULL
          ELSE COALESCE($9::timestamptz, support_email_config.last_sync_at)
        END,
        updated_by = COALESCE(EXCLUDED.updated_by, support_email_config.updated_by),
        updated_at = NOW()
      RETURNING
        enabled,
        target_channel_id,
        on_call_user_id,
        on_call_expires_at,
        last_processed_history_id,
        pending_history_id,
        watch_expiration_at,
        backfill_completed_at,
        last_sync_at
    `,
    [
      updates.enabled ?? null,
      updates.targetChannelId ?? null,
      updates.onCallUserId ?? null,
      updates.onCallExpiresAt ?? null,
      normalizeHistoryId(updates.lastProcessedHistoryId),
      normalizeHistoryId(updates.pendingHistoryId),
      updates.watchExpirationAt ?? null,
      updates.backfillCompletedAt ?? null,
      updates.lastSyncAt ?? null,
      updates.updatedBy ?? null,
      Boolean(updates.clearOnCall),
      Boolean(updates.clearPendingHistoryId),
      Boolean(updates.clearBackfillCompletedAt),
      Boolean(updates.clearLastProcessedHistoryId),
      Boolean(updates.clearWatchExpirationAt),
      Boolean(updates.clearLastSyncAt),
    ],
  );

  return mapSupportEmailConfigRow(result.rows[0]);
}

async function upsertErrorTrackingConfig(pool, updates) {
  const result = await pool.query(
    `
      INSERT INTO error_tracking_config (
        id,
        enabled,
        target_channel_id,
        project_slug,
        environment,
        baseline_completed_at,
        last_sync_at,
        last_sync_error,
        updated_by,
        updated_at
      )
      VALUES (
        1,
        COALESCE($1, ${ERROR_TRACKING_DEFAULTS.enabled}),
        COALESCE($2, NULL),
        COALESCE($3, NULL),
        $4,
        $5::timestamptz,
        $6::timestamptz,
        $7,
        $8,
        NOW()
      )
      ON CONFLICT (id)
      DO UPDATE SET
        enabled = COALESCE($1, error_tracking_config.enabled),
        target_channel_id = COALESCE($2, error_tracking_config.target_channel_id),
        project_slug = CASE
          WHEN $13 THEN NULL
          ELSE COALESCE($3, error_tracking_config.project_slug)
        END,
        environment = CASE
          WHEN $9 THEN NULL
          ELSE COALESCE($4, error_tracking_config.environment)
        END,
        baseline_completed_at = CASE
          WHEN $10 THEN NULL
          ELSE COALESCE($5::timestamptz, error_tracking_config.baseline_completed_at)
        END,
        last_sync_at = CASE
          WHEN $11 THEN NULL
          ELSE COALESCE($6::timestamptz, error_tracking_config.last_sync_at)
        END,
        last_sync_error = CASE
          WHEN $12 THEN NULL
          ELSE COALESCE($7, error_tracking_config.last_sync_error)
        END,
        updated_by = COALESCE(EXCLUDED.updated_by, error_tracking_config.updated_by),
        updated_at = NOW()
      RETURNING
        enabled,
        target_channel_id,
        project_slug,
        environment,
        baseline_completed_at,
        last_sync_at,
        last_sync_error
    `,
    [
      updates.enabled ?? null,
      updates.targetChannelId ?? null,
      updates.projectSlug ?? null,
      updates.environment ?? null,
      updates.baselineCompletedAt ?? null,
      updates.lastSyncAt ?? null,
      updates.lastSyncError ?? null,
      updates.updatedBy ?? null,
      Boolean(updates.clearEnvironment),
      Boolean(updates.clearBaselineCompletedAt),
      Boolean(updates.clearLastSyncAt),
      Boolean(updates.clearLastSyncError),
      Boolean(updates.clearProjectSlug),
    ],
  );

  return mapErrorTrackingConfigRow(result.rows[0]);
}

async function upsertRuntimeProviderConfig(pool, updates) {
  const result = await pool.query(
    `
      INSERT INTO runtime_config (
        id,
        communication_provider,
        code_host_provider,
        deploy_provider,
        email_provider,
        ai_provider,
        error_tracking_provider,
        updated_by,
        deploy_environment,
        updated_at
      )
      VALUES (
        1,
        COALESCE($1, '${RUNTIME_PROVIDER_DEFAULTS.communicationProvider}'),
        COALESCE($2, '${RUNTIME_PROVIDER_DEFAULTS.codeHostProvider}'),
        COALESCE($3, '${RUNTIME_PROVIDER_DEFAULTS.deployProvider}'),
        COALESCE($4, '${RUNTIME_PROVIDER_DEFAULTS.emailProvider}'),
        COALESCE($5, '${RUNTIME_PROVIDER_DEFAULTS.aiProvider}'),
        COALESCE($6, '${RUNTIME_PROVIDER_DEFAULTS.errorTrackingProvider}'),
        $7,
        COALESCE($8, '${RUNTIME_PROVIDER_DEFAULTS.deployEnvironment}'),
        NOW()
      )
      ON CONFLICT (id)
      DO UPDATE SET
        communication_provider = COALESCE($1, runtime_config.communication_provider),
        code_host_provider = COALESCE($2, runtime_config.code_host_provider),
        deploy_provider = COALESCE($3, runtime_config.deploy_provider),
        email_provider = COALESCE($4, runtime_config.email_provider),
        ai_provider = COALESCE($5, runtime_config.ai_provider),
        error_tracking_provider = COALESCE($6, runtime_config.error_tracking_provider),
        updated_by = EXCLUDED.updated_by,
        deploy_environment = COALESCE($8, runtime_config.deploy_environment),
        updated_at = NOW()
      RETURNING
        communication_provider,
        code_host_provider,
        deploy_environment,
        deploy_provider,
        email_provider,
        ai_provider,
        error_tracking_provider,
        updated_by,
        updated_at
    `,
    [
      updates.communicationProvider || null,
      updates.codeHostProvider || null,
      updates.deployProvider || null,
      updates.emailProvider || null,
      updates.aiProvider || null,
      updates.errorTrackingProvider || null,
      updates.updatedBy || null,
      updates.deployEnvironment || null,
    ],
  );

  return result.rows[0];
}

async function isUserWhitelistedForDeploy(pool, userId) {
  const query = `
    SELECT 1
    FROM deployment_whitelist
    WHERE user_id = $1
    LIMIT 1
  `;
  const result = await pool.query(query, [userId]);
  return result.rowCount > 0;
}

async function addUserToDeployWhitelist(pool, userId, addedBy) {
  const existingRecord = await pool.query(
    `
      SELECT user_id
      FROM deployment_whitelist
      WHERE user_id = $1
    `,
    [userId],
  );
  if (existingRecord.rowCount > 0) {
    return { added: false };
  }

  await pool.query(
    `
      INSERT INTO deployment_whitelist (user_id, added_by, updated_at)
      VALUES ($1, $2, NOW())
    `,
    [userId, addedBy],
  );
  return { added: true };
}

async function setGithubSlackUserMapping(pool, githubUsername, slackUsername, updatedBy) {
  const normalizedGithubUsername = normalizeGithubUsername(githubUsername);
  const normalizedSlackUsername = normalizeSlackUsername(slackUsername);
  const normalizedUpdatedBy = normalizeUserId(updatedBy);
  if (!normalizedGithubUsername) {
    throw new Error(`Unsupported GitHub username: ${githubUsername}`);
  }
  if (!normalizedSlackUsername) {
    throw new Error(`Unsupported Slack username: ${slackUsername}`);
  }
  if (!normalizedUpdatedBy) {
    throw new Error("user id is required");
  }

  const result = await pool.query(
    `
      INSERT INTO github_slack_user_mappings (
        github_username,
        slack_username,
        updated_by,
        updated_at
      )
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (github_username)
      DO UPDATE SET
        slack_username = EXCLUDED.slack_username,
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
      RETURNING github_username, slack_username, updated_by, updated_at
    `,
    [normalizedGithubUsername, normalizedSlackUsername, normalizedUpdatedBy],
  );

  return result.rows[0];
}

async function listGithubSlackUserMappings(pool, githubUsernames) {
  const normalizedGithubUsernames = dedupeNormalizedGithubUsernames(githubUsernames);
  if (normalizedGithubUsernames.length === 0) {
    return new Map();
  }

  const result = await pool.query(
    `
      SELECT github_username, slack_username
      FROM github_slack_user_mappings
      WHERE github_username = ANY($1::TEXT[])
    `,
    [normalizedGithubUsernames],
  );

  const mappings = new Map();
  for (const row of result.rows) {
    const normalizedGithubUsername = normalizeGithubUsername(row.github_username);
    const normalizedSlackUsername = normalizeSlackUsername(row.slack_username);
    if (normalizedGithubUsername && normalizedSlackUsername) {
      mappings.set(normalizedGithubUsername, normalizedSlackUsername);
    }
  }

  return mappings;
}

async function getConfiguredTimeFormat(pool, userId) {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) {
    return DEFAULT_TIME_FORMAT;
  }

  const result = await pool.query(
    `
      SELECT time_format
      FROM runtime_user_config
      WHERE user_id = $1
      LIMIT 1
    `,
    [normalizedUserId],
  );

  const configuredValue = result.rows[0]?.time_format || DEFAULT_TIME_FORMAT;
  return normalizeTimeFormat(configuredValue) || DEFAULT_TIME_FORMAT;
}

async function getConfiguredTimeZone(pool, userId) {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) {
    return DEFAULT_TIME_ZONE;
  }

  const result = await pool.query(
    `
      SELECT timezone
      FROM runtime_user_config
      WHERE user_id = $1
      LIMIT 1
    `,
    [normalizedUserId],
  );

  return normalizeTimeZone(result.rows[0]?.timezone) || DEFAULT_TIME_ZONE;
}

async function setConfiguredTimeFormat(pool, timeFormat, updatedBy) {
  const normalizedTimeFormat = normalizeTimeFormat(timeFormat);
  const normalizedUserId = normalizeUserId(updatedBy);
  if (!normalizedTimeFormat) {
    throw new Error(`Unsupported time format: ${timeFormat}`);
  }
  if (!normalizedUserId) {
    throw new Error("user id is required");
  }

  const result = await pool.query(
    `
      INSERT INTO runtime_user_config (user_id, time_format, updated_by, updated_at)
      VALUES ($2, $1, $2, NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET
        time_format = EXCLUDED.time_format,
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
      RETURNING time_format, updated_by, updated_at
    `,
    [normalizedTimeFormat, normalizedUserId],
  );

  return result.rows[0];
}

async function setConfiguredTimeZone(pool, timeZone, updatedBy) {
  const normalizedTimeZone = normalizeTimeZone(timeZone);
  const normalizedUserId = normalizeUserId(updatedBy);
  if (!normalizedTimeZone) {
    throw new Error(`Unsupported timezone: ${timeZone}`);
  }
  if (!normalizedUserId) {
    throw new Error("user id is required");
  }

  const result = await pool.query(
    `
      INSERT INTO runtime_user_config (user_id, timezone, updated_by, updated_at)
      VALUES ($2, $1, $2, NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET
        timezone = EXCLUDED.timezone,
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
      RETURNING timezone, updated_by, updated_at
    `,
    [normalizedTimeZone, normalizedUserId],
  );

  return result.rows[0];
}

function normalizeTimeFormat(timeFormat) {
  const normalizedTimeFormat = String(timeFormat || "").toLowerCase().trim();
  return TIME_FORMATS[normalizedTimeFormat] || null;
}

function normalizeGithubUsername(githubUsername) {
  const normalizedGithubUsername = String(githubUsername || "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(normalizedGithubUsername)) {
    return null;
  }

  return normalizedGithubUsername;
}

function normalizeSlackUsername(slackUsername) {
  const normalizedSlackReference = String(slackUsername || "").trim();
  const mentionMatch = normalizedSlackReference.match(/^<@([UW][A-Z0-9]*[0-9][A-Z0-9]*)(?:\|[^>]+)?>$/i);
  if (mentionMatch) {
    return mentionMatch[1].toUpperCase();
  }

  const userIdMatch = normalizedSlackReference.match(/^([UW][A-Z0-9]*[0-9][A-Z0-9]*)$/i);
  if (userIdMatch) {
    return userIdMatch[1].toUpperCase();
  }

  const normalizedSlackUsername = normalizedSlackReference
    .replace(/^@/, "")
    .toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(normalizedSlackUsername)) {
    return null;
  }

  return normalizedSlackUsername;
}

function dedupeNormalizedGithubUsernames(githubUsernames) {
  const normalizedGithubUsernames = new Set();
  for (const githubUsername of Array.isArray(githubUsernames) ? githubUsernames : []) {
    const normalizedGithubUsername = normalizeGithubUsername(githubUsername);
    if (normalizedGithubUsername) {
      normalizedGithubUsernames.add(normalizedGithubUsername);
    }
  }

  return [...normalizedGithubUsernames];
}

function normalizeOptionalText(value) {
  const normalizedValue = String(value || "").trim();
  return normalizedValue === "" ? null : normalizedValue;
}

function normalizeTimeZone(timeZone) {
  const normalizedTimeZone = String(timeZone || "").trim();
  return normalizedTimeZone === "" ? null : normalizedTimeZone;
}

function normalizeUserId(userId) {
  const normalizedUserId = String(userId || "").trim();
  return normalizedUserId === "" ? null : normalizedUserId;
}

function normalizeReviewRecencyUnit(recencyUnit) {
  const normalizedRecencyUnit = String(recencyUnit || "").toLowerCase().trim();
  return Object.values(REVIEW_RECAP_RECENCY_UNITS).includes(normalizedRecencyUnit)
    ? normalizedRecencyUnit
    : null;
}

function normalizeReviewRecapScope(reviewScope) {
  const normalizedReviewScope = String(reviewScope || "").toLowerCase().trim();
  return Object.values(REVIEW_RECAP_SCOPES).includes(normalizedReviewScope)
    ? normalizedReviewScope
    : null;
}

function normalizeReviewScheduleWeekday(scheduleWeekday) {
  const normalizedScheduleWeekday = String(scheduleWeekday || "").toLowerCase().trim();
  return REVIEW_RECAP_WEEKDAYS[normalizedScheduleWeekday] || null;
}

function normalizeReviewScheduleTime(scheduleTime) {
  const scheduleTimeParts = String(scheduleTime || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (scheduleTimeParts.length === 0) {
    return null;
  }

  const uniqueScheduleTimes = [...new Set(scheduleTimeParts)];
  for (const normalizedScheduleTime of uniqueScheduleTimes) {
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(normalizedScheduleTime)) {
      return null;
    }
  }

  return uniqueScheduleTimes.sort().join(",");
}

function normalizeReviewRecapChannelId(targetChannelId) {
  const normalizedChannelId = String(targetChannelId || "").trim();
  return normalizedChannelId === "" ? null : normalizedChannelId;
}

function normalizeReviewRecapBoolean(value, fallbackValue = null) {
  if (value === true || value === false) {
    return value;
  }

  const normalizedValue = String(value || "").toLowerCase().trim();
  if (["true", "1", "yes", "on"].includes(normalizedValue)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalizedValue)) {
    return false;
  }

  return fallbackValue;
}

function normalizeBoolean(value, fallbackValue = null) {
  if (value === true || value === false) {
    return value;
  }

  const normalizedValue = String(value || "").toLowerCase().trim();
  if (["true", "1", "yes", "on"].includes(normalizedValue)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalizedValue)) {
    return false;
  }

  return fallbackValue;
}

function normalizePositiveInteger(value) {
  const parsedValue = Number(value);
  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : null;
}

function normalizeInteger(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsedValue = Number(value);
  return Number.isInteger(parsedValue) ? parsedValue : null;
}

function normalizeNullableInteger(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return normalizeInteger(value);
}

function normalizeDeploymentPullRequestTargets(pullRequests) {
  const seenTargets = new Set();
  const normalizedTargets = [];

  for (const pullRequest of Array.isArray(pullRequests) ? pullRequests : []) {
    const repo = String(pullRequest?.repo || "").trim();
    const prNumber = normalizePositiveInteger(
      pullRequest?.pr_number ?? pullRequest?.prNumber,
    );
    const targetKey = `${repo}#${prNumber}`;
    if (!repo || !prNumber || seenTargets.has(targetKey)) {
      continue;
    }

    seenTargets.add(targetKey);
    normalizedTargets.push({ repo, prNumber });
  }

  return normalizedTargets;
}

function normalizeNonNegativeInteger(value) {
  const parsedValue = normalizeInteger(value);
  return parsedValue !== null && parsedValue >= 0 ? parsedValue : null;
}

function normalizeHistoryId(value) {
  const normalizedValue = String(value || "").trim();
  return /^\d+$/.test(normalizedValue) ? normalizedValue : null;
}

function normalizeEnvironmentStatusState(value) {
  const normalizedValue = String(value || "").toLowerCase().trim();
  return Object.values(ENVIRONMENT_STATUS_STATES).includes(normalizedValue)
    ? normalizedValue
    : null;
}

function normalizeEnvironmentNotifiedState(value) {
  const normalizedValue = String(value || "").toLowerCase().trim();
  return normalizedValue === ENVIRONMENT_STATUS_STATES.healthy ||
    normalizedValue === ENVIRONMENT_STATUS_STATES.unhealthy
    ? normalizedValue
    : null;
}

function normalizeEnvironmentConnectivityState(value) {
  const normalizedValue = String(value || "").toLowerCase().trim();
  return Object.values(ENVIRONMENT_CONNECTIVITY_STATES).includes(normalizedValue)
    ? normalizedValue
    : null;
}

function normalizeSupportEmailThreadStatus(value) {
  const normalizedValue = String(value || "").toLowerCase().trim();
  return Object.values(SUPPORT_EMAIL_THREAD_STATUSES).includes(normalizedValue)
    ? normalizedValue
    : null;
}

function normalizeUrl(value) {
  const normalizedValue = String(value || "").trim();
  if (normalizedValue === "") {
    return null;
  }

  try {
    const parsedUrl = new URL(normalizedValue);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return null;
    }
    return parsedUrl.toString();
  } catch (_error) {
    return null;
  }
}

async function withTransaction(pool, callback) {
  if (typeof pool.connect !== "function") {
    await pool.query("BEGIN");
    try {
      const result = await callback(pool);
      await pool.query("COMMIT");
      return result;
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function normalizeErrorTrackingProjectSlug(value) {
  const normalizedValue = normalizeOptionalText(value);
  if (!normalizedValue) {
    return null;
  }

  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(normalizedValue) ? normalizedValue : null;
}

function normalizeErrorTrackingEnvironment(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalizedValue = String(value).trim();
  if (normalizedValue === "") {
    return undefined;
  }
  if (normalizedValue.toLowerCase() === "any") {
    return null;
  }

  return normalizedValue;
}

function normalizeErrorTrackingEnvironmentKey(value) {
  const normalizedEnvironment = normalizeErrorTrackingEnvironment(value);
  if (normalizedEnvironment === undefined) {
    return null;
  }

  return normalizedEnvironment || "";
}

function normalizeEmailProvider(value) {
  const normalizedValue = String(value || "").toLowerCase().trim();
  return Object.values(EMAIL_PROVIDERS).includes(normalizedValue) ? normalizedValue : null;
}

function normalizeAiProvider(value) {
  const normalizedValue = String(value || "").toLowerCase().trim();
  return Object.values(AI_PROVIDERS).includes(normalizedValue) ? normalizedValue : null;
}

function normalizeErrorTrackingProvider(value) {
  const normalizedValue = String(value || "").toLowerCase().trim();
  return Object.values(ERROR_TRACKING_PROVIDERS).includes(normalizedValue)
    ? normalizedValue
    : null;
}

function normalizeErrorTrackingIssueStatus(value) {
  const normalizedValue = String(value || "").toLowerCase().trim();
  return Object.values(ERROR_TRACKING_ISSUE_STATUSES).includes(normalizedValue)
    ? normalizedValue
    : null;
}

function normalizeRequiredTimestamp(value, message) {
  const normalizedValue = normalizeOptionalText(value);
  if (!normalizedValue) {
    throw new Error(message);
  }

  const parsedDate = new Date(normalizedValue);
  if (Number.isNaN(parsedDate.getTime())) {
    throw new Error(message);
  }

  return parsedDate.toISOString();
}

function normalizeErrorTrackingScope({ environment, projectSlug, provider }) {
  const normalizedProvider = normalizeErrorTrackingProvider(provider);
  const normalizedProjectSlug = normalizeErrorTrackingProjectSlug(projectSlug);
  const normalizedEnvironmentKey = normalizeErrorTrackingEnvironmentKey(environment);
  if (!normalizedProvider) {
    throw new Error(`Unsupported error tracking provider: ${provider}`);
  }
  if (!normalizedProjectSlug) {
    throw new Error(`Unsupported error tracking project slug: ${projectSlug}`);
  }
  if (normalizedEnvironmentKey === null) {
    throw new Error(`Unsupported error tracking environment: ${environment}`);
  }

  return {
    environment: normalizedEnvironmentKey || null,
    environmentKey: normalizedEnvironmentKey,
    projectSlug: normalizedProjectSlug,
    provider: normalizedProvider,
  };
}

function normalizeErrorTrackingIssue(issue, scope) {
  const externalIssueId = normalizeOptionalText(issue?.externalIssueId);
  const openedAt = normalizeRequiredTimestamp(
    issue?.openedAt || issue?.firstSeenAt,
    "error tracking issue first seen timestamp is required",
  );
  const lastSeenAt = normalizeRequiredTimestamp(
    issue?.lastSeenAt,
    "error tracking issue last seen timestamp is required",
  );
  if (!externalIssueId) {
    throw new Error("error tracking external issue id is required");
  }

  return {
    culprit: normalizeOptionalText(issue?.culprit),
    environment: scope.environment,
    eventCount: normalizeInteger(issue?.eventCount) || 0,
    externalIssueId,
    lastSeenAt,
    level: normalizeOptionalText(issue?.level) || "error",
    openedAt,
    permalink: normalizeOptionalText(issue?.permalink),
    projectSlug: scope.projectSlug,
    shortId: normalizeOptionalText(issue?.shortId),
    title: normalizeOptionalText(issue?.title) || "(untitled)",
  };
}

function dedupeErrorTrackingIssues(issues, scope) {
  const issuesByExternalId = new Map();
  for (const issue of Array.isArray(issues) ? issues : []) {
    const normalizedIssue = normalizeErrorTrackingIssue(issue, scope);
    issuesByExternalId.set(normalizedIssue.externalIssueId, normalizedIssue);
  }

  return [...issuesByExternalId.values()];
}

function mapEnvironmentStatusConfigRow(row) {
  if (!row) {
    return null;
  }

  return {
    enabled: normalizeBoolean(row.enabled, ENVIRONMENT_STATUS_DEFAULTS.enabled),
    targetUrl: normalizeOptionalText(row.target_url),
    targetChannelId: normalizeOptionalText(row.target_channel_id),
    lastObservedState:
      normalizeEnvironmentStatusState(row.last_observed_state) ||
      ENVIRONMENT_STATUS_DEFAULTS.lastObservedState,
    lastStateChangedAt: row.last_state_changed_at || null,
    lastCheckedAt: row.last_checked_at || null,
    lastHttpStatus: normalizeInteger(row.last_http_status),
    lastErrorMessage: normalizeOptionalText(row.last_error_message),
    consecutiveFailureCount:
      normalizeNonNegativeInteger(row.consecutive_failure_count) ??
      ENVIRONMENT_STATUS_DEFAULTS.consecutiveFailureCount,
    lastConnectivityState:
      normalizeEnvironmentConnectivityState(row.last_connectivity_state) ||
      ENVIRONMENT_STATUS_DEFAULTS.lastConnectivityState,
    lastConnectivityCheckedAt: row.last_connectivity_checked_at || null,
    lastConnectivityErrorMessage: normalizeOptionalText(row.last_connectivity_error_message),
    lastNotifiedState: normalizeEnvironmentNotifiedState(row.last_notified_state),
    lastNotifiedAt: row.last_notified_at || null,
  };
}

function mapSupportEmailConfigRow(row) {
  if (!row) {
    return null;
  }

  return {
    enabled: normalizeBoolean(row.enabled, SUPPORT_EMAIL_DEFAULTS.enabled),
    targetChannelId: normalizeOptionalText(row.target_channel_id),
    onCallUserId: normalizeOptionalText(row.on_call_user_id),
    onCallExpiresAt: row.on_call_expires_at || null,
    lastProcessedHistoryId: normalizeHistoryId(row.last_processed_history_id),
    pendingHistoryId: normalizeHistoryId(row.pending_history_id),
    watchExpirationAt: row.watch_expiration_at || null,
    backfillCompletedAt: row.backfill_completed_at || null,
    lastSyncAt: row.last_sync_at || null,
  };
}

function mapErrorTrackingConfigRow(row) {
  if (!row) {
    return null;
  }

  const normalizedEnvironment = normalizeErrorTrackingEnvironment(row.environment);
  return {
    enabled: normalizeBoolean(row.enabled, ERROR_TRACKING_DEFAULTS.enabled),
    targetChannelId: normalizeOptionalText(row.target_channel_id),
    projectSlug: normalizeErrorTrackingProjectSlug(row.project_slug),
    environment: normalizedEnvironment === undefined ? null : normalizedEnvironment,
    baselineCompletedAt: row.baseline_completed_at || null,
    lastSyncAt: row.last_sync_at || null,
    lastSyncError: normalizeOptionalText(row.last_sync_error),
  };
}

function mapErrorTrackingIssueRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: normalizePositiveInteger(row.id),
    provider: normalizeErrorTrackingProvider(row.provider),
    projectSlug: normalizeErrorTrackingProjectSlug(row.project_slug),
    environment: row.environment_key === "" ? null : normalizeErrorTrackingEnvironment(row.environment_key),
    externalIssueId: normalizeOptionalText(row.external_issue_id),
    shortId: normalizeOptionalText(row.short_id),
    title: normalizeOptionalText(row.title),
    culprit: normalizeOptionalText(row.culprit),
    level: normalizeOptionalText(row.level),
    permalink: normalizeOptionalText(row.permalink),
    eventCount: normalizeInteger(row.event_count) || 0,
    status: normalizeErrorTrackingIssueStatus(row.status),
    openedAt: row.opened_at || null,
    lastSeenAt: row.last_seen_at || null,
    resolvedAt: row.resolved_at || null,
    regressionCount: normalizeInteger(row.regression_count) || 0,
    notificationSentAt: row.notification_sent_at || null,
  };
}

function normalizeCommunicationProvider(provider) {
  const normalizedProvider = String(provider || "").toLowerCase().trim();
  return Object.values(COMMUNICATION_PROVIDERS).includes(normalizedProvider)
    ? normalizedProvider
    : null;
}

function normalizeCodeHostProvider(provider) {
  const normalizedProvider = String(provider || "").toLowerCase().trim();
  return Object.values(CODE_HOST_PROVIDERS).includes(normalizedProvider)
    ? normalizedProvider
    : null;
}

function normalizeDeployProvider(provider) {
  const normalizedProvider = String(provider || "").toLowerCase().trim();
  return Object.values(DEPLOY_PROVIDERS).includes(normalizedProvider)
    ? normalizedProvider
    : null;
}

function normalizeDeployEnvironment(environment) {
  const normalizedEnvironment = String(environment || "").toLowerCase().trim();
  return ["prod", "staging"].includes(normalizedEnvironment) ? normalizedEnvironment : null;
}

function normalizePullRequestReviewState(reviewState) {
  const normalizedReviewState = String(reviewState || "").toLowerCase().trim();
  if (normalizedReviewState === "approved") {
    return "approved";
  }
  if (normalizedReviewState === "changes_requested") {
    return "changes_requested";
  }
  if (normalizedReviewState === "waiting") {
    return "waiting";
  }
  return null;
}

module.exports = {
  completeDeploymentRun,
  consumeDeploymentConfirmation,
  createDeploymentConfirmation,
  addUserToDeployWhitelist,
  clearSupportEmailOnCall,
  createPool,
  DEFAULT_TIME_FORMAT,
  DEFAULT_TIME_ZONE,
  ERROR_TRACKING_DEFAULTS,
  ERROR_TRACKING_ISSUE_STATUSES,
  ENVIRONMENT_CONNECTIVITY_STATES,
  ENVIRONMENT_STATUS_DEFAULTS,
  ENVIRONMENT_STATUS_STATES,
  RUNTIME_PROVIDER_DEFAULTS,
  REVIEW_RECAP_DEFAULTS,
  REVIEW_RECAP_RECENCY_UNITS,
  REVIEW_RECAP_SCOPES,
  REVIEW_RECAP_WEEKDAYS,
  SUPPORT_EMAIL_DEFAULTS,
  SUPPORT_EMAIL_THREAD_STATUSES,
  getErrorTrackingConfig,
  getActiveDeploymentRun,
  getDeploymentGateState,
  getRuntimeProviderConfig,
  getConfiguredTimeZone,
  getEnvironmentStatusConfig,
  getReviewRecapConfig,
  getLastProdDeployAt,
  getConfiguredTimeFormat,
  getSupportEmailConfig,
  getSupportEmailThreadById,
  isUserWhitelistedForDeploy,
  cacheSupportEmailThreadMessageText,
  insertAuditEvent,
  insertDeployment,
  listAuditEvents,
  insertSupportEmailThread,
  listGithubSlackUserMappings,
  listDeployablePullRequestsForDeployment,
  listOpenErrorTrackingIssues,
  listOpenPullRequestsForReviewRecapSince,
  listPendingSupportEmailThreads,
  listRecentlyTestedPullRequests,
  listOpenPullRequestsWaitingOnReviewSince,
  listUnnotifiedErrorTrackingIssues,
  listUnnotifiedSupportEmailThreads,
  listTrackedOpenPullRequestsForCodexApproval,
  listBlockingPullRequests,
  markErrorTrackingIssueNotificationSent,
  markStaleOpenPullRequestsClosed,
  markAllUntestedPullRequestsTested,
  markEnvironmentStatusNotificationSent,
  markDeploymentRunTriggered,
  markPullRequestsDeployed,
  markReviewRecapSent,
  markPullRequestsDeployedSince,
  markSupportEmailThreadNotificationSent,
  markSupportEmailThreadResponded,
  recordEnvironmentStatusObservation,
  reserveDeploymentRun,
  updatePullRequestCodexApproval,
  updateErrorTrackingRuntimeState,
  updateEnvironmentStatusRuntimeState,
  updateSupportEmailRuntimeState,
  markPullRequestTested,
  setPullRequestForceDeployBlocked,
  upsertPendingSupportEmailHistoryId,
  runMigrations,
  setErrorTrackingChannel,
  setErrorTrackingEnabled,
  setErrorTrackingEnvironment,
  setErrorTrackingProject,
  setDeploymentGateState,
  setDeploymentGateStateWithAudit,
  setEnvironmentStatusChannel,
  setEnvironmentStatusEnabled,
  setEnvironmentStatusUrl,
  setReviewRecapChannel,
  setReviewRecapRecency,
  setReviewRecapScope,
  setReviewRecapSchedule,
  setReviewRecapSendHolidays,
  setReviewRecapSendWeekends,
  setReviewRecapTimeZone,
  setConfiguredTimeFormat,
  setConfiguredTimeZone,
  setConfiguredCommunicationProvider,
  setConfiguredCodeHostProvider,
  setConfiguredDeployProvider,
  setConfiguredDeployEnvironment,
  setConfiguredEmailProvider,
  setConfiguredAiProvider,
  setConfiguredErrorTrackingProvider,
  setGithubSlackUserMapping,
  setSupportEmailChannel,
  setSupportEmailMonitorEnabled,
  setSupportEmailOnCall,
  TIME_FORMATS,
  updatePullRequestReviewSubmission,
  upsertOpenPullRequestReviewState,
  upsertPullRequestAsUntested,
  syncErrorTrackingIssueSnapshot,
  upsertPullRequestAsUntestedFromSync,
  verifyConnection,
};
