const assert = require("node:assert/strict");
const test = require("node:test");

const { createDigitalOceanClient } = require("../../src/platform/deploy/providers/digitalocean/client");

test("createDigitalOceanClient requires token", () => {
  assert.throws(() => createDigitalOceanClient({ token: "" }), /DEPLOY_TOKEN is required/);
});

test("triggerAppDeployment requires app id", async () => {
  const client = createDigitalOceanClient({ token: "token" });
  await assert.rejects(
    () => client.triggerAppDeployment(""),
    /DEPLOY_PROD_APP_ID is required/,
  );
});

test("triggerAppDeployment sends expected request and maps deployment id", async () => {
  await withMockedFetch(
    async (url, requestInit) => {
      assert.equal(url, "https://api.digitalocean.com/v2/apps/app-123/deployments");
      assert.equal(requestInit.method, "POST");
      assert.equal(requestInit.headers.Authorization, "Bearer token-123");
      assert.equal(requestInit.headers["Content-Type"], "application/json");
      assert.deepEqual(JSON.parse(requestInit.body), { force_build: true });

      return {
        ok: true,
        async json() {
          return { deployment: { id: "dep-123" } };
        },
      };
    },
    async () => {
      const client = createDigitalOceanClient({ token: "token-123" });
      const result = await client.triggerAppDeployment("app-123");
      assert.deepEqual(result, { externalDeployId: "dep-123" });
    },
  );
});

test("triggerAppDeployment returns null id when deployment id is missing", async () => {
  await withMockedFetch(
    async () => ({
      ok: true,
      async json() {
        return { deployment: {} };
      },
    }),
    async () => {
      const client = createDigitalOceanClient({ token: "token-123" });
      const result = await client.triggerAppDeployment("app-123");
      assert.deepEqual(result, { externalDeployId: null });
    },
  );
});

test("triggerAppDeployment throws with status and response body when request fails", async () => {
  await withMockedFetch(
    async () => ({
      ok: false,
      status: 403,
      async text() {
        return "forbidden";
      },
    }),
    async () => {
      const client = createDigitalOceanClient({ token: "token-123" });
      await assert.rejects(
        () => client.triggerAppDeployment("app-123"),
        /DigitalOcean deploy failed \(403\): forbidden/,
      );
    },
  );
});

test("waitForAppDeploymentCompletion resolves when deployment reaches ACTIVE", async () => {
  await withMockedFetch(
    async (url, requestInit) => {
      assert.equal(url, "https://api.digitalocean.com/v2/apps/app-123/deployments/dep-123");
      assert.equal(requestInit.method, "GET");
      assert.equal(requestInit.headers.Authorization, "Bearer token-123");

      return {
        ok: true,
        async json() {
          return { deployment: { id: "dep-123", phase: "ACTIVE" } };
        },
      };
    },
    async () => {
      const client = createDigitalOceanClient({ token: "token-123" });
      const result = await client.waitForAppDeploymentCompletion("app-123", "dep-123", {
        pollIntervalMs: 1,
      });

      assert.deepEqual(result, { id: "dep-123", phase: "ACTIVE" });
    },
  );
});

test("waitForAppDeploymentCompletion throws on terminal failure phase", async () => {
  await withMockedFetch(
    async () => ({
      ok: true,
      async json() {
        return { deployment: { id: "dep-123", phase: "ERROR" } };
      },
    }),
    async () => {
      const client = createDigitalOceanClient({ token: "token-123" });
      await assert.rejects(
        () =>
          client.waitForAppDeploymentCompletion("app-123", "dep-123", {
            pollIntervalMs: 1,
          }),
        /finished with phase ERROR/,
      );
    },
  );
});

for (const deploymentPhase of ["CANCELED", "CANCELLED", "SUPERSEDED"]) {
  test(`waitForAppDeploymentCompletion identifies ${deploymentPhase} as interrupted`, async () => {
    await withMockedFetch(
      async () => ({
        ok: true,
        async json() {
          return { deployment: { id: "dep-123", phase: deploymentPhase } };
        },
      }),
      async () => {
        const client = createDigitalOceanClient({ token: "token-123" });

        await assert.rejects(
          () =>
            client.waitForAppDeploymentCompletion("app-123", "dep-123", {
              pollIntervalMs: 1,
            }),
          (error) => {
            assert.equal(error.code, "DEPLOYMENT_INTERRUPTED");
            assert.equal(error.deploymentPhase, deploymentPhase);
            return true;
          },
        );
      },
    );
  });
}

async function withMockedFetch(mockImplementation, fn) {
  const originalFetch = global.fetch;
  global.fetch = mockImplementation;

  try {
    await fn();
  } finally {
    global.fetch = originalFetch;
  }
}

for (const terminalPhase of ["ACTIVE", "ERROR", "CANCELED"]) {
  test(`waitForAppDeploymentCompletion waits past the former deadline for ${terminalPhase}`, async () => {
    const originalNow = Date.now;
    let now = originalNow();
    let polls = 0;
    Date.now = () => now;

    try {
      await withMockedFetch(
        async () => {
          polls += 1;
          now += 21 * 60 * 1000;
          const phase = polls === 1 ? "BUILDING" : polls === 2 ? "DEPLOYING" : terminalPhase;
          return {
            ok: true,
            async json() {
              return { deployment: { id: "dep-123", phase } };
            },
          };
        },
        async () => {
          const client = createDigitalOceanClient({ token: "token-123" });
          const completion = client.waitForAppDeploymentCompletion("app-123", "dep-123", {
            pollIntervalMs: 1,
          });
          if (terminalPhase === "ACTIVE") {
            assert.deepEqual(await completion, { id: "dep-123", phase: "ACTIVE" });
          } else {
            await assert.rejects(completion, new RegExp(`finished with phase ${terminalPhase}`));
          }
          assert.equal(polls, 3);
        },
      );
    } finally {
      Date.now = originalNow;
    }
  });
}
for (const failure of [408, 429, 500, 502, 503, 504, "network"]) {
  test(`deployment monitoring recovers from ${failure} without triggering another deployment`, async () => {
    let requests = 0;
    await withMockedFetch(async (url, init) => {
      assert.equal(init.method, "GET");
      assert.equal(url, "https://api.digitalocean.com/v2/apps/app-123/deployments/dep-123");
      requests += 1;
      if (requests <= 2) {
        if (failure === "network") throw new TypeError("fetch failed");
        return { ok: false, status: failure, text: async () => "temporary error" };
      }
      return { ok: true, json: async () => ({ deployment: { id: "dep-123", phase: "ACTIVE" } }) };
    }, async () => {
      const client = createDigitalOceanClient({ token: "token" });
      assert.deepEqual(await client.waitForAppDeploymentCompletion("app-123", "dep-123", {
        pollIntervalMs: 1,
      }), { id: "dep-123", phase: "ACTIVE" });
      assert.equal(requests, 3);
    });
  });
}

test("deployment monitoring still reports a real failure after a transient API error", async () => {
  let requests = 0;
  await withMockedFetch(async () => {
    requests += 1;
    if (requests === 1) return { ok: false, status: 500, text: async () => "temporary" };
    return { ok: true, json: async () => ({ deployment: { phase: "ERROR" } }) };
  }, async () => {
    const client = createDigitalOceanClient({ token: "token" });
    await assert.rejects(client.waitForAppDeploymentCompletion("app", "dep", { pollIntervalMs: 1 }),
      /finished with phase ERROR/);
    assert.equal(requests, 2);
  });
});

test("deployment monitoring does not retry authorization failures", async () => {
  let requests = 0;
  await withMockedFetch(async () => {
    requests += 1;
    return { ok: false, status: 403, text: async () => "forbidden" };
  }, async () => {
    const client = createDigitalOceanClient({ token: "token" });
    await assert.rejects(client.waitForAppDeploymentCompletion("app", "dep", { pollIntervalMs: 1 }),
      /403.*forbidden/);
    assert.equal(requests, 1);
  });
});

test("deployment trigger is not retried after a server error", async () => {
  let requests = 0;
  await withMockedFetch(async () => {
    requests += 1;
    return { ok: false, status: 500, text: async () => "temporary" };
  }, async () => {
    const client = createDigitalOceanClient({ token: "token" });
    await assert.rejects(client.triggerAppDeployment("app"), /500/);
    assert.equal(requests, 1);
  });
});
