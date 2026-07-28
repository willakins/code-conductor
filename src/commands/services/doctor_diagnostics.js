function createDoctorDiagnosticsFn(appRuntime) {
  return async (commandRuntime) => {
    const checks = [];
    try {
      await appRuntime.pool.query("SELECT 1");
      checks.push({ label: "Database", status: "ok", detail: "Connected." });
    } catch (error) {
      checks.push({ label: "Database", status: "error", detail: error.message });
    }

    checks.push({
      label: "Communication provider",
      status: appRuntime.communicationPlatform ? "ok" : "error",
      detail: appRuntime.config.communicationProvider,
    });
    checks.push({
      label: "Code-host sync",
      status: appRuntime.codeHostSyncClient ? "ok" : "warning",
      detail: appRuntime.codeHostSyncClient
        ? appRuntime.config.codeHostProvider
        : "Credentials or sync client unavailable.",
    });
    checks.push({
      label: "Production deploy target",
      status: appRuntime.config.deployProductionAppId ? "ok" : "warning",
      detail: appRuntime.config.deployProductionAppId
        ? `${appRuntime.config.deployProvider} target configured.`
        : "Production target is missing.",
    });

    const topic = await commandRuntime.resolveCurrentChannelTopicFn(commandRuntime);
    checks.push({
      label: "Channel topic access",
      status: topic ? "ok" : "warning",
      detail: topic
        ? "Current channel topic is readable."
        : "Unavailable; explicit gate state remains authoritative.",
    });

    const schedulerNames = [
      "reviewRecapScheduler",
      "openPullRequestSyncScheduler",
      "codexApprovalSyncScheduler",
      "environmentStatusScheduler",
      "errorTrackingScheduler",
      "supportEmailScheduler",
    ];
    const activeSchedulerCount = schedulerNames.filter((name) => appRuntime[name]).length;
    checks.push({
      label: "Background schedulers",
      status: activeSchedulerCount > 0 ? "ok" : "warning",
      detail: `${activeSchedulerCount}/${schedulerNames.length} scheduler handles are active.`,
    });

    const [environmentConfig, errorConfig, emailConfig, recapConfig] = await Promise.all([
      commandRuntime.getEnvironmentStatusConfigFn(appRuntime.pool),
      commandRuntime.getErrorTrackingConfigFn(appRuntime.pool),
      commandRuntime.getSupportEmailConfigFn(appRuntime.pool),
      commandRuntime.getReviewRecapConfigFn(appRuntime.pool),
    ]);
    checks.push(
      buildActivityCheck({
        enabled: environmentConfig.enabled,
        label: "Environment monitor activity",
        timestamp: environmentConfig.lastCheckedAt,
        timestampLabel: "Last check",
      }),
      buildActivityCheck({
        enabled: errorConfig.enabled,
        label: "Error tracker activity",
        timestamp: errorConfig.lastSyncAt,
        timestampLabel: "Last sync",
      }),
      buildActivityCheck({
        enabled: emailConfig.enabled,
        label: "Support email activity",
        timestamp: emailConfig.lastSyncAt,
        timestampLabel: "Last sync",
      }),
      {
        label: "Review recap delivery",
        status: recapConfig.targetChannelId ? "ok" : "warning",
        detail: recapConfig.lastSentAt
          ? `Last sent: ${recapConfig.lastSentAt}.`
          : "No recap delivery has been recorded.",
      },
    );
    return checks;
  };
}

function buildActivityCheck({ enabled, label, timestamp, timestampLabel }) {
  return {
    label,
    status: enabled && !timestamp ? "warning" : "ok",
    detail: enabled ? `${timestampLabel}: ${timestamp || "never"}.` : "Monitor is disabled.",
  };
}

module.exports = {
  createDoctorDiagnosticsFn,
};
