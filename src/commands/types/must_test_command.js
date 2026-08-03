const { BaseCalypsoCommand } = require("./base_command");

class MustTestCommand extends BaseCalypsoCommand {
  constructor() {
    super("must-test");
  }

  parse({ commandWords }) {
    const firstArgument = (commandWords[1] || "").toLowerCase();
    const secondArgument = (commandWords[2] || "").toLowerCase();

    if (commandWords.length === 2 && isPositiveInteger(commandWords[1])) {
      return this.buildParsedCommand({
        action: "must_test_set",
        prNumber: Number(commandWords[1]),
      });
    }

    if (
      commandWords.length === 3 &&
      (firstArgument === "off" || firstArgument === "clear") &&
      isPositiveInteger(secondArgument)
    ) {
      return this.buildParsedCommand({
        action: "must_test_clear",
        prNumber: Number(secondArgument),
      });
    }

    return this.buildRespondParsedCommand(
      [
        "Usage:",
        "`/conductor must-test <PR_NUMBER>`",
        "`/conductor must-test off <PR_NUMBER>`",
      ].join("\n"),
    );
  }

  async checkCallerAccess({ parsedCommand, runtime }) {
    const requiresElevatedAccess =
      parsedCommand.action === "must_test_set" || parsedCommand.action === "must_test_clear";
    if (!requiresElevatedAccess) {
      return this.allowAccess();
    }

    const deployAccess = await runtime.resolveDeployAccessFn(runtime);
    if (!deployAccess.canDeploy) {
      return this.denyAccess(
        [
          "Must-test update denied.",
          "Only workspace admins or whitelisted users can manage force-deploy test requirements.",
          "Ask a workspace admin to run `/conductor whitelist <@USER>`.",
        ].join("\n"),
      );
    }

    return this.allowAccess();
  }

  async execute({ parsedCommand, runtime }) {
    if (parsedCommand.action === "respond") {
      return this.buildExecutionResult(parsedCommand.responseText);
    }

    if (!runtime.pool) {
      return this.buildExecutionResult(
        "Must-test command unavailable: database pool is not configured.",
      );
    }

    const blockForceDeploy = parsedCommand.action === "must_test_set";
    const updateResult = await runtime.setPullRequestForceDeployBlockedFn(
      runtime.pool,
      parsedCommand.prNumber,
      blockForceDeploy,
    );

    if (!updateResult.found) {
      return this.buildExecutionResult(`PR #${parsedCommand.prNumber} not found.`);
    }

    if (updateResult.alreadySet) {
      if (blockForceDeploy) {
        return this.buildExecutionResult(
          `PR #${parsedCommand.prNumber} already requires testing before force deploy.`,
        );
      }

      return this.buildExecutionResult(
        `PR #${parsedCommand.prNumber} is already allowed to be bypassed by force deploy.`,
      );
    }

    if (blockForceDeploy) {
      return this.buildExecutionResult(
        `PR #${parsedCommand.prNumber} now requires testing before force deploy.`,
      );
    }

    return this.buildExecutionResult(
      `PR #${parsedCommand.prNumber} no longer requires testing before force deploy.`,
    );
  }
}

function isPositiveInteger(value) {
  const parsedValue = Number(value);
  return Number.isInteger(parsedValue) && parsedValue > 0;
}

module.exports = {
  MustTestCommand,
};
