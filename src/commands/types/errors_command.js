const { BaseCalypsoCommand } = require("./base_command");

class ErrorsCommand extends BaseCalypsoCommand {
  constructor() {
    super("errors");
  }

  parse({ commandWords }) {
    if (commandWords.length === 1) {
      return this.buildParsedCommand({
        action: "errors_list",
      });
    }

    return this.buildRespondParsedCommand(buildUsageMessage());
  }

  async execute({ parsedCommand, runtime }) {
    if (!runtime.pool) {
      return this.buildExecutionResult("Errors command unavailable: database pool is not configured.");
    }

    if (parsedCommand.action === "respond") {
      return this.buildExecutionResult(parsedCommand.responseText || buildUsageMessage());
    }

    const config = await runtime.getErrorTrackingConfigFn(runtime.pool);
    const responseLines = buildHeaderLines(config);

    if (!config.enabled) {
      responseLines.push("Error tracking monitoring is off.");
      return this.buildExecutionResult(responseLines.join("\n"));
    }

    if (!config.projectSlug) {
      responseLines.push(
        "Error tracking setup incomplete: configure `/conductor config error-tracking-project:<PROJECT_SLUG>`.",
      );
      return this.buildExecutionResult(responseLines.join("\n"));
    }

    if (!config.targetChannelId) {
      responseLines.push(
        "Error tracking setup incomplete: configure `/conductor config error-tracking-channel:<#CHANNEL|CHANNEL_ID>`.",
      );
      return this.buildExecutionResult(responseLines.join("\n"));
    }

    const runtimeProviderConfig =
      runtime.pool &&
      typeof runtime.pool.query === "function" &&
      typeof runtime.getRuntimeProviderConfigFn === "function"
        ? await runtime.getRuntimeProviderConfigFn(runtime.pool)
        : null;
    const errorTrackingProvider =
      runtimeProviderConfig?.errorTrackingProvider || runtime.errorTrackingProvider;
    const issues = await runtime.listOpenErrorTrackingIssuesFn(runtime.pool, {
      environment: config.environment,
      projectSlug: config.projectSlug,
      provider: errorTrackingProvider,
    });
    if (issues.length === 0) {
      responseLines.push("No unresolved tracked errors.");
      return this.buildExecutionResult(responseLines.join("\n"));
    }

    return this.buildExecutionResult(
      [
        ...responseLines,
        ...issues.map(formatIssueLine),
      ].join("\n"),
      {
        presentation: {
          tone: "warning",
          title: "Tracked unresolved errors",
          summary: `${issues.length} unresolved issue group(s) need attention.`,
          facts: [
            { label: "Project", value: config.projectSlug },
            { label: "Environment", value: config.environment || "any" },
            { label: "Last sync", value: String(config.lastSyncAt || "never") },
          ],
          sections: [{
            title: "Issues",
            items: issues.map((issue) => ({
              title: `[${issue.shortId || issue.externalIssueId || "unknown"}] ${issue.title || "(untitled)"}`,
              url: issue.url || "",
              description: `${issue.level || "error"} · last seen ${issue.lastSeenAt || "unknown"}${issue.regressionCount > 0 ? ` · ${issue.regressionCount} regression(s)` : ""}`,
            })),
          }],
          actions: [{ id: "refresh_errors", label: "Refresh", command: "errors" }],
        },
      },
    );
  }
}

function buildHeaderLines(config) {
  const scopeEnvironment = config.environment || "any";
  const lines = [
    `Tracked unresolved errors for project \`${config.projectSlug || "unset"}\` in environment \`${scopeEnvironment}\`.`,
    `Last sync: ${config.lastSyncAt || "never"}.`,
  ];
  if (config.lastSyncError) {
    lines.push(`Last sync error: ${config.lastSyncError}`);
  }

  return lines;
}

function formatIssueLine(issue) {
  const identifier = issue.shortId || issue.externalIssueId || "unknown issue";
  const level = String(issue.level || "error").trim();
  const title = String(issue.title || "(untitled)").trim();
  const lastSeenAt = issue.lastSeenAt || "unknown";
  const regressionSuffix = issue.regressionCount > 0 ? ` | regressions:${issue.regressionCount}` : "";
  return `• [${identifier}] ${title} | level:${level} | last seen:${lastSeenAt}${regressionSuffix}`;
}

function buildUsageMessage() {
  return [
    "Usage:",
    "`/conductor errors`",
  ].join("\n");
}

module.exports = {
  ErrorsCommand,
};
