const { BaseCalypsoCommand } = require("./base_command");
const {
  AI_PROVIDERS,
  CODE_HOST_PROVIDERS,
  COMMUNICATION_PROVIDERS,
  DEPLOY_PROVIDERS,
  EMAIL_PROVIDERS,
  ERROR_TRACKING_PROVIDERS,
} = require("../../config");
const { parseDurationToken } = require("../../shared/durations");
const {
  readCommunicationUserReferenceFromArgument,
  resolveCommunicationChannelId,
  resolveCommunicationUserId,
  verifyCommunicationChannelAccess,
} = require("../../platform/communication/resolution");

const TIME_FORMAT_ARGUMENT_PATTERN = /^time-format:(human|long)$/i;
const TIME_ZONE_ARGUMENT_PATTERN = /^timezone:(.+)$/i;
const REVIEW_RECAP_CHANNEL_ARGUMENT_PATTERN = /^review-recap-channel:(.+)$/i;
const REVIEW_RECAP_RECENCY_ARGUMENT_PATTERN = /^review-recap-recency:(\d+)([dw])$/i;
const REVIEW_RECAP_WINDOW_ARGUMENT_PATTERN = /^review-recap-window:(.+)$/i;
const REVIEW_RECAP_SCHEDULE_ARGUMENT_PATTERN =
  /^review-recap-schedule:(daily|mon|tue|wed|thu|fri|sat|sun)@(.+)$/i;
const REVIEW_RECAP_SEND_WEEKENDS_ARGUMENT_PATTERN = /^review-recap-send-weekends:(on|off)$/i;
const REVIEW_RECAP_SEND_HOLIDAYS_ARGUMENT_PATTERN = /^review-recap-send-holidays:(on|off)$/i;
const ENVIRONMENT_STATUS_ARGUMENT_PATTERN = /^environment-status:(on|off)$/i;
const ENVIRONMENT_STATUS_URL_ARGUMENT_PATTERN = /^environment-status-url:(.+)$/i;
const ENVIRONMENT_STATUS_CHANNEL_ARGUMENT_PATTERN = /^environment-status-channel:(.+)$/i;
const ERROR_TRACKING_ARGUMENT_PATTERN = /^error-tracking:(on|off)$/i;
const ERROR_TRACKING_CHANNEL_ARGUMENT_PATTERN = /^error-tracking-channel:(.+)$/i;
const ERROR_TRACKING_PROJECT_ARGUMENT_PATTERN = /^error-tracking-project:(.+)$/i;
const ERROR_TRACKING_ENVIRONMENT_ARGUMENT_PATTERN = /^error-tracking-environment:(.+)$/i;
const EMAIL_MONITOR_ARGUMENT_PATTERN = /^email-monitor:(on|off)$/i;
const EMAIL_CHANNEL_ARGUMENT_PATTERN = /^email-channel:(.+)$/i;
const GITHUB_SLACK_USER_MAP_ARGUMENT_PATTERN = /^github-slack-user-map:([^=]+)=(.+)$/i;
const REVIEW_RECAP_SCHEDULE_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const GITHUB_USERNAME_PATTERN = /^@?([a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?)$/i;
const SLACK_USER_MENTION_PATTERN = /^<@([UW][A-Z0-9]+)(?:\|[^>]+)?>$/i;
const SLACK_USER_ID_PATTERN = /^([UW][A-Z0-9]*[0-9][A-Z0-9]*)$/i;
const SLACK_USERNAME_PATTERN = /^@?([a-z0-9][a-z0-9._-]*)$/i;
const EMAIL_ON_CALL_COMMAND_NAME = "email-on-call";
const DEPLOY_ENVIRONMENT_ARGUMENT_PATTERN = /^deploy-environment:(prod|staging)$/i;
const COMMUNICATION_PROVIDER_ARGUMENT_PATTERN = buildProviderArgumentPattern(
  "communication-provider",
  Object.values(COMMUNICATION_PROVIDERS),
);
const CODE_HOST_PROVIDER_ARGUMENT_PATTERN = buildProviderArgumentPattern(
  "code-host-provider",
  Object.values(CODE_HOST_PROVIDERS),
);
const DEPLOY_PROVIDER_ARGUMENT_PATTERN = buildProviderArgumentPattern(
  "deploy-provider",
  Object.values(DEPLOY_PROVIDERS),
);
const EMAIL_PROVIDER_ARGUMENT_PATTERN = buildProviderArgumentPattern(
  "email-provider",
  Object.values(EMAIL_PROVIDERS),
);
const AI_PROVIDER_ARGUMENT_PATTERN = buildProviderArgumentPattern(
  "ai-provider",
  Object.values(AI_PROVIDERS),
);
const ERROR_TRACKING_PROVIDER_ARGUMENT_PATTERN = buildProviderArgumentPattern(
  "error-tracking-provider",
  Object.values(ERROR_TRACKING_PROVIDERS),
);
const UNAVAILABLE_PROVIDERS = Object.freeze({});

class ConfigCommand extends BaseCalypsoCommand {
  constructor() {
    super("config");
  }

  buildExecutionResult(responseText, additionalFields = {}) {
    if (additionalFields.presentation) {
      return super.buildExecutionResult(responseText, additionalFields);
    }
    return super.buildExecutionResult(responseText, {
      ...additionalFields,
      presentation: buildConfigPresentation(responseText),
    });
  }

  parse({ commandWords }) {
    if (commandWords.length < 2) {
      return this.buildRespondParsedCommand(buildConfigUsageMessage());
    }

    const secondWord = String(commandWords[1] || "").toLowerCase();
    if (secondWord === EMAIL_ON_CALL_COMMAND_NAME) {
      return parseEmailOnCallCommand(this, commandWords);
    }

    if (commandWords.length !== 2) {
      return this.buildRespondParsedCommand(buildConfigUsageMessage());
    }

    const argument = commandWords[1];
    const match = argument.match(TIME_FORMAT_ARGUMENT_PATTERN);
    if (match) {
      return this.buildParsedCommand({
        action: "config_time_format",
        timeFormat: match[1].toLowerCase(),
      });
    }

    const timezoneMatch = argument.match(TIME_ZONE_ARGUMENT_PATTERN);
    if (timezoneMatch) {
      return this.buildParsedCommand({
        action: "config_timezone",
        timeZone: timezoneMatch[1].trim(),
      });
    }

    const recapChannelMatch = argument.match(REVIEW_RECAP_CHANNEL_ARGUMENT_PATTERN);
    if (recapChannelMatch) {
      const targetChannelReference = String(recapChannelMatch[1] || "").trim();
      if (targetChannelReference === "") {
        return this.buildRespondParsedCommand(buildConfigUsageMessage());
      }
      return this.buildParsedCommand({
        action: "config_review_recap_channel",
        targetChannelReference,
      });
    }

    const recapRecencyMatch = argument.match(REVIEW_RECAP_RECENCY_ARGUMENT_PATTERN);
    if (recapRecencyMatch) {
      return this.buildParsedCommand({
        action: "config_review_recap_recency",
        recencyValue: Number(recapRecencyMatch[1]),
        recencyUnit: recapRecencyMatch[2].toLowerCase(),
      });
    }

    const recapWindowMatch = argument.match(REVIEW_RECAP_WINDOW_ARGUMENT_PATTERN);
    if (recapWindowMatch) {
      const reviewScope = normalizeReviewRecapWindow(recapWindowMatch[1]);
      if (!reviewScope) {
        return this.buildRespondParsedCommand(buildConfigUsageMessage());
      }

      return this.buildParsedCommand({
        action: "config_review_recap_window",
        reviewScope,
      });
    }

    const recapScheduleMatch = argument.match(REVIEW_RECAP_SCHEDULE_ARGUMENT_PATTERN);
    if (recapScheduleMatch) {
      const normalizedScheduleTime = normalizeReviewRecapScheduleTimes(recapScheduleMatch[2]);
      if (!normalizedScheduleTime) {
        return this.buildRespondParsedCommand(buildConfigUsageMessage());
      }

      return this.buildParsedCommand({
        action: "config_review_recap_schedule",
        scheduleWeekday: recapScheduleMatch[1].toLowerCase(),
        scheduleTime: normalizedScheduleTime,
      });
    }

    const recapSendWeekendsMatch = argument.match(REVIEW_RECAP_SEND_WEEKENDS_ARGUMENT_PATTERN);
    if (recapSendWeekendsMatch) {
      return this.buildParsedCommand({
        action: "config_review_recap_send_weekends",
        sendOnWeekends: recapSendWeekendsMatch[1].toLowerCase() === "on",
      });
    }

    const recapSendHolidaysMatch = argument.match(REVIEW_RECAP_SEND_HOLIDAYS_ARGUMENT_PATTERN);
    if (recapSendHolidaysMatch) {
      return this.buildParsedCommand({
        action: "config_review_recap_send_holidays",
        sendOnHolidays: recapSendHolidaysMatch[1].toLowerCase() === "on",
      });
    }

    const environmentStatusMatch = argument.match(ENVIRONMENT_STATUS_ARGUMENT_PATTERN);
    if (environmentStatusMatch) {
      return this.buildParsedCommand({
        action: "config_environment_status",
        enabled: environmentStatusMatch[1].toLowerCase() === "on",
      });
    }

    const environmentStatusUrlMatch = argument.match(ENVIRONMENT_STATUS_URL_ARGUMENT_PATTERN);
    if (environmentStatusUrlMatch) {
      return this.buildParsedCommand({
        action: "config_environment_status_url",
        targetUrl: String(environmentStatusUrlMatch[1] || "").trim(),
      });
    }

    const environmentStatusChannelMatch = argument.match(ENVIRONMENT_STATUS_CHANNEL_ARGUMENT_PATTERN);
    if (environmentStatusChannelMatch) {
      const targetChannelReference = String(environmentStatusChannelMatch[1] || "").trim();
      if (targetChannelReference === "") {
        return this.buildRespondParsedCommand(buildConfigUsageMessage());
      }

      return this.buildParsedCommand({
        action: "config_environment_status_channel",
        targetChannelReference,
      });
    }

    const errorTrackingMatch = argument.match(ERROR_TRACKING_ARGUMENT_PATTERN);
    if (errorTrackingMatch) {
      return this.buildParsedCommand({
        action: "config_error_tracking",
        enabled: errorTrackingMatch[1].toLowerCase() === "on",
      });
    }

    const errorTrackingChannelMatch = argument.match(ERROR_TRACKING_CHANNEL_ARGUMENT_PATTERN);
    if (errorTrackingChannelMatch) {
      const targetChannelReference = String(errorTrackingChannelMatch[1] || "").trim();
      if (targetChannelReference === "") {
        return this.buildRespondParsedCommand(buildConfigUsageMessage());
      }

      return this.buildParsedCommand({
        action: "config_error_tracking_channel",
        targetChannelReference,
      });
    }

    const errorTrackingProjectMatch = argument.match(ERROR_TRACKING_PROJECT_ARGUMENT_PATTERN);
    if (errorTrackingProjectMatch) {
      return this.buildParsedCommand({
        action: "config_error_tracking_project",
        projectSlug: String(errorTrackingProjectMatch[1] || "").trim(),
      });
    }

    const errorTrackingEnvironmentMatch = argument.match(ERROR_TRACKING_ENVIRONMENT_ARGUMENT_PATTERN);
    if (errorTrackingEnvironmentMatch) {
      return this.buildParsedCommand({
        action: "config_error_tracking_environment",
        environment: String(errorTrackingEnvironmentMatch[1] || "").trim(),
      });
    }

    const emailMonitorMatch = argument.match(EMAIL_MONITOR_ARGUMENT_PATTERN);
    if (emailMonitorMatch) {
      return this.buildParsedCommand({
        action: "config_email_monitor",
        enabled: emailMonitorMatch[1].toLowerCase() === "on",
      });
    }

    const emailChannelMatch = argument.match(EMAIL_CHANNEL_ARGUMENT_PATTERN);
    if (emailChannelMatch) {
      const targetChannelReference = String(emailChannelMatch[1] || "").trim();
      if (targetChannelReference === "") {
        return this.buildRespondParsedCommand(buildConfigUsageMessage());
      }

      return this.buildParsedCommand({
        action: "config_email_channel",
        targetChannelReference,
      });
    }

    const githubSlackUserMapMatch = argument.match(GITHUB_SLACK_USER_MAP_ARGUMENT_PATTERN);
    if (githubSlackUserMapMatch) {
      const githubUsername = normalizeGithubUsernameToken(githubSlackUserMapMatch[1]);
      const slackUsername = normalizeSlackUsernameToken(githubSlackUserMapMatch[2]);
      if (!githubUsername || !slackUsername) {
        return this.buildRespondParsedCommand(buildConfigUsageMessage());
      }

      return this.buildParsedCommand({
        action: "config_github_slack_user_map",
        githubUsername,
        slackUsername,
      });
    }

    const communicationProviderMatch = argument.match(COMMUNICATION_PROVIDER_ARGUMENT_PATTERN);
    if (communicationProviderMatch) {
      return this.buildParsedCommand({
        action: "config_communication_provider",
        communicationProvider: communicationProviderMatch[1].toLowerCase(),
      });
    }

    const codeHostProviderMatch = argument.match(CODE_HOST_PROVIDER_ARGUMENT_PATTERN);
    if (codeHostProviderMatch) {
      return this.buildParsedCommand({
        action: "config_code_host_provider",
        codeHostProvider: codeHostProviderMatch[1].toLowerCase(),
      });
    }

    const deployProviderMatch = argument.match(DEPLOY_PROVIDER_ARGUMENT_PATTERN);
    if (deployProviderMatch) {
      return this.buildParsedCommand({
        action: "config_deploy_provider",
        deployProvider: deployProviderMatch[1].toLowerCase(),
      });
    }

    const deployEnvironmentMatch = argument.match(DEPLOY_ENVIRONMENT_ARGUMENT_PATTERN);
    if (deployEnvironmentMatch) {
      return this.buildParsedCommand({
        action: "config_deploy_environment",
        deployEnvironment: deployEnvironmentMatch[1].toLowerCase(),
      });
    }

    const emailProviderMatch = argument.match(EMAIL_PROVIDER_ARGUMENT_PATTERN);
    if (emailProviderMatch) {
      return this.buildParsedCommand({
        action: "config_email_provider",
        emailProvider: emailProviderMatch[1].toLowerCase(),
      });
    }

    const aiProviderMatch = argument.match(AI_PROVIDER_ARGUMENT_PATTERN);
    if (aiProviderMatch) {
      return this.buildParsedCommand({
        action: "config_ai_provider",
        aiProvider: aiProviderMatch[1].toLowerCase(),
      });
    }

    const errorTrackingProviderMatch = argument.match(ERROR_TRACKING_PROVIDER_ARGUMENT_PATTERN);
    if (errorTrackingProviderMatch) {
      return this.buildParsedCommand({
        action: "config_error_tracking_provider",
        errorTrackingProvider: errorTrackingProviderMatch[1].toLowerCase(),
      });
    }

    return this.buildRespondParsedCommand(buildConfigUsageMessage());
  }

  async checkCallerAccess({ runtime }) {
    const configAccess = await runtime.resolveDeployAccessFn(runtime);
    if (!configAccess.canDeploy) {
      return this.denyAccess(
        [
          "Config update denied.",
          "Only workspace admins or whitelisted users can update config.",
          "Ask a workspace admin to run `/conductor whitelist <@USER>`.",
        ].join("\n"),
      );
    }

    return this.allowAccess();
  }

  async execute({ parsedCommand, runtime }) {
    if (!runtime.pool) {
      return this.buildExecutionResult("Config command unavailable: database pool is not configured.");
    }

    if (parsedCommand.action === "respond") {
      return this.buildExecutionResult(parsedCommand.responseText || buildConfigUsageMessage());
    }

    if (parsedCommand.action === "config_time_format") {
      await runtime.setConfiguredTimeFormatFn(
        runtime.pool,
        parsedCommand.timeFormat,
        runtime.userId,
      );

      return this.buildExecutionResult(
        `Updated your time format to \`${parsedCommand.timeFormat}\`.`,
      );
    }

    if (parsedCommand.action === "config_review_recap_channel") {
      return updateChannelScopedConfig.call(this, {
        actionLabel: "review recap",
        runtime,
        retryCommand: "/conductor config review-recap-channel:<#CHANNEL|CHANNEL_ID>",
        setChannelFn: runtime.setReviewRecapChannelFn,
        successText: "Updated review recap channel",
        targetChannelReference: parsedCommand.targetChannelReference,
      });
    }

    if (parsedCommand.action === "config_review_recap_recency") {
      await runtime.setReviewRecapRecencyFn(
        runtime.pool,
        parsedCommand.recencyValue,
        parsedCommand.recencyUnit,
        runtime.userId,
      );

      return this.buildExecutionResult(
        `Updated review recap recency to \`${parsedCommand.recencyValue}${parsedCommand.recencyUnit}\` (legacy mode).`,
      );
    }

    if (parsedCommand.action === "config_review_recap_window") {
      await runtime.setReviewRecapScopeFn(
        runtime.pool,
        parsedCommand.reviewScope,
        runtime.userId,
      );

      return this.buildExecutionResult(
        `Updated review recap window to \`${formatReviewRecapWindowLabel(parsedCommand.reviewScope)}\`.`,
      );
    }

    if (parsedCommand.action === "config_review_recap_schedule") {
      await runtime.setReviewRecapScheduleFn(
        runtime.pool,
        parsedCommand.scheduleWeekday,
        parsedCommand.scheduleTime,
        runtime.userId,
      );

      return this.buildExecutionResult(
        `Updated review recap schedule to \`${parsedCommand.scheduleWeekday}@${parsedCommand.scheduleTime}\`.`,
      );
    }

    if (parsedCommand.action === "config_review_recap_send_weekends") {
      await runtime.setReviewRecapSendWeekendsFn(
        runtime.pool,
        parsedCommand.sendOnWeekends,
        runtime.userId,
      );

      const weekendStatus = parsedCommand.sendOnWeekends ? "on" : "off";
      return this.buildExecutionResult(
        `Updated review recap weekend sending to \`${weekendStatus}\`.`,
      );
    }

    if (parsedCommand.action === "config_review_recap_send_holidays") {
      await runtime.setReviewRecapSendHolidaysFn(
        runtime.pool,
        parsedCommand.sendOnHolidays,
        runtime.userId,
      );

      const holidayStatus = parsedCommand.sendOnHolidays ? "on" : "off";
      return this.buildExecutionResult(
        `Updated review recap holiday sending to \`${holidayStatus}\` (US federal holidays).`,
      );
    }

    if (parsedCommand.action === "config_environment_status") {
      await runtime.setEnvironmentStatusEnabledFn(
        runtime.pool,
        parsedCommand.enabled,
        runtime.userId,
      );

      return this.buildExecutionResult(
        `Updated environment status monitoring to \`${parsedCommand.enabled ? "on" : "off"}\`.`,
      );
    }

    if (parsedCommand.action === "config_environment_status_url") {
      const normalizedTargetUrl = normalizeHttpUrl(parsedCommand.targetUrl);
      if (!normalizedTargetUrl) {
        return this.buildExecutionResult(
          [
            `Environment status URL \`${parsedCommand.targetUrl}\` is invalid.`,
            "Use an HTTP or HTTPS URL such as `https://example.com/healthz`.",
          ].join("\n"),
          { responseType: "ephemeral" },
        );
      }

      await runtime.setEnvironmentStatusUrlFn(
        runtime.pool,
        normalizedTargetUrl,
        runtime.userId,
      );

      return this.buildExecutionResult(
        `Updated environment status URL to \`${normalizedTargetUrl}\`.`,
      );
    }

    if (parsedCommand.action === "config_environment_status_channel") {
      return updateChannelScopedConfig.call(this, {
        actionLabel: "environment status",
        runtime,
        retryCommand: "/conductor config environment-status-channel:<#CHANNEL|CHANNEL_ID>",
        setChannelFn: runtime.setEnvironmentStatusChannelFn,
        successText: "Updated environment status channel",
        targetChannelReference: parsedCommand.targetChannelReference,
      });
    }

    if (parsedCommand.action === "config_error_tracking") {
      await runtime.setErrorTrackingEnabledFn(
        runtime.pool,
        parsedCommand.enabled,
        runtime.userId,
      );

      return this.buildExecutionResult(
        `Updated error tracking monitoring to \`${parsedCommand.enabled ? "on" : "off"}\`.`,
      );
    }

    if (parsedCommand.action === "config_error_tracking_channel") {
      return updateChannelScopedConfig.call(this, {
        actionLabel: "error tracking",
        runtime,
        retryCommand: "/conductor config error-tracking-channel:<#CHANNEL|CHANNEL_ID>",
        setChannelFn: runtime.setErrorTrackingChannelFn,
        successText: "Updated error tracking channel",
        targetChannelReference: parsedCommand.targetChannelReference,
      });
    }

    if (parsedCommand.action === "config_error_tracking_project") {
      const normalizedProjectSlug = normalizeProjectSlug(parsedCommand.projectSlug);
      if (!normalizedProjectSlug) {
        return this.buildExecutionResult(
          [
            `Error tracking project slug \`${parsedCommand.projectSlug}\` is invalid.`,
            "Use a Sentry project slug such as `api` or `web-app`.",
          ].join("\n"),
          { responseType: "ephemeral" },
        );
      }

      await runtime.setErrorTrackingProjectFn(
        runtime.pool,
        normalizedProjectSlug,
        runtime.userId,
      );

      return this.buildExecutionResult(
        `Updated error tracking project to \`${normalizedProjectSlug}\`.`,
      );
    }

    if (parsedCommand.action === "config_error_tracking_environment") {
      const normalizedEnvironment = normalizeErrorTrackingEnvironmentValue(parsedCommand.environment);
      if (normalizedEnvironment === undefined) {
        return this.buildExecutionResult(
          [
            `Error tracking environment \`${parsedCommand.environment}\` is invalid.`,
            "Use a non-empty environment name such as `production`, or `any`.",
          ].join("\n"),
          { responseType: "ephemeral" },
        );
      }

      await runtime.setErrorTrackingEnvironmentFn(
        runtime.pool,
        normalizedEnvironment,
        runtime.userId,
      );

      return this.buildExecutionResult(
        `Updated error tracking environment to \`${normalizedEnvironment || "any"}\`.`,
      );
    }

    if (parsedCommand.action === "config_email_monitor") {
      await runtime.setSupportEmailMonitorEnabledFn(
        runtime.pool,
        parsedCommand.enabled,
        runtime.userId,
      );

      return this.buildExecutionResult(
        `Updated support email monitoring to \`${parsedCommand.enabled ? "on" : "off"}\`.`,
      );
    }

    if (parsedCommand.action === "config_email_channel") {
      return updateChannelScopedConfig.call(this, {
        actionLabel: "support email",
        runtime,
        retryCommand: "/conductor config email-channel:<#CHANNEL|CHANNEL_ID>",
        setChannelFn: runtime.setSupportEmailChannelFn,
        successText: "Updated support email channel",
        targetChannelReference: parsedCommand.targetChannelReference,
      });
    }

    if (parsedCommand.action === "config_github_slack_user_map") {
      await runtime.setGithubSlackUserMappingFn(
        runtime.pool,
        parsedCommand.githubUsername,
        parsedCommand.slackUsername,
        runtime.userId,
      );

      return this.buildExecutionResult(
        `Mapped GitHub user \`${parsedCommand.githubUsername}\` to Slack user \`${formatSlackMappingDisplay(parsedCommand.slackUsername)}\`.`,
      );
    }

    if (parsedCommand.action === "config_email_on_call") {
      const userResolution = await resolveCommunicationUserId(runtime, parsedCommand);
      if (!userResolution.isResolvable) {
        return this.buildExecutionResult(
          buildUserResolutionError({
            resolution: userResolution,
            targetUserHandle: userResolution.targetUserHandle || parsedCommand.targetUserHandle,
            usageCommand: "/conductor config email-on-call <@USER> 1d",
          }),
          { responseType: "ephemeral" },
        );
      }

      const expiresAt = new Date(Date.now() + parsedCommand.onCallDurationMs).toISOString();
      await runtime.setSupportEmailOnCallFn(
        runtime.pool,
        userResolution.targetUserId,
        expiresAt,
        runtime.userId,
      );

      return this.buildExecutionResult(
        `Updated support email on-call to <@${userResolution.targetUserId}> for \`${parsedCommand.onCallDurationToken}\`.`,
      );
    }

    if (parsedCommand.action === "config_email_on_call_off") {
      await runtime.clearSupportEmailOnCallFn(runtime.pool, runtime.userId);
      return this.buildExecutionResult("Cleared support email on-call assignment.");
    }

    if (parsedCommand.action === "config_communication_provider") {
      const unavailableMessage = buildProviderUnavailableMessage(parsedCommand.communicationProvider);
      if (unavailableMessage) {
        return this.buildExecutionResult(unavailableMessage);
      }
      await runtime.setConfiguredCommunicationProviderFn(
        runtime.pool,
        parsedCommand.communicationProvider,
        runtime.userId,
      );
      return this.buildExecutionResult(
        buildProviderUpdateMessage({
          baseText: `Updated communication provider to \`${parsedCommand.communicationProvider}\`.`,
          provider: parsedCommand.communicationProvider,
        }),
      );
    }

    if (parsedCommand.action === "config_code_host_provider") {
      const unavailableMessage = buildProviderUnavailableMessage(parsedCommand.codeHostProvider);
      if (unavailableMessage) {
        return this.buildExecutionResult(unavailableMessage);
      }
      await runtime.setConfiguredCodeHostProviderFn(
        runtime.pool,
        parsedCommand.codeHostProvider,
        runtime.userId,
      );
      return this.buildExecutionResult(
        buildProviderUpdateMessage({
          baseText: `Updated code-host provider to \`${parsedCommand.codeHostProvider}\`.`,
          provider: parsedCommand.codeHostProvider,
        }),
      );
    }

    if (parsedCommand.action === "config_deploy_provider") {
      const unavailableMessage = buildProviderUnavailableMessage(parsedCommand.deployProvider);
      if (unavailableMessage) {
        return this.buildExecutionResult(unavailableMessage);
      }
      await runtime.setConfiguredDeployProviderFn(
        runtime.pool,
        parsedCommand.deployProvider,
        runtime.userId,
      );
      return this.buildExecutionResult(
        buildProviderUpdateMessage({
          baseText: `Updated deploy provider to \`${parsedCommand.deployProvider}\`.`,
          provider: parsedCommand.deployProvider,
        }),
      );
    }

    if (parsedCommand.action === "config_deploy_environment") {
      await runtime.setConfiguredDeployEnvironmentFn(
        runtime.pool,
        parsedCommand.deployEnvironment,
        runtime.userId,
      );
      return this.buildExecutionResult(
        `Updated default deploy environment to \`${parsedCommand.deployEnvironment}\`.`,
      );
    }

    if (parsedCommand.action === "config_email_provider") {
      const unavailableMessage = buildProviderUnavailableMessage(parsedCommand.emailProvider);
      if (unavailableMessage) {
        return this.buildExecutionResult(unavailableMessage);
      }
      await runtime.setConfiguredEmailProviderFn(
        runtime.pool,
        parsedCommand.emailProvider,
        runtime.userId,
      );
      return this.buildExecutionResult(
        buildProviderUpdateMessage({
          baseText: `Updated email provider to \`${parsedCommand.emailProvider}\`.`,
          provider: parsedCommand.emailProvider,
        }),
      );
    }

    if (parsedCommand.action === "config_ai_provider") {
      const unavailableMessage = buildProviderUnavailableMessage(parsedCommand.aiProvider);
      if (unavailableMessage) {
        return this.buildExecutionResult(unavailableMessage);
      }
      await runtime.setConfiguredAiProviderFn(
        runtime.pool,
        parsedCommand.aiProvider,
        runtime.userId,
      );
      return this.buildExecutionResult(
        buildProviderUpdateMessage({
          baseText: `Updated ai provider to \`${parsedCommand.aiProvider}\`.`,
          provider: parsedCommand.aiProvider,
        }),
      );
    }

    if (parsedCommand.action === "config_error_tracking_provider") {
      const unavailableMessage = buildProviderUnavailableMessage(parsedCommand.errorTrackingProvider);
      if (unavailableMessage) {
        return this.buildExecutionResult(unavailableMessage);
      }
      await runtime.setConfiguredErrorTrackingProviderFn(
        runtime.pool,
        parsedCommand.errorTrackingProvider,
        runtime.userId,
      );
      return this.buildExecutionResult(
        buildProviderUpdateMessage({
          baseText: `Updated error-tracking provider to \`${parsedCommand.errorTrackingProvider}\`.`,
          provider: parsedCommand.errorTrackingProvider,
        }),
      );
    }

    if (parsedCommand.action !== "config_timezone") {
      return this.buildExecutionResult(buildConfigUsageMessage());
    }

    if (!runtime.isValidTimeZoneFn(parsedCommand.timeZone)) {
      return this.buildExecutionResult(
        [
          `Timezone \`${parsedCommand.timeZone}\` is invalid.`,
          "Use an IANA timezone such as `America/New_York`.",
        ].join("\n"),
      );
    }

    await runtime.setConfiguredTimeZoneFn(runtime.pool, parsedCommand.timeZone, runtime.userId);
    await runtime.setReviewRecapTimeZoneFn(runtime.pool, parsedCommand.timeZone, runtime.userId);

    return this.buildExecutionResult(
      [
        `Timezone \`${parsedCommand.timeZone}\` is valid.`,
        "Updated timezone for human timestamps and review recap schedule.",
      ].join(" "),
    );
  }

  resolveResponseType({ parsedCommand }) {
    if (isWorkspaceScopedConfigAction(parsedCommand.action)) {
      return "in_channel";
    }

    return "ephemeral";
  }
}

function buildConfigPresentation(responseText) {
  const text = String(responseText || "").trim();
  const isFailure = /\b(denied|invalid|failed|unavailable|could not|not configured)\b/i.test(text);
  const isSuccess = /\b(updated|configured|set|enabled|disabled|cleared)\b/i.test(text);
  return {
    tone: isFailure ? "warning" : isSuccess ? "success" : "neutral",
    title: isFailure
      ? "Configuration needs attention"
      : isSuccess
        ? "Configuration updated"
        : "Code Conductor configuration",
    summary: text.split("\n")[0],
    sections: text.includes("\n")
      ? [{ title: "Details", text: text.split("\n").slice(1).join("\n") }]
      : [],
    actions: [
      { id: "config_help", label: "Configuration help", command: "help config" },
      { id: "run_doctor", label: "Run diagnostics", command: "doctor" },
    ],
  };
}

function isWorkspaceScopedConfigAction(action) {
  return (
    action === "config_review_recap_channel" ||
    action === "config_review_recap_recency" ||
    action === "config_review_recap_window" ||
    action === "config_review_recap_schedule" ||
    action === "config_review_recap_send_weekends" ||
    action === "config_review_recap_send_holidays" ||
    action === "config_environment_status" ||
    action === "config_environment_status_url" ||
    action === "config_environment_status_channel" ||
    action === "config_error_tracking" ||
    action === "config_error_tracking_channel" ||
    action === "config_error_tracking_project" ||
    action === "config_error_tracking_environment" ||
    action === "config_email_monitor" ||
    action === "config_email_channel" ||
    action === "config_email_on_call" ||
    action === "config_email_on_call_off" ||
    action === "config_github_slack_user_map" ||
    action === "config_communication_provider" ||
    action === "config_code_host_provider" ||
    action === "config_deploy_provider" ||
    action === "config_deploy_environment" ||
    action === "config_email_provider" ||
    action === "config_ai_provider" ||
    action === "config_error_tracking_provider"
  );
}

function buildConfigUsageMessage() {
  return [
    "Usage:",
    "`/conductor config time-format:human`",
    "`/conductor config time-format:long`",
    "`/conductor config timezone:America/New_York`",
    "",
    "PR review recap setup:",
    "`/conductor config review-recap-channel:<#CHANNEL|CHANNEL_ID|channel-name>`",
    "`/conductor config review-recap-window:<all|last-day|last-week|last-month>`",
    "`/conductor config review-recap-recency:<Nd|Nw>` (legacy)",
    "`/conductor config review-recap-schedule:<daily|weekday>@HH:MM[,HH:MM...]`",
    "`/conductor config review-recap-send-weekends:<on|off>`",
    "`/conductor config review-recap-send-holidays:<on|off>`",
    "",
    "Environment status setup:",
    "`/conductor config environment-status:on|off`",
    "`/conductor config environment-status-url:https://example.com/healthz`",
    "`/conductor config environment-status-channel:<#CHANNEL|CHANNEL_ID|channel-name>`",
    "",
    "Error tracking setup:",
    "`/conductor config error-tracking:on|off`",
    "`/conductor config error-tracking-channel:<#CHANNEL|CHANNEL_ID|channel-name>`",
    "`/conductor config error-tracking-project:<PROJECT_SLUG>`",
    "`/conductor config error-tracking-environment:<ENVIRONMENT|any>`",
    "",
    "Support email setup:",
    "`/conductor config email-monitor:on|off`",
    "`/conductor config email-channel:<#CHANNEL|CHANNEL_ID|channel-name>`",
    "`/conductor config email-on-call <@USER|USER_ID> <Nh|Nd|Nw>`",
    "`/conductor config email-on-call off`",
    "`/conductor config github-slack-user-map:<GITHUB_USER>=<@USER|USER_ID|@HANDLE>`",
    "",
    "Platform provider setup:",
    "`/conductor config communication-provider:slack|microsoft_teams`",
    "`/conductor config code-host-provider:github|bitbucket`",
    "`/conductor config deploy-provider:digitalocean|aws`",
    "`/conductor config deploy-environment:prod|staging`",
    "`/conductor config email-provider:gmail|outlook`",
    "`/conductor config ai-provider:openai|anthropic`",
    "`/conductor config error-tracking-provider:sentry|rollbar`",
    "Defaults: `all`, `mon@09:00`, `send-weekends:off`, `send-holidays:off`, timezone from `/conductor config timezone`.",
  ].join("\n");
}

function normalizeGithubUsernameToken(rawGithubUsername) {
  const match = String(rawGithubUsername || "").trim().match(GITHUB_USERNAME_PATTERN);
  if (!match) {
    return null;
  }

  return match[1].toLowerCase();
}

function normalizeSlackUsernameToken(rawSlackUsername) {
  const normalizedSlackReference = String(rawSlackUsername || "").trim();

  const mentionMatch = normalizedSlackReference.match(SLACK_USER_MENTION_PATTERN);
  if (mentionMatch) {
    return mentionMatch[1].toUpperCase();
  }

  const userIdMatch = normalizedSlackReference.match(SLACK_USER_ID_PATTERN);
  if (userIdMatch) {
    return userIdMatch[1].toUpperCase();
  }

  const usernameMatch = normalizedSlackReference.match(SLACK_USERNAME_PATTERN);
  if (!usernameMatch) {
    return null;
  }

  return usernameMatch[1].toLowerCase();
}

function formatSlackMappingDisplay(slackMappingValue) {
  const normalizedSlackMappingValue = String(slackMappingValue || "").trim();
  if (SLACK_USER_ID_PATTERN.test(normalizedSlackMappingValue)) {
    return `<@${normalizedSlackMappingValue.toUpperCase()}>`;
  }

  return `@${normalizedSlackMappingValue}`;
}

function parseEmailOnCallCommand(commandDefinition, commandWords) {
  if (commandWords.length === 3 && String(commandWords[2] || "").toLowerCase() === "off") {
    return commandDefinition.buildParsedCommand({
      action: "config_email_on_call_off",
    });
  }

  if (commandWords.length !== 4) {
    return commandDefinition.buildRespondParsedCommand(buildConfigUsageMessage());
  }

  const targetUserReference = readCommunicationUserReferenceFromArgument(commandWords[2]);
  const parsedDuration = parseDurationToken(commandWords[3]);
  if (!targetUserReference || !parsedDuration) {
    return commandDefinition.buildRespondParsedCommand(buildConfigUsageMessage());
  }

  return commandDefinition.buildParsedCommand({
    action: "config_email_on_call",
    ...targetUserReference,
    onCallDurationMs: parsedDuration.durationMs,
    onCallDurationToken: parsedDuration.normalizedToken,
  });
}

function normalizeReviewRecapScheduleTimes(rawScheduleTimes) {
  const scheduleTimeParts = String(rawScheduleTimes || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (scheduleTimeParts.length === 0) {
    return null;
  }

  const uniqueScheduleTimes = [...new Set(scheduleTimeParts)];
  for (const scheduleTime of uniqueScheduleTimes) {
    if (!REVIEW_RECAP_SCHEDULE_TIME_PATTERN.test(scheduleTime)) {
      return null;
    }
  }

  return uniqueScheduleTimes.sort().join(",");
}

function normalizeReviewRecapWindow(rawWindow) {
  const normalizedWindow = String(rawWindow || "").toLowerCase().trim();
  if (normalizedWindow === "all") {
    return "all";
  }
  if (normalizedWindow === "day" || normalizedWindow === "last-day") {
    return "day";
  }
  if (normalizedWindow === "week" || normalizedWindow === "last-week") {
    return "week";
  }
  if (normalizedWindow === "month" || normalizedWindow === "last-month") {
    return "month";
  }

  return null;
}

function formatReviewRecapWindowLabel(reviewScope) {
  const normalizedScope = String(reviewScope || "").toLowerCase().trim();
  if (normalizedScope === "day") {
    return "last day";
  }
  if (normalizedScope === "week") {
    return "last week";
  }
  if (normalizedScope === "month") {
    return "last month";
  }

  return "all";
}

async function updateChannelScopedConfig({
  actionLabel,
  runtime,
  retryCommand,
  setChannelFn,
  successText,
  targetChannelReference,
}) {
  const channelResolution = await resolveCommunicationChannelId(runtime, targetChannelReference);
  if (!channelResolution.isResolvable) {
    return this.buildExecutionResult(
      buildChannelResolutionError({
        actionLabel,
        botName: runtime.botName,
        reason: channelResolution.reason,
        targetChannelReference,
      }),
      { responseType: "ephemeral" },
    );
  }

  const channelAccess = await verifyCommunicationChannelAccess(runtime, channelResolution.targetChannelId);
  if (!channelAccess.isAccessible) {
    return this.buildExecutionResult(
      buildChannelAccessError({
        actionLabel,
        botName: runtime.botName,
        targetChannelId: channelResolution.targetChannelId,
        retryCommand,
        ...channelAccess,
      }),
      { responseType: "ephemeral" },
    );
  }

  await setChannelFn(runtime.pool, channelResolution.targetChannelId, runtime.userId);
  return this.buildExecutionResult(`${successText} to <#${channelResolution.targetChannelId}>.`);
}

function buildProviderArgumentPattern(prefix, providers) {
  return new RegExp(`^${prefix}:(${providers.join("|")})$`, "i");
}

function buildProviderUpdateMessage({ baseText }) {
  return baseText;
}

function buildProviderUnavailableMessage(provider) {
  const unavailableProvider = UNAVAILABLE_PROVIDERS[String(provider || "").toLowerCase()] || null;
  if (!unavailableProvider) {
    return null;
  }

  return [
    `Provider \`${provider}\` is not available yet.`,
    `Supported ${unavailableProvider.category} provider(s): \`${unavailableProvider.availableOptions.join(", ")}\`.`,
  ].join(" ");
}

function buildChannelAccessError({
  actionLabel = "review recap",
  targetChannelId,
  reason,
  platformErrorCode,
  neededScopes,
  providedScopes,
  botName,
  retryCommand = "/conductor config review-recap-channel:<#CHANNEL|CHANNEL_ID>",
}) {
  const resolvedBotName = String(botName || "Code Conductor").trim() || "Code Conductor";
  if (reason === "not_in_channel") {
    return [
      `Cannot set ${actionLabel} channel to <#${targetChannelId}> because ${resolvedBotName} is not in that channel.`,
      `Invite ${resolvedBotName} to the channel, then run \`${retryCommand}\` again.`,
    ].join(" ");
  }

  if (reason === "channel_not_found") {
    return [
      `Cannot set ${actionLabel} channel to <#${targetChannelId}> because that channel is not accessible.`,
      `Make sure the channel exists and ${resolvedBotName} has access.`,
    ].join(" ");
  }

  if (platformErrorCode === "missing_scope") {
    const neededText = neededScopes ? ` Needed scopes: \`${neededScopes}\`.` : "";
    const providedText = providedScopes ? ` Current scopes: \`${providedScopes}\`.` : "";
    return [
      `Cannot set ${actionLabel} channel to <#${targetChannelId}> because Slack denied channel verification (\`missing_scope\`).`,
      `${resolvedBotName} needs channel read scopes to verify membership.${neededText}${providedText}`,
      "Reinstall/update the app scopes, then retry.",
    ].join(" ");
  }

  if (platformErrorCode === "not_allowed_token_type") {
    return [
      `Cannot set ${actionLabel} channel to <#${targetChannelId}> because Slack rejected the token type (\`not_allowed_token_type\`).`,
      `Verify ${resolvedBotName} is using a bot token for Slack Web API calls, then retry.`,
    ].join(" ");
  }

  if (platformErrorCode === "invalid_auth" || platformErrorCode === "account_inactive") {
    return [
      `Cannot set ${actionLabel} channel to <#${targetChannelId}> because Slack authentication failed (\`${platformErrorCode}\`).`,
      `Rotate/update ${resolvedBotName} communication credentials and retry.`,
    ].join(" ");
  }

  return [
    `Cannot set ${actionLabel} channel to <#${targetChannelId}> right now.`,
    `Slack could not verify access for ${resolvedBotName} (error: \`${platformErrorCode || "unknown_error"}\`).`,
    "Check channel ID, bot membership, and Slack app scopes, then try again.",
  ].join(" ");
}

function buildChannelResolutionError({
  actionLabel = "review recap",
  targetChannelReference,
  reason = "invalid_reference",
  botName,
}) {
  const resolvedBotName = String(botName || "Code Conductor").trim() || "Code Conductor";
  if (reason === "channel_not_found") {
    return [
      `Cannot set ${actionLabel} channel because \`${targetChannelReference}\` was not found.`,
      `Use a valid channel name, channel mention, or channel ID.`,
    ].join(" ");
  }

  if (reason === "channel_name_resolution_unavailable") {
    return [
      `Cannot resolve channel name \`${targetChannelReference}\` with current ${resolvedBotName} permissions.`,
      "Use a channel mention like `<#C123ABC|channel-name>` or a channel ID.",
    ].join(" ");
  }

  if (reason === "channel_name_resolution_failed") {
    return [
      `Cannot resolve channel name \`${targetChannelReference}\` right now.`,
      "Try again, or use a channel mention/channel ID instead.",
    ].join(" ");
  }

  return [
    `Invalid ${actionLabel} channel value \`${targetChannelReference}\`.`,
    "Use a channel mention like `<#C123ABC|channel-name>`, a channel ID, or a channel name such as `#deploys`.",
  ].join(" ");
}

function buildUserResolutionError({ resolution, targetUserHandle, usageCommand }) {
  const normalizedUserHandle = String(targetUserHandle || "").trim().toLowerCase();
  if (!normalizedUserHandle) {
    return `Usage: \`${usageCommand}\``;
  }

  if (resolution.reason === "user_lookup_unavailable") {
    return [
      `Cannot resolve \`@${normalizedUserHandle}\` with current Slack permissions.`,
      `Use \`${usageCommand}\` or a direct Slack user ID.`,
    ].join(" ");
  }

  if (resolution.platformErrorCode === "missing_scope") {
    const neededText = resolution.neededScopes ? ` Needed scopes: \`${resolution.neededScopes}\`.` : "";
    const providedText = resolution.providedScopes ? ` Current scopes: \`${resolution.providedScopes}\`.` : "";
    return [
      `Cannot resolve \`@${normalizedUserHandle}\` because Slack denied user lookup (\`missing_scope\`).`,
      `Grant the bot token user-read scope and reinstall the app.${neededText}${providedText}`,
      `Or use \`${usageCommand.replace("<@USER>", "U123ABC")}\`.`,
    ].join(" ");
  }

  if (resolution.reason === "user_not_found") {
    return [
      `Could not resolve \`@${normalizedUserHandle}\` to a Slack user.`,
      `Use \`${usageCommand}\` or a direct Slack user ID.`,
    ].join(" ");
  }

  return [
    `Cannot resolve \`@${normalizedUserHandle}\` right now (Slack error: \`${resolution.platformErrorCode || "unknown_error"}\`).`,
    `Use \`${usageCommand}\` or a direct Slack user ID.`,
  ].join(" ");
}

function normalizeHttpUrl(rawValue) {
  const normalizedValue = String(rawValue || "").trim();
  if (normalizedValue === "") {
    return null;
  }

  try {
    const parsedUrl = new URL(normalizedValue);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return null;
    }
    return parsedUrl.toString();
  } catch (_error) {
    return null;
  }
}

function normalizeProjectSlug(rawValue) {
  const normalizedValue = String(rawValue || "").trim();
  if (normalizedValue === "") {
    return null;
  }

  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(normalizedValue) ? normalizedValue : null;
}

function normalizeErrorTrackingEnvironmentValue(rawValue) {
  const normalizedValue = String(rawValue || "").trim();
  if (normalizedValue === "") {
    return undefined;
  }
  if (normalizedValue.toLowerCase() === "any") {
    return null;
  }

  return normalizedValue;
}

module.exports = {
  ConfigCommand,
};
