const { BaseCalypsoCommand } = require("./base_command");
const {
  readCommunicationUserReferenceFromArgument,
  resolveCommunicationUserId,
} = require("../../platform/communication/resolution");

class WhitelistCommand extends BaseCalypsoCommand {
  constructor() {
    super("whitelist");
  }

  parse({ commandWords }) {
    const targetArgument = commandWords.slice(1).join(" ").trim();
    const targetUserReference = readCommunicationUserReferenceFromArgument(targetArgument);

    if (!targetUserReference) {
      return this.buildRespondParsedCommand("Usage: `/conductor whitelist <@USER>`");
    }

    return this.buildParsedCommand({
      action: "whitelist_add",
      ...targetUserReference,
    });
  }

  async checkCallerAccess({ runtime }) {
    const whitelistAccess = await runtime.resolveDeployAccessFn(runtime);
    if (!whitelistAccess.canDeploy) {
      return this.denyAccess(
        "Only workspace admins or whitelisted users can manage deploy whitelist.",
      );
    }

    return this.allowAccess();
  }

  async execute({ parsedCommand, runtime }) {
    if (parsedCommand.action === "respond") {
      return this.buildExecutionResult(
        parsedCommand.responseText || "Usage: `/conductor whitelist <@USER>`",
      );
    }

    if (!runtime.pool) {
      return this.buildExecutionResult(
        "Whitelist command unavailable: database pool is not configured.",
      );
    }

    const targetUserIdResolution = await resolveTargetUserId(runtime, parsedCommand);
    if (!targetUserIdResolution.isResolvable) {
      return this.buildExecutionResult(targetUserIdResolution.reasonText);
    }

    const result = await runtime.addUserToDeployWhitelistFn(
      runtime.pool,
      targetUserIdResolution.targetUserId,
      runtime.userId,
    );

    if (!result.added) {
      return this.buildExecutionResult(
        `<@${targetUserIdResolution.targetUserId}> is already in deploy whitelist.`,
      );
    }

    return this.buildExecutionResult(
      `Added <@${targetUserIdResolution.targetUserId}> to deploy whitelist.`,
    );
  }
}

async function resolveTargetUserId(runtime, parsedCommand) {
  if (!parsedCommand.targetUserId && !parsedCommand.targetUserHandle) {
    return {
      isResolvable: false,
      reasonText: "Usage: `/conductor whitelist <@USER>`",
    };
  }

  const resolution = await resolveCommunicationUserId(runtime, parsedCommand);
  if (resolution.isResolvable) {
    return {
      isResolvable: true,
      targetUserId: resolution.targetUserId,
    };
  }

  const targetUserHandle = resolution.targetUserHandle || parsedCommand.targetUserHandle;
  if (resolution.reason === "user_lookup_unavailable") {
    return {
      isResolvable: false,
      reasonText: [
        `Cannot resolve \`@${targetUserHandle}\` with current Slack permissions.`,
        "Use `/conductor whitelist <@USER>` or `/conductor whitelist U123ABC`.",
      ].join(" "),
    };
  }

  if (resolution.platformErrorCode === "missing_scope") {
    const neededText = resolution.neededScopes ? ` Needed scopes: \`${resolution.neededScopes}\`.` : "";
    const providedText = resolution.providedScopes
      ? ` Current scopes: \`${resolution.providedScopes}\`.`
      : "";
    return {
      isResolvable: false,
      reasonText: [
        `Cannot resolve \`@${targetUserHandle}\` because Slack denied user lookup (\`missing_scope\`).`,
        `Grant the bot token user-read scope and reinstall the app.${neededText}${providedText}`,
        "Or whitelist using a direct Slack user ID: `/conductor whitelist U123ABC`.",
      ].join(" "),
    };
  }

  if (resolution.reason === "user_not_found") {
    return {
      isResolvable: false,
      reasonText: [
        `Could not resolve \`@${targetUserHandle}\` to a Slack user.`,
        "Use `/conductor whitelist <@USER>` or `/conductor whitelist U123ABC`.",
      ].join(" "),
    };
  }

  return {
    isResolvable: false,
    reasonText: [
      `Cannot resolve \`@${targetUserHandle}\` right now (Slack error: \`${resolution.platformErrorCode || "unknown_error"}\`).`,
      "Use `/conductor whitelist <@USER>` or `/conductor whitelist U123ABC`.",
    ].join(" "),
  };
}

module.exports = {
  WhitelistCommand,
};
