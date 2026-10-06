// Fictional, fixed-date fixtures. All bot content comes from the production renderer.
const { buildReviewRecapPresentation, formatStatusResponse } = require("../../../src/util/format");
const { StatusCommand } = require("../../../src/commands/types/status_command");
const { registerCalypsoCommand } = require("../../../src/commands/command_router");
const { buildCommunicationMessage } = require("../../../src/platform/communication/message_renderer");

const participants = {
  maya: { name: "Maya Chen", avatar: "maya-chen.png" },
  alex: { name: "Alex Rivera", avatar: "alex-rivera.png" },
  jordan: { name: "Jordan Patel", avatar: "jordan-patel.png" },
};
const now = new Date("2026-10-06T15:00:00Z");
const health = {
  enabled: true, lastObservedState: "healthy", lastHttpStatus: 200,
  lastCheckedAt: new Date("2026-10-06T14:47:10Z"),
};
const pullRequest = (number, title, author, fields = {}) => ({
  repo: "northstar/app", pr_number: number, title, author_login: author,
  url: `https://github.com/northstar/app/pull/${number}`,
  last_modified_at: "2026-10-05T15:00:00Z", ...fields,
});
const reviewPullRequests = [
  pullRequest(191, "Improve audit logging", "maya", { review_state: "approved", codex_approved: true }),
  pullRequest(192, "Speed up account search", "alex", { review_state: "approved", codex_approved: true }),
  ...[
    [193, "Add usage dashboard", "jordan"],
    [196, "Simplify checkout recovery", "alex"],
    [198, "Add webhook retry metrics", "maya"],
    [201, "Improve invitation flow", "jordan"],
  ].map(([number, title, author]) => pullRequest(number, title, author, {
    review_state: "waiting", codex_approved: true,
  })),
  ...[
    [202, "Cache organization settings", "alex"],
    [203, "Update billing exports", "maya"],
    [204, "Add search filters", "jordan"],
  ].map(([number, title, author]) => pullRequest(number, title, author, { review_state: "waiting" })),
  pullRequest(175, "Explore activity feed", "maya", { last_modified_at: "2026-08-20T15:00:00Z" }),
  pullRequest(178, "Refresh notification preferences", "alex", { last_modified_at: "2026-08-25T15:00:00Z" }),
];

function reviewMessage(selectedTabKey = null) {
  return buildCommunicationMessage({
    provider: "slack",
    presentation: buildReviewRecapPresentation({
      pullRequests: reviewPullRequests, reviewScope: "all", selectedTabKey,
      timeZone: "America/New_York", now,
    }),
  });
}

async function readinessMessage() {
  const tested = pullRequest(184, "Checkout retry handling", "alex", { status: "tested" });
  const mustTest = pullRequest(187, "Add billing webhooks", "jordan", {
    status: "untested", force_deploy_blocked: true,
  });
  const result = await new StatusCommand().execute({ runtime: {
    pool: {},
    readTimeFormatPreferenceFn: async () => "human",
    readTimeZonePreferenceFn: async () => "America/New_York",
    getLastProdDeployAtFn: async () => new Date("2026-10-05T18:42:00Z"),
    listBlockingPullRequestsFn: async () => [mustTest],
    getEnvironmentStatusConfigFn: async () => health,
    listDeployablePullRequestsForDeploymentFn: async () => [tested, mustTest],
    resolveCurrentChannelTopicFn: async () => "Production: 🟢",
    formatStatusResponseFn: formatStatusResponse,
  } });
  return buildCommunicationMessage({ provider: "slack", text: result.responseText, presentation: result.presentation });
}

async function deploymentMessage() {
  // Exercise the real confirmed-deploy/follow-up flow with offline dependencies only.
  let handler;
  const planned = [184, 187].map((number) => pullRequest(number,
    number === 184 ? "Checkout retry handling" : "Add billing webhooks",
    number === 184 ? "alex" : "jordan", { status: "tested" }));
  registerCalypsoCommand({ command: (_name, fn) => { handler = fn; } }, {
    communicationProvider: "slack", enableDeploymentCompletionNotifications: true,
    enableGateControl: true,
    pool: { query: async (sql) => {
      if (!["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) throw new Error(`Unexpected preview SQL: ${sql}`);
      return { rows: [] };
    } },
    consumeDeploymentConfirmationFn: async (_pool, confirmation) => confirmation,
    getActiveDeploymentRunFn: async () => null,
    getDeploymentGateStateFn: async () => ({ status: "open" }),
    insertAuditEventFn: async () => {}, markDeploymentRunTriggeredFn: async () => {},
    reserveDeploymentRunFn: async () => ({ acquired: true, run: { id: 248 } }),
    resolveDeployAccessFn: async () => ({ canDeploy: true }),
    deployConfig: { digitaloceanToken: "fictional-preview-token", doAppIdProd: "northstar-production" },
    getLastProdDeployAtFn: async () => new Date("2026-10-05T18:42:00Z"),
    getEnvironmentStatusConfigFn: async () => health,
    getConfiguredTimeFormatFn: async () => "human",
    getConfiguredTimeZoneFn: async () => "America/New_York",
    listBlockingPullRequestsFn: async () => [],
    listDeployablePullRequestsForDeploymentFn: async () => planned,
    triggerProdDeployFn: async () => ({ externalDeployId: "dep-248" }),
    waitForProdDeployCompletionFn: async () => ({ id: "dep-248", phase: "ACTIVE" }),
    completeDeploymentRunFn: async () => ({
      id: 248, provider: "digitalocean", environment: "prod",
      started_at: new Date("2026-10-06T14:42:48Z"), completed_at: new Date("2026-10-06T14:47:00Z"),
    }),
    insertDeploymentFn: async () => ({ deployed_at: new Date("2026-10-06T14:47:00Z") }),
    markPullRequestsDeployedFn: async () => ({ deployedPullRequestCount: 2, deployedPullRequests: planned }),
    listGithubSlackUserMappingsFn: async () => new Map([["alex", "U_ALEX"], ["jordan", "U_JORDAN"]]),
  });
  const responses = [];
  await handler({
    ack: async () => {}, respond: async (response) => responses.push(response),
    command: {
      text: "deploy prod confirm preview-token", user_id: "U_JORDAN", user_name: "jordan",
      channel_id: "C_DEPLOYMENTS", channel_name: "deployments",
    },
    client: { conversations: { info: async () => ({ channel: { topic: { value: "Production: 🟢" } } }) } },
  });
  const message = responses.find((response) =>
    response.attachments?.[0]?.blocks?.[0]?.text?.text === "✅ Production deployment complete");
  if (!message) throw new Error(`Could not build deployment preview: ${JSON.stringify(responses)}`);
  return message;
}

async function buildScenes() {
  return [
    { slug: "review-queue", channel: "engineering", participant: "maya", time: "9:12 AM",
      command: "/conductor reviews", ephemeral: true, message: reviewMessage() },
    { slug: "review-category", height: 1240, channel: "engineering", participant: "maya", time: "9:12 AM",
      command: "/conductor reviews", ephemeral: true, message: reviewMessage("waiting_human") },
    { slug: "production-readiness", width: 1320, height: 900, channel: "engineering", participant: "alex", time: "10:42 AM",
      command: "/conductor status", ephemeral: true, message: await readinessMessage() },
    { slug: "automated-deploy", channel: "deployments", participant: "jordan", time: "10:47 AM",
      command: "/conductor deploy prod", ephemeral: false, message: await deploymentMessage() },
  ];
}

module.exports = { participants, buildScenes };
