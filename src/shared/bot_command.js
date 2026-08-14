const DEFAULT_BOT_NAME = "Code Conductor";
const DEFAULT_BOT_COMMAND_PREFIX = "/conductor";

function resolveBotCommandPrefix(botName) {
  const normalizedBotName = String(botName || "").trim();
  if (
    !normalizedBotName ||
    normalizedBotName.toLowerCase() === DEFAULT_BOT_NAME.toLowerCase()
  ) {
    return DEFAULT_BOT_COMMAND_PREFIX;
  }

  const commandName = normalizedBotName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return commandName ? `/${commandName}` : DEFAULT_BOT_COMMAND_PREFIX;
}

module.exports = {
  DEFAULT_BOT_NAME,
  resolveBotCommandPrefix,
};
