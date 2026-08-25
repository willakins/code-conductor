const FAILED_DEPLOYMENT_PHASES = new Set(["ERROR", "FAILED"]);
const INTERRUPTED_DEPLOYMENT_PHASES = new Set(["CANCELED", "CANCELLED", "SUPERSEDED"]);

function createDigitalOceanClient({ token }) {
  ensureRequiredValueExists(token, "DEPLOY_TOKEN");

  return {
    async triggerAppDeployment(appId) {
      ensureRequiredValueExists(appId, "DEPLOY_PROD_APP_ID");

      const deploymentRequest = buildDeploymentRequest({ token, appId });
      const deploymentResponse = await fetch(
        deploymentRequest.url,
        deploymentRequest.requestInit,
      );

      await throwIfDeploymentRequestFailed(deploymentResponse);

      const payload = await deploymentResponse.json();
      return {
        externalDeployId: readExternalDeploymentId(payload),
      };
    },

    async waitForAppDeploymentCompletion(appId, deploymentId, options = {}) {
      ensureRequiredValueExists(appId, "DEPLOY_PROD_APP_ID");
      ensureRequiredValueExists(deploymentId, "external deployment id");

      const pollIntervalMs = readPositiveInteger(options.pollIntervalMs, 10000);
      const timeoutMs = readPositiveInteger(options.timeoutMs, 20 * 60 * 1000);
      const deadlineTimestamp = Date.now() + timeoutMs;
      let lastKnownPhase = "unknown";

      while (Date.now() <= deadlineTimestamp) {
        const deploymentState = await fetchDeploymentState({ token, appId, deploymentId });
        lastKnownPhase = deploymentState.phase;

        if (deploymentState.phase === "ACTIVE") {
          return deploymentState;
        }

        if (isFailedDeploymentPhase(deploymentState.phase)) {
          throw buildDeploymentCompletionError(deploymentId, deploymentState.phase);
        }

        await sleep(pollIntervalMs);
      }

      throw new Error(
        `DigitalOcean deployment ${deploymentId} did not finish before timeout. Last known phase: ${lastKnownPhase}.`,
      );
    },
  };
}

function ensureRequiredValueExists(value, name) {
  if (!value) {
    throw new Error(`${name} is required`);
  }
}

function buildDeploymentRequest({ token, appId }) {
  // DigitalOcean's app deployment API uses force_build for "Force Rebuild and Deploy".
  // There is no documented API field for "clear build cache", so we intentionally
  // rely on the platform default cache behavior.
  const deploymentBody = {
    force_build: true,
  };

  return {
    url: buildDeploymentEndpointUrl(appId),
    requestInit: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(deploymentBody),
    },
  };
}

function buildDeploymentEndpointUrl(appId) {
  return `https://api.digitalocean.com/v2/apps/${appId}/deployments`;
}

async function throwIfDeploymentRequestFailed(response) {
  if (response.ok) {
    return;
  }

  const responseBody = await response.text();
  throw new Error(`DigitalOcean deploy failed (${response.status}): ${responseBody}`);
}

function readExternalDeploymentId(payload) {
  const deployment = payload.deployment || {};
  return deployment.id ? String(deployment.id) : null;
}

async function fetchDeploymentState({ token, appId, deploymentId }) {
  const response = await fetch(
    `https://api.digitalocean.com/v2/apps/${appId}/deployments/${deploymentId}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    },
  );
  await throwIfDeploymentRequestFailed(response);

  const payload = await response.json();
  return mapDeploymentPayloadToState(payload);
}

function mapDeploymentPayloadToState(payload) {
  const deployment = payload.deployment || {};
  return {
    id: deployment.id ? String(deployment.id) : null,
    phase: readDeploymentPhase(deployment),
  };
}

function readDeploymentPhase(deployment) {
  const phaseValue = deployment.phase || deployment.status || deployment.progress?.phase || "unknown";
  return String(phaseValue).toUpperCase();
}

function isFailedDeploymentPhase(phase) {
  return FAILED_DEPLOYMENT_PHASES.has(phase) || INTERRUPTED_DEPLOYMENT_PHASES.has(phase);
}

function buildDeploymentCompletionError(deploymentId, deploymentPhase) {
  const error = new Error(
    `DigitalOcean deployment ${deploymentId} finished with phase ${deploymentPhase}.`,
  );
  if (INTERRUPTED_DEPLOYMENT_PHASES.has(deploymentPhase)) {
    error.code = "DEPLOYMENT_INTERRUPTED";
    error.deploymentPhase = deploymentPhase;
  }
  return error;
}

function readPositiveInteger(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function sleep(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

module.exports = {
  createDigitalOceanClient,
};
