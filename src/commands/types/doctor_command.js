const { BaseCalypsoCommand } = require("./base_command");

class DoctorCommand extends BaseCalypsoCommand {
  constructor() {
    super("doctor");
  }

  parse({ commandWords }) {
    return commandWords.length === 1
      ? this.buildParsedCommand({ action: "doctor" })
      : this.buildRespondParsedCommand("Usage: `/calypso doctor`");
  }

  async checkCallerAccess({ runtime }) {
    const access = await runtime.resolveDeployAccessFn(runtime);
    return access.canDeploy
      ? this.allowAccess()
      : this.denyAccess("Diagnostics denied. Only workspace admins or whitelisted users can view operational configuration.");
  }

  async execute({ parsedCommand, runtime }) {
    if (parsedCommand.action === "respond") {
      return this.buildExecutionResult(parsedCommand.responseText);
    }
    const checks = await runtime.runDoctorDiagnosticsFn(runtime);
    const failingChecks = checks.filter((check) => check.status !== "ok");
    return this.buildExecutionResult(
      failingChecks.length === 0
        ? "All Calypso diagnostics passed."
        : `${failingChecks.length} Calypso diagnostic check(s) need attention.`,
      {
        presentation: {
          tone: failingChecks.some((check) => check.status === "error") ? "danger"
            : failingChecks.length > 0 ? "warning" : "success",
          title: "Calypso diagnostics",
          summary: failingChecks.length === 0
            ? "All configured runtime dependencies are healthy."
            : `${failingChecks.length} check(s) need attention.`,
          sections: [{
            title: "Checks",
            items: checks.map((check) => ({
              title: `${check.status === "ok" ? "✅" : check.status === "warning" ? "⚠️" : "⛔"} ${check.label}`,
              description: check.detail,
            })),
          }],
          actions: [{ id: "rerun_doctor", label: "Run again", command: "doctor" }],
        },
      },
    );
  }
}

module.exports = {
  DoctorCommand,
};
