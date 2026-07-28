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
    "Deployment gatekeeper with optional review, monitoring, and support modules.",
    "",
    "*Start Here*",
    "`/calypso status` Show deploy blockers.",
    "`/calypso gate status` Show the authoritative gate state.",
    "`/calypso history` Show recent gate and deployment activity.",
    "`/calypso doctor` Check operational configuration.",
    "`/calypso deploy` Preview and confirm a deploy to the configured default environment.",
    "`/calypso reviews` Show PRs waiting on review.",
    "`/calypso errors` Show tracked unresolved errors.",
    "`/calypso emails` Show pending support emails.",
    "",
    "*Modules*",
    "`/calypso help deploy` Deploy gate, testing, and whitelist commands.",
    "`/calypso help reviews` Review queue, sync, and recap commands.",
    "`/calypso help monitoring` Environment status and Sentry commands.",
    "`/calypso help email` Support mailbox queue and on-call commands.",
    "`/calypso help config` Shared settings and provider switches.",
  ].join("\n");
}

function buildDeployHelpText(botName) {
  return [
    `*${botName} Deploy Help*`,
    "",
    "`/calypso status` Show deploy readiness and the untested PR queue.",
    "`/calypso gate status [prod|staging]` Show explicit or topic-fallback gate state.",
    "`/calypso gate close <prod|staging> <REASON>` Close a gate with an audited reason.",
    "`/calypso gate open <prod|staging>` Reopen an audited gate.",
    "`/calypso history [prod|staging]` Show recent gate and deployment events.",
    "`/calypso tested <PR_NUMBER>` Mark one PR as tested.",
    "`/calypso tested all` Mark all untested PRs as tested.",
    "`/calypso tested recent <day|week|month>` List recently tested PRs.",
    "`/calypso deploy` Preview and confirm a deploy to the configured default environment.",
    "`/calypso deploy list` Show deploy readiness and the untested PR queue.",
    "`/calypso deploy staging` Preview and confirm a staging deploy.",
    "`/calypso deploy prod` Preview and confirm a forced production deploy; only explicit must-test PRs block.",
    "`/calypso doctor` Validate database, provider, topic, and scheduler health.",
    "`/calypso config deploy-environment:prod|staging` Set the default environment.",
    "`/calypso whitelist <@USER>` Allow deploy/test updates for a user.",
  ].join("\n");
}

function buildReviewsHelpText(botName) {
  return [
    `*${botName} Reviews Help*`,
    "",
    "`/calypso reviews` List open PRs waiting on review.",
    "`/calypso reviews <GITHUB_USER>` Filter by PR author.",
    "`/calypso reviews <day|week|month>` Filter by recency window.",
    "`/calypso reviews recent <day|week|month>` Explicit recent-window form.",
    "`/calypso sync` Run immediate sync with code host.",
    "",
    "*Recap Config*",
    "`/calypso config review-recap-channel:<#CHANNEL|CHANNEL_ID>`",
    "`/calypso config review-recap-window:<all|last-day|last-week|last-month>`",
    "`/calypso config review-recap-recency:<Nd|Nw>` (legacy)",
    "`/calypso config review-recap-schedule:<daily|weekday>@HH:MM[,HH:MM...]`",
    "`/calypso config review-recap-send-weekends:<on|off>`",
    "`/calypso config review-recap-send-holidays:<on|off>`",
    "`/calypso config timezone:America/New_York` Shared timezone setting.",
  ].join("\n");
}

function buildMonitoringHelpText(botName) {
  return [
    `*${botName} Monitoring Help*`,
    "",
    "`/calypso errors` List tracked unresolved Sentry issue groups.",
    "",
    "*Environment Status*",
    "`/calypso config environment-status:on|off`",
    "`/calypso config environment-status-url:https://example.com/healthz`",
    "`/calypso config environment-status-channel:<#CHANNEL|CHANNEL_ID>`",
    "",
    "*Error Tracking*",
    "`/calypso config error-tracking:on|off`",
    "`/calypso config error-tracking-provider:sentry|rollbar`",
    "`/calypso config error-tracking-channel:<#CHANNEL|CHANNEL_ID>`",
    "`/calypso config error-tracking-project:<PROJECT_SLUG>`",
    "`/calypso config error-tracking-environment:<ENVIRONMENT|any>`",
    "Alerts post once for new issues and once again for regressions.",
  ].join("\n");
}

function buildEmailHelpText(botName) {
  return [
    `*${botName} Email Help*`,
    "",
    "`/calypso emails` List pending customer support emails.",
    "`/calypso emails draft <EMAIL_ID> [ADDITIONAL_INSTRUCTIONS...]` Draft a reply with the active AI provider.",
    "`/calypso emails responded <EMAIL_ID>` Mark one queue item responded.",
    "",
    "*Support Email Config*",
    "`/calypso config email-monitor:on|off`",
    "`/calypso config email-provider:gmail|outlook`",
    "`/calypso config ai-provider:openai|anthropic`",
    "`/calypso config email-channel:<#CHANNEL|CHANNEL_ID>`",
    "`/calypso config email-on-call <@USER|USER_ID> <Nh|Nd|Nw>`",
    "`/calypso config email-on-call off`",
    "Notifications mention the on-call user when one is active. AI drafts are limited to workspace admins or the current on-call user.",
  ].join("\n");
}

function buildConfigHelpText(botName) {
  return [
    `*${botName} Config Help*`,
    "",
    "`/calypso config time-format:human|long` Configure timestamp display format.",
    "`/calypso config timezone:America/New_York` Configure timezone for human timestamps.",
    "`/calypso config github-slack-user-map:<GITHUB_USER>=<@USER|USER_ID|@HANDLE>` Map deploy PR authors.",
    "",
    "*Provider Switches*",
    "`/calypso config communication-provider:slack|microsoft_teams`",
    "`/calypso config code-host-provider:github|bitbucket`",
    "`/calypso config deploy-provider:digitalocean|aws`",
    "`/calypso config email-provider:gmail|outlook`",
    "`/calypso config ai-provider:openai|anthropic`",
    "`/calypso config error-tracking-provider:sentry|rollbar`",
    "Provider changes apply to command handling immediately.",
    "",
    "*Module Config*",
    "`/calypso help reviews` Review recap settings.",
    "`/calypso help monitoring` Environment status and Sentry settings.",
    "`/calypso help email` Support email settings.",
  ].join("\n");
}

function buildHelpTopicUsageMessage() {
  return [
    "Usage:",
    "`/calypso help`",
    "`/calypso help deploy`",
    "`/calypso help reviews`",
    "`/calypso help monitoring`",
    "`/calypso help email`",
    "`/calypso help config`",
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
