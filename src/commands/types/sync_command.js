const { BaseCalypsoCommand } = require("./base_command");

class SyncCommand extends BaseCalypsoCommand {
  constructor() {
    super("sync");
  }

  parse({ commandWords }) {
    if (commandWords.length !== 1) {
      return this.buildRespondParsedCommand("Usage: `/conductor sync`");
    }

    return this.buildParsedCommand({
      action: "sync_open_pr_review_state",
    });
  }

  async checkCallerAccess({ runtime }) {
    const syncAccess = await runtime.resolveDeployAccessFn(runtime);
    if (!syncAccess.canDeploy) {
      return this.denyAccess(
        [
          "Sync denied.",
          "Only workspace admins or whitelisted users can run manual sync.",
          "Ask a workspace admin to run `/conductor whitelist <@USER>`.",
        ].join("\n"),
      );
    }

    return this.allowAccess();
  }

  async execute({ runtime }) {
    if (typeof runtime.runOpenPullRequestSyncNowFn !== "function") {
      return this.buildExecutionResult(
        `Sync unavailable: configure \`CODE_HOST_TOKEN\` for the active code-host provider.`,
      );
    }

    try {
      await this.sendInProgressResponse(runtime);
      const syncSummary = await runtime.runOpenPullRequestSyncNowFn();
      if (syncSummary?.unavailableReason) {
        return this.buildExecutionResult(syncSummary.unavailableReason);
      }

      const upsertedCount = Number(syncSummary?.upsertedCount) || 0;
      const closedCount = Number(syncSummary?.closedCount) || 0;
      const mergedUntestedCount = Number(syncSummary?.mergedUntestedCount) || 0;

      return this.buildExecutionResult(
        [
          "Open PR sync completed successfully.",
          `Review sync: upserted ${upsertedCount} open PR(s), marked ${closedCount} stale PR(s) closed.`,
          `Untested merge sync: upserted ${mergedUntestedCount} merged untested PR(s).`,
        ].join(" "),
      );
    } catch (error) {
      return this.buildExecutionResult(
        `Open PR sync failed: ${error.message}`,
      );
    }
  }

  async sendInProgressResponse(runtime) {
    if (typeof runtime.sendInterimResponseFn !== "function") {
      return;
    }

    try {
      await runtime.sendInterimResponseFn({
        responseType: "ephemeral",
        text: "Open PR sync started. Syncing in progress...",
      });
    } catch (_error) {
      // Continue sync execution even if interim message delivery fails.
    }
  }
}

module.exports = {
  SyncCommand,
};
