const { BaseCalypsoCommand } = require("./base_command");
const { DEFAULT_BOT_NAME } = require("../../config");

class HelpCommand extends BaseCalypsoCommand {
  constructor(options = {}) {
    super("help");
    this.botName = String(options.botName || DEFAULT_BOT_NAME);
  }

  parse({ commandWords }) {
    const topic = normalizeHelpTopic(commandWords[1]);
    if (commandWords.length > 2 || topic === null) {
      return this.buildRespondParsedCommand(buildHelpTopicUsageMessage());
    }

    return this.buildRespondParsedCommand(buildHelpText(this.botName, topic));
  }
}

function buildHelpText(botName, topic) {
  if (topic === "deploy") {
    return buildDeployHelpText(botName);
  }

  if (topic === "reviews") {
    return buildReviewsHelpText(botName);
  }

  if (topic === "monitoring") {
    return buildMonitoringHelpText(botName);
  }

  if (topic === "email") {
    return buildEmailHelpText(botName);
  }

  if (topic === "config") {
    return buildConfigHelpText(botName);
  }

  return buildOverviewHelpText(botName);
}

function buildOverviewHelpText(botName) {
  return [
    `*${botName}*`,
    "Engineering operations command center for reviews, testing, deployments, and production health.",
    "",
    "*Start Here*",
    "`/conductor status` Show deploy blockers.",
    "`/conductor gate status` Show the authoritative gate state.",
    "`/conductor history` Show recent gate and deployment activity.",
    "`/conductor doctor` Check operational configuration.",
    "`/conductor deploy` Preview and confirm a deploy to the configured default environment.",
    "`/conductor reviews` Show PRs waiting on review.",
    "`/conductor errors` Show tracked unresolved errors.",
    "`/conductor emails` Show pending support emails.",
    "",
    "*Modules*",
    "`/conductor help deploy` Deploy gate, testing, and whitelist commands.",
    "`/conductor help reviews` Review queue, sync, and recap commands.",
    "`/conductor help monitoring` Environment status and Sentry commands.",
    "`/conductor help email` Support mailbox queue and on-call commands.",
    "`/conductor help config` Shared settings and provider switches.",
  ].join("\n");
}

function buildDeployHelpText(botName) {
  return [
    `*${botName} Deploy Help*`,
    "",
    "`/conductor status` Show deploy readiness and the untested PR queue.",
    "`/conductor gate status [prod|staging]` Show explicit or topic-fallback gate state.",
    "`/conductor gate close <prod|staging> <REASON>` Close a gate with an audited reason.",
    "`/conductor gate open <prod|staging>` Reopen an audited gate.",
    "`/conductor history [prod|staging]` Show recent gate and deployment events.",
    "`/conductor tested <PR_NUMBER>` Mark one PR as tested.",
    "`/conductor tested all` Mark all untested PRs as tested.",
    "`/conductor tested recent <day|week|month>` List recently tested PRs.",
    "`/conductor deploy` Preview and confirm a deploy to the configured default environment.",
    "`/conductor deploy list` Show deploy readiness and the untested PR queue.",
    "`/conductor deploy staging` Preview and confirm a staging deploy.",
    "`/conductor deploy prod` Preview and confirm a forced production deploy; only explicit must-test PRs block.",
    "`/conductor doctor` Validate database, provider, topic, and scheduler health.",
    "`/conductor config deploy-environment:prod|staging` Set the default environment.",
    "`/conductor whitelist <@USER>` Allow deploy/test updates for a user.",
  ].join("\n");
}

function buildReviewsHelpText(botName) {
  return [
    `*${botName} Reviews Help*`,
    "",
    "`/conductor reviews` List open PRs waiting on review.",
    "`/conductor reviews <GITHUB_USER>` Filter by PR author.",
    "`/conductor reviews <day|week|month>` Filter by recency window.",
    "`/conductor reviews recent <day|week|month>` Explicit recent-window form.",
    "`/conductor sync` Run immediate sync with code host.",
    "",
    "*Recap Config*",
    "`/conductor config review-recap-channel:<#CHANNEL|CHANNEL_ID>`",
    "`/conductor config review-recap-window:<all|last-day|last-week|last-month>`",
    "`/conductor config review-recap-recency:<Nd|Nw>` (legacy)",
    "`/conductor config review-recap-schedule:<daily|weekday>@HH:MM[,HH:MM...]`",
    "`/conductor config review-recap-send-weekends:<on|off>`",
    "`/conductor config review-recap-send-holidays:<on|off>`",
    "`/conductor config timezone:America/New_York` Shared timezone setting.",
  ].join("\n");
}

function buildMonitoringHelpText(botName) {
  return [
    `*${botName} Monitoring Help*`,
    "",
    "`/conductor errors` List tracked unresolved Sentry issue groups.",
    "",
    "*Environment Status*",
    "`/conductor config environment-status:on|off`",
    "`/conductor config environment-status-url:https://example.com/healthz`",
    "`/conductor config environment-status-channel:<#CHANNEL|CHANNEL_ID>`",
    "",
    "*Error Tracking*",
    "`/conductor config error-tracking:on|off`",
    "`/conductor config error-tracking-provider:sentry|rollbar`",
    "`/conductor config error-tracking-channel:<#CHANNEL|CHANNEL_ID>`",
    "`/conductor config error-tracking-project:<PROJECT_SLUG>`",
    "`/conductor config error-tracking-environment:<ENVIRONMENT|any>`",
    "Alerts post once for new issues and once again for regressions.",
  ].join("\n");
}

function buildEmailHelpText(botName) {
  return [
    `*${botName} Email Help*`,
    "",
    "`/conductor emails` List pending customer support emails.",
    "`/conductor emails draft <EMAIL_ID> [ADDITIONAL_INSTRUCTIONS...]` Draft a reply with the active AI provider.",
    "`/conductor emails responded <EMAIL_ID>` Mark one queue item responded.",
    "",
    "*Support Email Config*",
    "`/conductor config email-monitor:on|off`",
    "`/conductor config email-provider:gmail|outlook`",
    "`/conductor config ai-provider:openai|anthropic`",
    "`/conductor config email-channel:<#CHANNEL|CHANNEL_ID>`",
    "`/conductor config email-on-call <@USER|USER_ID> <Nh|Nd|Nw>`",
    "`/conductor config email-on-call off`",
    "Notifications mention the on-call user when one is active. AI drafts are limited to workspace admins or the current on-call user.",
  ].join("\n");
}

function buildConfigHelpText(botName) {
  return [
    `*${botName} Config Help*`,
    "",
    "`/conductor config time-format:human|long` Configure timestamp display format.",
    "`/conductor config timezone:America/New_York` Configure timezone for human timestamps.",
    "`/conductor config github-slack-user-map:<GITHUB_USER>=<@USER|USER_ID|@HANDLE>` Map deploy PR authors.",
    "",
    "*Provider Switches*",
    "`/conductor config communication-provider:slack|microsoft_teams`",
    "`/conductor config code-host-provider:github|bitbucket`",
    "`/conductor config deploy-provider:digitalocean|aws`",
    "`/conductor config email-provider:gmail|outlook`",
    "`/conductor config ai-provider:openai|anthropic`",
    "`/conductor config error-tracking-provider:sentry|rollbar`",
    "Provider changes apply to command handling immediately.",
    "",
    "*Module Config*",
    "`/conductor help reviews` Review recap settings.",
    "`/conductor help monitoring` Environment status and Sentry settings.",
    "`/conductor help email` Support email settings.",
  ].join("\n");
}

function buildHelpTopicUsageMessage() {
  return [
    "Usage:",
    "`/conductor help`",
    "`/conductor help deploy`",
    "`/conductor help reviews`",
    "`/conductor help monitoring`",
    "`/conductor help email`",
    "`/conductor help config`",
  ].join("\n");
}

function normalizeHelpTopic(rawTopic) {
  if (rawTopic === undefined) {
    return "overview";
  }

  const normalizedTopic = String(rawTopic || "").toLowerCase().trim();
  if (
    normalizedTopic === "deploy" ||
    normalizedTopic === "deployment" ||
    normalizedTopic === "testing" ||
    normalizedTopic === "tested"
  ) {
    return "deploy";
  }
  if (
    normalizedTopic === "reviews" ||
    normalizedTopic === "reviewing" ||
    normalizedTopic === "review" ||
    normalizedTopic === "sync"
  ) {
    return "reviews";
  }
  if (
    normalizedTopic === "monitoring" ||
    normalizedTopic === "monitor" ||
    normalizedTopic === "monitors" ||
    normalizedTopic === "errors"
  ) {
    return "monitoring";
  }
  if (
    normalizedTopic === "email" ||
    normalizedTopic === "emails" ||
    normalizedTopic === "support"
  ) {
    return "email";
  }
  if (normalizedTopic === "config" || normalizedTopic === "configuration") {
    return "config";
  }

  return null;
}

module.exports = {
  HelpCommand,
};
