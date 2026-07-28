const { BaseCalypsoCommand } = require("./base_command");
const { buildSupportEmailDraftPrompt } = require("../../shared/support_email_draft");

class EmailsCommand extends BaseCalypsoCommand {
  constructor() {
    super("emails");
  }

  parse({ commandWords }) {
    if (commandWords.length === 1) {
      return this.buildParsedCommand({
        action: "emails_list",
      });
    }

    if (commandWords.length === 3 && String(commandWords[1] || "").toLowerCase() === "responded") {
      const emailId = Number(commandWords[2]);
      if (!Number.isInteger(emailId) || emailId <= 0) {
        return this.buildRespondParsedCommand(buildUsageMessage());
      }

      return this.buildParsedCommand({
        action: "emails_responded",
        emailId,
      });
    }

    if (commandWords.length >= 3 && String(commandWords[1] || "").toLowerCase() === "draft") {
      const emailId = Number(commandWords[2]);
      if (!Number.isInteger(emailId) || emailId <= 0) {
        return this.buildRespondParsedCommand(buildUsageMessage());
      }

      return this.buildParsedCommand({
        action: "emails_draft",
        additionalInstructions: commandWords.slice(3).join(" ").trim() || null,
        emailId,
      });
    }

    return this.buildRespondParsedCommand(buildUsageMessage());
  }

  async checkCallerAccess({ parsedCommand, runtime }) {
    if (parsedCommand.action !== "emails_draft" || !runtime.pool) {
      return this.allowAccess();
    }

    const [supportEmailConfig, isWorkspaceAdmin] = await Promise.all([
      runtime.getSupportEmailConfigFn(runtime.pool),
      runtime.isWorkspaceAdminFn(runtime.communicationClient, runtime.userId),
    ]);
    if (isWorkspaceAdmin || isCurrentSupportEmailOnCall(supportEmailConfig, runtime.userId)) {
      return this.allowAccess();
    }

    return this.denyAccess(
      [
        "Email draft denied.",
        "Only workspace admins or the current support-email on-call user can generate AI drafts.",
      ].join("\n"),
    );
  }

  async execute({ parsedCommand, runtime }) {
    if (!runtime.pool) {
      return this.buildExecutionResult("Emails command unavailable: database pool is not configured.");
    }

    if (parsedCommand.action === "respond") {
      return this.buildExecutionResult(parsedCommand.responseText || buildUsageMessage());
    }

    if (parsedCommand.action === "emails_list") {
      const emailThreads = await runtime.listPendingSupportEmailThreadsFn(runtime.pool);
      if (emailThreads.length === 0) {
        return this.buildExecutionResult("No pending customer support emails.");
      }

      return this.buildExecutionResult(
        [
          "Pending customer support emails:",
          ...emailThreads.map(formatPendingSupportEmailLine),
        ].join("\n"),
        {
          presentation: {
            tone: "neutral",
            title: "Support email queue",
            summary: `${emailThreads.length} customer thread(s) are waiting for a response.`,
            sections: [{
              title: "Queue",
              items: emailThreads.map((thread) => ({
                title: `[${thread.id}] ${thread.subject || "(no subject)"}`,
                description: `From ${thread.first_sender || "unknown sender"}`,
              })),
            }],
            actions: [{ id: "refresh_emails", label: "Refresh", command: "emails" }],
          },
        },
      );
    }

    if (parsedCommand.action === "emails_draft") {
      return this.generateSupportEmailDraft(parsedCommand, runtime);
    }

    const respondedResult = await runtime.markSupportEmailThreadRespondedFn(
      runtime.pool,
      parsedCommand.emailId,
      runtime.userId,
    );
    if (!respondedResult.found) {
      return this.buildExecutionResult(`Support email [${parsedCommand.emailId}] not found.`);
    }

    if (respondedResult.alreadyResponded) {
      return this.buildExecutionResult(`Support email [${parsedCommand.emailId}] is already marked responded.`);
    }

    return this.buildExecutionResult(`Marked support email [${parsedCommand.emailId}] as responded.`);
  }

  async generateSupportEmailDraft(parsedCommand, runtime) {
    const emailThread = await runtime.getSupportEmailThreadByIdFn(runtime.pool, parsedCommand.emailId);
    if (!emailThread) {
      return this.buildExecutionResult(`Support email [${parsedCommand.emailId}] not found.`);
    }

    const aiResolution = await resolveAiClient(runtime);
    if (!aiResolution.aiClient) {
      return this.buildExecutionResult(
        [
          "AI drafting unavailable.",
          `Configure credentials for the active AI provider (\`${aiResolution.aiProvider || runtime.aiProvider || "openai"}\`).`,
        ].join(" "),
      );
    }

    const messageTextResolution = await resolveMessageTextForDraft({
      emailThread,
      runtime,
    });
    if (!messageTextResolution.messageText) {
      const failureDetail = messageTextResolution.error ? ` ${messageTextResolution.error.message}` : "";
      return this.buildExecutionResult(
        `Support email [${parsedCommand.emailId}] is missing retrievable message text.${failureDetail}`,
      );
    }

    const draftEmailThread = {
      ...emailThread,
      first_message_text: messageTextResolution.messageText,
    };
    const prompt = buildSupportEmailDraftPrompt({
      additionalInstructions: parsedCommand.additionalInstructions,
      emailThread: draftEmailThread,
      organizationPrompt: runtime.aiSupportEmailSystemPrompt,
    });

    try {
      const draftBody = await aiResolution.aiClient.generateText({
        systemPrompt: prompt.systemPrompt,
        userPrompt: prompt.userPrompt,
        temperature: 0.2,
      });

      return this.buildExecutionResult(
        [
          `Draft reply for support email [${parsedCommand.emailId}]`,
          `Subject: ${prompt.replySubject}`,
          "",
          draftBody,
        ].join("\n"),
      );
    } catch (error) {
      return this.buildExecutionResult(`Failed to draft support email [${parsedCommand.emailId}]: ${error.message}`);
    }
  }
}

function buildUsageMessage() {
  return [
    "Usage:",
    "`/calypso emails`",
    "`/calypso emails draft <EMAIL_ID> [ADDITIONAL_INSTRUCTIONS...]`",
    "`/calypso emails responded <EMAIL_ID>`",
  ].join("\n");
}

function formatPendingSupportEmailLine(emailThread) {
  const emailId = emailThread.id;
  const sender = String(emailThread.first_sender || "").trim() || "unknown sender";
  const subject = String(emailThread.subject || "").trim() || "(no subject)";
  return `• [${emailId}] ${sender} | ${subject}`;
}

async function resolveAiClient(runtime) {
  if (typeof runtime.resolveAiClientFn !== "function") {
    return {
      aiClient: null,
      aiProvider: runtime.aiProvider || null,
    };
  }

  const resolvedValue = await runtime.resolveAiClientFn();
  if (resolvedValue && typeof resolvedValue === "object" && "aiClient" in resolvedValue) {
    return {
      aiClient: resolvedValue.aiClient || null,
      aiProvider: resolvedValue.aiProvider || runtime.aiProvider || null,
    };
  }

  return {
    aiClient: resolvedValue || null,
    aiProvider: runtime.aiProvider || null,
  };
}

async function resolveMessageTextForDraft({ emailThread, runtime }) {
  const cachedMessageText = String(emailThread?.first_message_text || "").trim();
  if (cachedMessageText !== "") {
    return {
      messageText: cachedMessageText,
    };
  }

  const firstMessageId = String(emailThread?.gmail_first_message_id || "").trim();
  if (firstMessageId === "") {
    return {
      messageText: null,
    };
  }
  if (typeof runtime.resolveEmailClientByProviderFn !== "function") {
    return {
      messageText: null,
    };
  }

  const providerCandidates = await buildEmailProviderCandidates(emailThread, runtime);
  let lastError = null;
  for (const provider of providerCandidates) {
    try {
      const resolvedClient = await runtime.resolveEmailClientByProviderFn(provider);
      const emailClient =
        resolvedClient && typeof resolvedClient === "object" && "emailClient" in resolvedClient
          ? resolvedClient.emailClient
          : resolvedClient;
      if (!emailClient || typeof emailClient.getMessageDetail !== "function") {
        continue;
      }

      const messageDetail = await emailClient.getMessageDetail(firstMessageId);
      const messageText = String(messageDetail?.plainTextBody || "").trim();
      if (messageText === "") {
        continue;
      }

      if (typeof runtime.cacheSupportEmailThreadMessageTextFn === "function") {
        await runtime.cacheSupportEmailThreadMessageTextFn(
          runtime.pool,
          emailThread.id,
          messageText,
          provider,
        );
      }

      return {
        messageText,
      };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    error: lastError,
    messageText: null,
  };
}

async function buildEmailProviderCandidates(emailThread, runtime) {
  const providerCandidates = [];
  const sourceProvider = String(emailThread?.source_provider || "").trim().toLowerCase();
  if (sourceProvider !== "") {
    providerCandidates.push(sourceProvider);
  }

  const activeProvider = await readActiveEmailProvider(runtime);
  if (activeProvider && !providerCandidates.includes(activeProvider)) {
    providerCandidates.push(activeProvider);
  }

  return providerCandidates;
}

async function readActiveEmailProvider(runtime) {
  if (!runtime.pool || typeof runtime.getRuntimeProviderConfigFn !== "function") {
    return runtime.emailProvider || null;
  }

  try {
    const runtimeProviderConfig = await runtime.getRuntimeProviderConfigFn(runtime.pool);
    return runtimeProviderConfig?.emailProvider || runtime.emailProvider || null;
  } catch (_error) {
    return runtime.emailProvider || null;
  }
}

function isCurrentSupportEmailOnCall(config, userId) {
  const normalizedUserId = String(userId || "").trim();
  const configuredOnCallUserId = String(config?.onCallUserId || "").trim();
  const onCallExpiresAt = String(config?.onCallExpiresAt || "").trim();
  if (!normalizedUserId || !configuredOnCallUserId || !onCallExpiresAt) {
    return false;
  }

  const expiresAt = new Date(onCallExpiresAt).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return false;
  }

  return configuredOnCallUserId === normalizedUserId;
}

module.exports = {
  EmailsCommand,
};
