const { createDigitalOceanClient } = require("./digitalocean/client");
const { BaseDeployPlatform } = require("../base_deploy_platform");

class DigitalOceanDeployPlatform extends BaseDeployPlatform {
  constructor() {
    super({ provider: "digitalocean" });
  }

  async triggerProductionDeployment(deployConfig) {
    const deployToken = deployConfig.deployToken || deployConfig.digitaloceanToken;
    const deployProductionAppId = deployConfig.deployProductionAppId || deployConfig.doAppIdProd;
    const digitalOceanClient = createDigitalOceanClient({ token: deployToken });
    return digitalOceanClient.triggerAppDeployment(deployProductionAppId);
  }

  async waitForProductionDeploymentCompletion(deployConfig, externalDeployId) {
    const deployToken = deployConfig.deployToken || deployConfig.digitaloceanToken;
    const deployProductionAppId = deployConfig.deployProductionAppId || deployConfig.doAppIdProd;
    const deploymentPollIntervalMs =
      deployConfig.deploymentPollIntervalMs || deployConfig.doDeploymentPollIntervalMs;
    const digitalOceanClient = createDigitalOceanClient({ token: deployToken });
    return digitalOceanClient.waitForAppDeploymentCompletion(
      deployProductionAppId,
      externalDeployId,
      {
        pollIntervalMs: deploymentPollIntervalMs,
      },
    );
  }
}

module.exports = {
  DigitalOceanDeployPlatform,
};
