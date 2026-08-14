const { buildCommunicationMessage } = require("./message_renderer");

function createSlackMessageClientAdapter(slackClient) {
  if (!slackClient?.chat || typeof slackClient.chat.postMessage !== "function") {
    return null;
  }

  return {
    async postChannelMessage({ channelId, mrkdwn, presentation, text }) {
      await slackClient.chat.postMessage({
        channel: channelId,
        mrkdwn,
        ...buildCommunicationMessage({
          provider: "slack",
          presentation,
          text,
        }),
      });
    },
  };
}

module.exports = {
  createSlackMessageClientAdapter,
};
