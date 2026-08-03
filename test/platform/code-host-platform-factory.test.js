const assert = require("node:assert/strict");
const test = require("node:test");

const { CODE_HOST_PROVIDERS } = require("../../src/config");
const { createCodeHostPlatform } = require("../../src/platform/code_host/factory");

function buildGithubConfig(overrides = {}) {
  return {
    codeHostApiBaseUrl: "https://api.github.com",
    codeHostApiMaxPages: 100,
    codeHostApiPageSize: 100,
    codeHostApiUserAgent: "code-conductor-bot",
    codeHostApiVersion: "2022-11-28",
    codeHostMainBranch: "main",
    codeHostRepository: "croft-eng/croft",
    codeHostToken: "ghp-token",
    codeHostWebhookSecret: "secret",
    ...overrides,
  };
}

test("createCodeHostPlatform builds github provider and registers configured webhook path", () => {
  const platform = createCodeHostPlatform({
    provider: CODE_HOST_PROVIDERS.github,
    config: buildGithubConfig(),
  });

  const paths = [];
  const httpApp = {
    post(path) {
      paths.push(path);
    },
  };

  platform.registerWebhookRoutes(httpApp, { pool: {} });

  assert.deepEqual(paths, ["/codehost/webhook"]);
  assert.equal(typeof platform.createSyncClient, "function");
});

test("github code-host provider returns null sync client when github token is missing", () => {
  const platform = createCodeHostPlatform({
    provider: CODE_HOST_PROVIDERS.github,
    config: buildGithubConfig({ codeHostToken: "" }),
  });

  assert.equal(platform.createSyncClient(), null);
});

test("createCodeHostPlatform builds bitbucket provider and registers webhook paths", () => {
  const platform = createCodeHostPlatform({
    provider: CODE_HOST_PROVIDERS.bitbucket,
    config: {
      codeHostApiBaseUrl: "https://api.bitbucket.org/2.0",
      codeHostApiMaxPages: 100,
      codeHostApiPageSize: 50,
      codeHostApiUserAgent: "code-conductor-bot",
      codeHostMainBranch: "main",
      codeHostRepository: "workspace/repo",
      codeHostToken: "bb-token",
      codeHostWebhookSecret: "secret",
    },
  });

  const paths = [];
  const httpApp = {
    post(path) {
      paths.push(path);
    },
  };
  platform.registerWebhookRoutes(httpApp, { pool: {} });

  assert.deepEqual(paths, ["/bitbucket/webhook", "/codehost/webhook"]);
  assert.equal(typeof platform.createSyncClient, "function");
});

test("bitbucket code-host provider returns null sync client when token is missing", () => {
  const platform = createCodeHostPlatform({
    provider: CODE_HOST_PROVIDERS.bitbucket,
    config: {
      codeHostApiBaseUrl: "https://api.bitbucket.org/2.0",
      codeHostApiMaxPages: 100,
      codeHostApiPageSize: 50,
      codeHostApiUserAgent: "code-conductor-bot",
      codeHostMainBranch: "main",
      codeHostRepository: "workspace/repo",
      codeHostToken: "",
      codeHostWebhookSecret: "secret",
    },
  });

  assert.equal(platform.createSyncClient(), null);
});

test("createCodeHostPlatform rejects unknown providers", () => {
  assert.throws(
    () => createCodeHostPlatform({ provider: "unknown", config: {} }),
    /Unsupported code-host provider: unknown/,
  );
});
