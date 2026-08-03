const assert = require("node:assert/strict");
const test = require("node:test");

const { createGithubClient } = require("../../src/platform/code_host/providers/github/client");

test("createGithubClient requires token", () => {
  assert.throws(
    () => createGithubClient(buildClientOptions({ token: "" })),
    /CODE_HOST_TOKEN is required/,
  );
});

test("listOpenPullRequests paginates and returns records", async () => {
  const requestedUrls = [];
  await withMockedFetch(
    async (url) => {
      requestedUrls.push(url);
      if (/[?&]page=1(?:&|$)/.test(url)) {
        return {
          ok: true,
          async json() {
            return new Array(100).fill(0).map((_value, index) => ({ number: index + 1 }));
          },
        };
      }

      return {
        ok: true,
        async json() {
          return [{ number: 101 }];
        },
      };
    },
    async () => {
      const client = createGithubClient(buildClientOptions({ token: "ghp-token" }));
      const result = await client.listOpenPullRequests({
        repositoryFullName: "croft-eng/croft",
        baseBranch: "main",
      });

      assert.equal(result.length, 101);
      assert.match(requestedUrls[0], /\/repos\/croft-eng\/croft\/pulls\?/);
      assert.match(requestedUrls[0], /state=open/);
      assert.match(requestedUrls[0], /base=main/);
      assert.match(requestedUrls[0], /per_page=100/);
      assert.match(requestedUrls[0], /page=1/);
      assert.match(requestedUrls[1], /page=2/);
    },
  );
});

test("listPullRequestReviews uses expected endpoint", async () => {
  let requestedUrl = "";
  await withMockedFetch(
    async (url, requestInit) => {
      requestedUrl = url;
      assert.equal(requestInit.method, "GET");
      assert.equal(requestInit.headers.Authorization, "Bearer ghp-token");
      return {
        ok: true,
        async json() {
          return [{ state: "APPROVED" }];
        },
      };
    },
    async () => {
      const client = createGithubClient(buildClientOptions({ token: "ghp-token" }));
      const result = await client.listPullRequestReviews({
        repositoryFullName: "croft-eng/croft",
        prNumber: 77,
      });

      assert.equal(result.length, 1);
      assert.match(requestedUrl, /\/repos\/croft-eng\/croft\/pulls\/77\/reviews\?/);
      assert.match(requestedUrl, /per_page=100/);
      assert.match(requestedUrl, /page=1/);
    },
  );
});

test("listClosedPullRequests uses expected endpoint and query", async () => {
  let requestedUrl = "";
  await withMockedFetch(
    async (url) => {
      requestedUrl = url;
      return {
        ok: true,
        async json() {
          return [];
        },
      };
    },
    async () => {
      const client = createGithubClient(buildClientOptions({ token: "ghp-token" }));
      const result = await client.listClosedPullRequests({
        repositoryFullName: "croft-eng/croft",
        baseBranch: "main",
      });

      assert.equal(result.length, 0);
      assert.match(requestedUrl, /\/repos\/croft-eng\/croft\/pulls\?/);
      assert.match(requestedUrl, /state=closed/);
      assert.match(requestedUrl, /base=main/);
      assert.match(requestedUrl, /sort=updated/);
      assert.match(requestedUrl, /direction=desc/);
    },
  );
});

test("isPullRequestCodexApproved returns true for codex +1 reaction", async () => {
  let requestedUrl = "";
  await withMockedFetch(
    async (url) => {
      requestedUrl = url;
      return {
        ok: true,
        async json() {
          return [
            {
              content: "+1",
              user: { login: "chatgpt-codex-connector[bot]" },
            },
          ];
        },
      };
    },
    async () => {
      const client = createGithubClient(buildClientOptions({
        codexUserLogins: ["chatgpt-codex-connector[bot]"],
        token: "ghp-token",
      }));
      const approved = await client.isPullRequestCodexApproved({
        repositoryFullName: "croft-eng/croft",
        prNumber: 77,
      });

      assert.equal(approved, true);
      assert.match(requestedUrl, /\/repos\/croft-eng\/croft\/issues\/77\/reactions\?/);
    },
  );
});

test("isPullRequestCodexApproved returns false when codex +1 is missing", async () => {
  await withMockedFetch(
    async () => ({
      ok: true,
      async json() {
        return [
          { content: "heart", user: { login: "chatgpt-codex-connector[bot]" } },
          { content: "+1", user: { login: "octocat" } },
        ];
      },
    }),
    async () => {
      const client = createGithubClient(buildClientOptions({
        codexUserLogins: ["chatgpt-codex-connector[bot]"],
        token: "ghp-token",
      }));
      const approved = await client.isPullRequestCodexApproved({
        repositoryFullName: "croft-eng/croft",
        prNumber: 77,
      });

      assert.equal(approved, false);
    },
  );
});

test("github client throws details when API request fails", async () => {
  await withMockedFetch(
    async () => ({
      ok: false,
      status: 403,
      async text() {
        return "forbidden";
      },
    }),
    async () => {
      const client = createGithubClient(buildClientOptions({ token: "ghp-token" }));
      await assert.rejects(
        () =>
          client.listOpenPullRequests({
            repositoryFullName: "croft-eng/croft",
            baseBranch: "main",
          }),
        /GitHub API request failed \(403\)/,
      );
    },
  );
});

async function withMockedFetch(mockImplementation, fn) {
  const originalFetch = global.fetch;
  global.fetch = mockImplementation;

  try {
    await fn();
  } finally {
    global.fetch = originalFetch;
  }
}

function buildClientOptions(overrides = {}) {
  return {
    apiBaseUrl: "https://api.github.com",
    apiMaxPages: 100,
    apiPageSize: 100,
    apiUserAgent: "code-conductor-bot",
    apiVersion: "2022-11-28",
    token: "ghp-token",
    ...overrides,
  };
}
