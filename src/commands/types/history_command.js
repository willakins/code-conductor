const { BaseCalypsoCommand } = require("./base_command");
const { formatTimestampByTimeFormat } = require("../../util/format");

class HistoryCommand extends BaseCalypsoCommand {
  constructor() {
    super("history");
  }

  parse({ commandWords }) {
    const environment = commandWords[1] ? normalizeEnvironment(commandWords[1]) : null;
    if (commandWords.length > 2 || (commandWords[1] && !environment)) {
      return this.buildRespondParsedCommand("Usage: `/calypso history [prod|staging]`");
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
      return this.buildExecutionResult("No Calypso audit events found.");
    }

    return this.buildExecutionResult(
      ["Recent Calypso activity:", ...events.map((event) => `• ${event.summary}`)].join("\n"),
      {
        presentation: {
          tone: "neutral",
          title: "Calypso activity",
          summary: parsedCommand.environment
            ? `Recent ${parsedCommand.environment} gate and deployment events.`
            : "Recent gate and deployment events.",
          sections: [{
            title: "Latest events",
            items: events.map((event) => ({
              title: event.summary,
              description: [
                event.actor_user_id ? `by ${event.actor_user_id}` : "",
                formatTimestampByTimeFormat(event.created_at, { timeFormat, timeZone }),
                ...formatAuditMetadata(event.metadata),
              ].filter(Boolean).join(" · "),
            })),
          }],
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
