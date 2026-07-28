const { BaseCalypsoCommand } = require("./base_command");
const { readDeployAvailabilityFromTopic } = require("../../shared/deploy_availability");

class GateCommand extends BaseCalypsoCommand {
  constructor() {
    super("gate");
  }

  parse({ commandWords }) {
    const action = String(commandWords[1] || "status").toLowerCase();
    const environment = normalizeEnvironment(commandWords[2]);

    if (action === "status" && commandWords.length <= 3 && environment) {
      return this.buildParsedCommand({ action: "gate_status", environment });
    }
    if (action === "open" && commandWords.length === 3 && environment) {
      return this.buildParsedCommand({ action: "gate_open", environment });
    }
    if (action === "close" && commandWords.length >= 4 && environment) {
      return this.buildParsedCommand({
        action: "gate_close",
        environment,
        reason: commandWords.slice(3).join(" "),
      });
    }

    return this.buildRespondParsedCommand([
      "Usage:",
      "`/calypso gate status [prod|staging]`",
      "`/calypso gate open <prod|staging>`",
      "`/calypso gate close <prod|staging> <REASON>`",
    ].join("\n"));
  }

  async checkCallerAccess({ parsedCommand, runtime }) {
    if (parsedCommand.action === "respond" || parsedCommand.action === "gate_status") {
      return this.allowAccess();
    }
    const access = await runtime.resolveDeployAccessFn(runtime);
    return access.canDeploy
      ? this.allowAccess()
      : this.denyAccess("Gate update denied. Only workspace admins or whitelisted users can change it.");
  }

  async execute({ parsedCommand, runtime }) {
    if (parsedCommand.action === "respond") {
      return this.buildExecutionResult(parsedCommand.responseText);
    }
    if (!runtime.pool) {
      return this.buildExecutionResult("Gate command unavailable: database pool is not configured.");
    }

    if (parsedCommand.action === "gate_status") {
      const state = await runtime.getDeploymentGateStateFn(runtime.pool, parsedCommand.environment);
      let displayedState = state;
      if (!displayedState) {
        const topic = await runtime.resolveCurrentChannelTopicFn(runtime);
        const topicAvailability = readDeployAvailabilityFromTopic(
          topic,
          parsedCommand.environment,
        );
        displayedState = {
          status: topicAvailability === "blocked"
            ? "closed"
            : topicAvailability === "allowed"
              ? "open"
              : "unknown",
          topicFallback: true,
        };
      }
      const summary = state
        ? `${labelEnvironment(parsedCommand.environment)} gate is explicitly ${state.status}.`
        : `${labelEnvironment(parsedCommand.environment)} gate is ${displayedState.status} from the channel-topic fallback.`;
      return this.buildExecutionResult(summary, {
        presentation: buildGatePresentation(displayedState, parsedCommand.environment),
      });
    }

    const status = parsedCommand.action === "gate_close" ? "closed" : "open";
    const existingState = await runtime.getDeploymentGateStateFn(
      runtime.pool,
      parsedCommand.environment,
    );
    const normalizedReason = status === "closed" ? parsedCommand.reason : null;
    if (
      existingState?.status === status
      && String(existingState?.reason || "") === String(normalizedReason || "")
    ) {
      return this.buildExecutionResult(
        `${labelEnvironment(parsedCommand.environment)} deployment gate is already ${status}.`,
        { presentation: buildGatePresentation(existingState, parsedCommand.environment) },
      );
    }
    const summary = `${labelEnvironment(parsedCommand.environment)} deployment gate ${status} by ${runtime.userId || "unknown user"}.`;
    const mutation = await runtime.setDeploymentGateStateWithAuditFn(runtime.pool, {
      actorUserId: runtime.userId,
      environment: parsedCommand.environment,
      reason: parsedCommand.reason,
      status,
      summary,
    });
    const state = mutation.state;
    let topicMirrored = false;
    try {
      topicMirrored = await runtime.updateCurrentChannelTopicFn(runtime, {
        environment: state.environment,
        status,
      });
    } catch (_error) {
      topicMirrored = false;
    }
    return this.buildExecutionResult(summary, {
      gateChanged: true,
      presentation: buildGatePresentation(state, state.environment, { topicMirrored }),
    });
  }

  resolveResponseType({ executionResult }) {
    return executionResult.gateChanged ? "in_channel" : "ephemeral";
  }
}

function buildGatePresentation(state, environment, { topicMirrored = null } = {}) {
  const hasExplicitState = Boolean(state);
  const status = state?.status || "topic fallback";
  return {
    tone: status === "closed" ? "danger" : status === "open" ? "success" : "neutral",
    title: `${labelEnvironment(environment)} deployment gate`,
    summary: hasExplicitState
      ? state.topicFallback
        ? `The channel-topic fallback is ${status}.`
        : `The authoritative gate is ${status}.`
      : "No explicit state has been set; Calypso will use the channel topic.",
    facts: [
      { label: "State", value: status },
      ...(state?.changed_by ? [{ label: "Changed by", value: state.changed_by }] : []),
    ],
    sections: state?.reason ? [{ title: "Reason", text: state.reason }] : [],
    context: topicMirrored === true
      ? "The current Slack channel topic was updated to match."
      : topicMirrored === false
        ? "The explicit gate is authoritative; the channel topic could not be updated automatically."
        : "",
    actions: [
      status === "closed"
        ? { id: "gate_open", label: "Open gate", command: `gate open ${environment}`, style: "primary" }
        : { id: "gate_close_help", label: "Close gate", command: "help deploy" },
      { id: "refresh_status", label: "Refresh status", command: "status" },
    ],
  };
}

function normalizeEnvironment(value) {
  const normalized = String(value || "prod").toLowerCase();
  return normalized === "prod" || normalized === "staging" ? normalized : null;
}

function labelEnvironment(environment) {
  return environment === "staging" ? "Staging" : "Production";
}

module.exports = {
  GateCommand,
};
