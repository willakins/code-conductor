const { registerCalypsoCommand } = require("../../../commands/command_router");
const {
  DEPLOY_PROD_TIP_TEXT,
  shouldSendDeployProdTip,
} = require("../deploy_prod_tip");
const { BaseCommunicationPlatform } = require("../base_communication_platform");
const { buildCommunicationMessage } = require("../message_renderer");

const DEFAULT_TEAMS_COMMAND_PATH = "/communication/commands";

class MicrosoftTeamsCommunicationPlatform extends BaseCommunicationPlatform {
  constructor({ config }) {
    super({ provider: "microsoft_teams" });
    this.botName = String(config.botName || "Calypso");
    this.teamsCommandPath = normalizeCommandPath(config.communicationCommandPath);
    this.teamsWebhookUrl = String(config.communicationWebhookUrl || "").trim();
    this.adminUserIds = new Set(normalizeAdminUserIds(config.communicationAdminUserIds));
    this.userDisplayNamesById = new Map();
    this.calypsoCommandHandler = null;
  }

  registerCalypsoCommand(options = {}) {
    const bridgeApp = {
      command: (_commandName, handler) => {
        this.calypsoCommandHandler = handler;
      },
    };

    registerCalypsoCommand(bridgeApp, {
      ...options,
      botName: options.botName || this.botName,
      communicationProvider: "microsoft_teams",
      enableDeploymentCompletionNotifications: false,
    });
  }

  registerHttpRoutes(httpApp) {
    httpApp.post(this.teamsCommandPath, async (request, response) => {
      if (!this.calypsoCommandHandler) {
        response.status(503).json({
          type: "message",
          text: `${this.botName} command handler is not initialized.`,
        });
        return;
      }

      try {
        const requestPayload = await readRequestPayload(request);
        const normalizedCommand = normalizeTeamsCommand(requestPayload, this.botName);
        if (!normalizedCommand.commandText) {
          response.status(400).json({
            type: "message",
            text: "Missing command text. Example: /calypso help",
          });
          return;
        }

        if (normalizedCommand.userId) {
          this.userDisplayNamesById.set(
            normalizedCommand.userId,
            normalizedCommand.userName || normalizedCommand.userId,
          );
        }

        if (shouldSendDeployProdTip(normalizedCommand.commandText)) {
          response.status(200).json({
            type: "message",
            text: DEPLOY_PROD_TIP_TEXT,
          });
          return;
        }

        const responses = [];
        await this.calypsoCommandHandler({
          command: {
            text: normalizedCommand.commandText,
            user_id: normalizedCommand.userId,
          },
          client: null,
          ack: async () => {},
          respond: async (message) => {
            responses.push(message);
          },
        });

        const finalResponse = responses[responses.length - 1];
        response.status(200).json({
          type: "message",
          text: finalResponse?.text || `${this.botName} command completed.`,
          ...(Array.isArray(finalResponse?.attachments)
            ? { attachments: finalResponse.attachments }
            : {}),
        });
      } catch (error) {
        console.error("Failed to process Microsoft Teams command.");
        console.error(error.message);
        response.status(500).json({
          type: "message",
          text: `${this.botName} hit an error while processing that command.`,
        });
      }
    });
  }

  getCommandClient() {
    return null;
  }

  async start() {
    return;
  }

  async postChannelMessage({ presentation, text }) {
    if (!this.teamsWebhookUrl) {
      throw new Error("Microsoft Teams webhook URL is not configured.");
    }

    const messagePayload = buildCommunicationMessage({
      provider: "microsoft_teams",
      text,
      presentation,
    });
    const response = await fetch(this.teamsWebhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        messagePayload.attachments
          ? { type: "message", ...messagePayload }
          : messagePayload,
      ),
    });

    if (!response.ok) {
      const responseBody = await response.text();
      throw new Error(
        `Microsoft Teams message post failed with status ${response.status}: ${responseBody}`,
      );
    }
  }

  async isWorkspaceAdmin(userId) {
    if (!userId) {
      return false;
    }

    return this.adminUserIds.has(userId);
  }

  async resolveUserDisplayName(userId) {
    if (!userId) {
      return null;
    }

    return this.userDisplayNamesById.get(userId) || null;
  }
}

function normalizeCommandPath(rawPath) {
  const normalizedPath = String(rawPath || "").trim();
  if (!normalizedPath) {
    return DEFAULT_TEAMS_COMMAND_PATH;
  }

  return normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`;
}

function normalizeAdminUserIds(adminUserIds) {
  if (!Array.isArray(adminUserIds)) {
    return [];
  }

  return adminUserIds
    .map((userId) => String(userId || "").trim())
    .filter(Boolean);
}

async function readRequestPayload(request) {
  if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) {
    return request.body;
  }

  const rawBody = await readRawRequestBody(request);
  if (!rawBody) {
    return {};
  }

  const contentType = String(request.headers?.["content-type"] || "").toLowerCase();
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(rawBody).entries());
  }

  try {
    return JSON.parse(rawBody);
  } catch (_error) {
    return {};
  }
}

function readRawRequestBody(request) {
  return new Promise((resolve, reject) => {
    let rawBody = "";
    request.setEncoding?.("utf8");
    request.on("data", (chunk) => {
      rawBody += String(chunk || "");
    });
    request.on("end", () => resolve(rawBody));
    request.on("error", reject);
  });
}

function normalizeTeamsCommand(payload, botName) {
  const submittedCommand =
    payload?.value && typeof payload.value === "object"
      ? payload.value.command
      : null;
  const rawText = String(
    payload?.text ||
      payload?.command ||
      submittedCommand ||
      payload?.value ||
      payload?.message ||
      "",
  ).trim();
  const rawUserId = String(
    payload?.from?.id ||
      payload?.user_id ||
      payload?.userId ||
      "",
  ).trim();
  const rawUserName = String(
    payload?.from?.name ||
      payload?.user_name ||
      payload?.userName ||
      "",
  ).trim();

  return {
    commandText: stripBotPrefix(rawText, botName),
    userId: rawUserId || null,
    userName: rawUserName || null,
  };
}

function stripBotPrefix(rawText, botName) {
  const normalizedText = String(rawText || "").trim();
  if (!normalizedText) {
    return "";
  }

  const escapedBotName = escapeRegex(String(botName || "").trim());
  if (!escapedBotName) {
    return normalizedText;
  }

  const slashPrefixMatch = normalizedText.match(new RegExp(`^\\/${escapedBotName}\\s*(.*)$`, "i"));
  if (slashPrefixMatch) {
    return slashPrefixMatch[1].trim();
  }

  const plainPrefixMatch = normalizedText.match(new RegExp(`^${escapedBotName}\\s+(.*)$`, "i"));
  if (plainPrefixMatch) {
    return plainPrefixMatch[1].trim();
  }

  return normalizedText;
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  MicrosoftTeamsCommunicationPlatform,
};
