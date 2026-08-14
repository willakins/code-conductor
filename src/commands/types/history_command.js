const { BaseCalypsoCommand } = require("./base_command");
const { formatTimestampByTimeFormat } = require("../../util/format");

class HistoryCommand extends BaseCalypsoCommand {
  constructor() {
    super("history");
  }

  parse({ commandWords }) {
    const environment = commandWords[1] ? normalizeEnvironment(commandWords[1]) : null;
    if (commandWords.length > 2 || (commandWords[1] && !environment)) {
      return this.buildRespondParsedCommand("Usage: `/conductor history [prod|staging]`");
    }
    return this.buildParsedCommand({ action: "history", environment });
  }

  async execute({ parsedCommand, runtime }) {
    if (!runtime.pool) {
      return this.buildExecutionResult("History unavailable: database pool is not configured.");
    }
    const [events, timeFormat, timeZone] = await Promise.all([
      runtime.listAuditEventsFn(runtime.pool, { environment: parsedCommand.environment, limit: 20 }),
      runtime.readTimeFormatPreferenceFn(runtime),
      runtime.readTimeZonePreferenceFn(runtime),
    ]);
    if (events.length === 0) {
      return this.buildExecutionResult(`No ${runtime.botName} audit events found.`, {
        presentation: {
          tone: "neutral",
          title: `${runtime.botName} activity`,
          summary: "No audit events found.",
        },
      });
    }

    return this.buildExecutionResult(
      [`Recent ${runtime.botName} activity:`, ...events.map((event) => `• ${event.summary}`)].join("\n"),
      {
        presentation: {
          tone: "neutral",
          title: `${runtime.botName} activity`,
          summary: parsedCommand.environment
            ? `Recent ${parsedCommand.environment} gate and deployment events.`
            : "Recent gate and deployment events.",
          sections: events.map((event, index) => ({
            title: event.summary,
            text: formatAuditEventText(event, {
              communicationProvider: runtime.communicationProvider,
              timeFormat,
              timeZone,
            }),
            separator: index > 0,
          })),
          actions: [{ id: "refresh_history", label: "Refresh", command: parsedCommand.environment ? `history ${parsedCommand.environment}` : "history" }],
        },
      },
    );
  }
}

function formatAuditMetadata(rawMetadata) {
  const metadata = normalizeMetadata(rawMetadata);
  return [
    metadata.provider ? `provider ${metadata.provider}` : "",
    metadata.externalDeploymentId ? `deployment ${metadata.externalDeploymentId}` : "",
    metadata.runId ? `run #${metadata.runId}` : "",
    metadata.durationSeconds !== null
      && metadata.durationSeconds !== undefined
      && Number.isFinite(Number(metadata.durationSeconds))
      ? `${Number(metadata.durationSeconds)}s`
      : "",
    metadata.deployedPullRequestCount !== null
      && metadata.deployedPullRequestCount !== undefined
      && Number.isFinite(Number(metadata.deployedPullRequestCount))
      ? `${Number(metadata.deployedPullRequestCount)} PR(s)`
      : "",
  ].filter(Boolean);
}

function formatAuditActor(actorUserId, communicationProvider) {
  const normalizedActorUserId = String(actorUserId || "").trim();
  const isSlackProvider =
    String(communicationProvider || "").trim().toLowerCase() === "slack";
  if (isSlackProvider && /^[UW][A-Z0-9]+$/i.test(normalizedActorUserId)) {
    return `<@${normalizedActorUserId.toUpperCase()}>`;
  }
  return normalizedActorUserId;
}

function formatAuditEventText(event, { communicationProvider, timeFormat, timeZone }) {
  const eventContext = [
    event.actor_user_id
      ? `by ${formatAuditActor(event.actor_user_id, communicationProvider)}`
      : "",
    formatTimestampByTimeFormat(event.created_at, { timeFormat, timeZone }),
  ].filter(Boolean).join(" · ");
  const metadata = formatAuditMetadata(event.metadata).join(" · ");
  return [eventContext, metadata].filter(Boolean).join("\n");
}

function normalizeMetadata(rawMetadata) {
  if (rawMetadata && typeof rawMetadata === "object") {
    return rawMetadata;
  }
  try {
    return JSON.parse(String(rawMetadata || "{}"));
  } catch (_error) {
    return {};
  }
}

function normalizeEnvironment(value) {
  const normalized = String(value || "").toLowerCase();
  return normalized === "prod" || normalized === "staging" ? normalized : null;
}

module.exports = {
  HistoryCommand,
};
