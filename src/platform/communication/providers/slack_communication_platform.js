const { App } = require("@slack/bolt");

const { registerCalypsoCommand } = require("../../../commands/command_router");
const {
  DEPLOY_PROD_TIP_TEXT,
  shouldSendDeployProdTip,
} = require("../deploy_prod_tip");
const { BaseCommunicationPlatform } = require("../base_communication_platform");
const { buildCommunicationMessage } = require("../message_renderer");

class SlackCommunicationPlatform extends BaseCommunicationPlatform {
  constructor({ config, app } = {}) {
    super({ provider: "slack" });
    this.app =
      app ||
      new App({
        token: config.communicationBotToken || config.slackBotToken,
        appToken: config.communicationAppToken || config.slackAppToken,
        socketMode: true,
      });
    this.registerDeployProdTipListener();
  }

  registerCalypsoCommand(options = {}) {
    registerCalypsoCommand(this.app, {
      ...options,
      communicationProvider: "slack",
    });
  }

  getCommandClient() {
    return this.app.client;
  }

  async start() {
    await this.app.start();
  }

  async postChannelMessage({ channelId, mrkdwn = true, presentation, text }) {
    await this.app.client.chat.postMessage({
      channel: channelId,
      mrkdwn,
      ...buildCommunicationMessage({
        provider: "slack",
        text,
        presentation,
      }),
    });
  }

  async isWorkspaceAdmin(userId) {
    if (!userId) {
      return false;
    }

    try {
      const response = await this.app.client.users.info({ user: userId });
      const user = response.user || {};
      return Boolean(user.is_admin || user.is_owner || user.is_primary_owner);
    } catch (_error) {
      return false;
    }
  }

  async resolveUserDisplayName(userId) {
    if (!userId) {
      return null;
    }

    try {
      const response = await this.app.client.users.info({ user: userId });
      const user = response.user || {};
      const profile = user.profile || {};
      return profile.display_name || profile.real_name || user.name || null;
    } catch (_error) {
      return null;
    }
  }

  registerDeployProdTipListener() {
    if (typeof this.app.message !== "function") {
      return;
    }

    this.app.message(async ({ client, message }) => {
      if (!shouldPostDeployProdTip(message) || typeof client?.chat?.postEphemeral !== "function") {
        return;
      }

      try {
        await client.chat.postEphemeral({
          channel: message.channel,
          text: DEPLOY_PROD_TIP_TEXT,
          user: message.user,
        });
      } catch (error) {
        console.error("Failed to send deploy prod tip.");
        console.error(error.message);
      }
    });
  }
}

function shouldPostDeployProdTip(message) {
  if (!message || message.subtype || message.bot_id) {
    return false;
  }

  if (!message.channel || !message.user) {
    return false;
  }

  return shouldSendDeployProdTip(message.text);
}

module.exports = {
  SlackCommunicationPlatform,
};
