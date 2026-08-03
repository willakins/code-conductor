const assert = require("node:assert/strict");
const test = require("node:test");

const { createBitbucketClient } = require("../../src/platform/code_host/providers/bitbucket/client");

test("createBitbucketClient requires token", () => {
  assert.throws(
    () => createBitbucketClient(buildClientOptions({ token: "" })),
    /CODE_HOST_TOKEN is required/,
  );
});

test("listOpenPullRequests paginates and normalizes records", async () => {
  const requestedUrls = [];
  await withMockedFetch(
    async (url) => {
      requestedUrls.push(url);
      if (requestedUrls.length === 1) {
        return {
          ok: true,
          async json() {
            return {
              values: [
                {
                  id: 5,
                  title: "Feature",
                  links: { html: { href: "https://bitbucket.org/workspace/repo/pull-requests/5" } },
                  author: { user: { nickname: "octocat" } },
                  destination: { branch: { name: "main" } },
                  draft: false,
                  created_on: "2026-02-16T14:00:00.000Z",
                  updated_on: "2026-02-16T15:00:00.000Z",
                },
              ],
              next: "https://api.bitbucket.org/2.0/repositories/workspace/repo/pullrequests?page=2",
            };
          },
        };
      }

      return {
        ok: true,
        async json() {
          return {
            values: [],
          };
        },
      };
    },
    async () => {
      const client = createBitbucketClient(buildClientOptions({ token: "bb-token" }));
      const result = await client.listOpenPullRequests({
        repositoryFullName: "workspace/repo",
        baseBranch: "main",
      });

      assert.equal(result.length, 1);
      assert.equal(result[0].number, 5);
      assert.equal(result[0].base.ref, "main");
      assert.equal(result[0].user.login, "octocat");
      assert.match(requestedUrls[0], /\/repositories\/workspace\/repo\/pullrequests\?/);
      assert.match(requestedUrls[0], /state=OPEN/);
    },
  );
});

test("listPullRequestReviews maps participants to review records", async () => {
  let requestedUrl = "";
  await withMockedFetch(
    async (url) => {
      requestedUrl = url;
      return {
        ok: true,
        async json() {
          return {
            participants: [
              {
                approved: true,
                participated_on: "2026-02-16T16:00:00.000Z",
                user: { nickname: "reviewer" },
              },
            ],
          };
        },
      };
    },
    async () => {
      const client = createBitbucketClient(buildClientOptions({ token: "bb-token" }));
      const result = await client.listPullRequestReviews({
        repositoryFullName: "workspace/repo",
        prNumber: 12,
      });

      assert.equal(result.length, 1);
      assert.equal(result[0].state, "APPROVED");
      assert.equal(result[0].user.login, "reviewer");
      assert.match(requestedUrl, /\/repositories\/workspace\/repo\/pullrequests\/12(?:\?|$)/);
    },
  );
});

test("listClosedPullRequests requests merged pull requests", async () => {
  let requestedUrl = "";
  await withMockedFetch(
    async (url) => {
      requestedUrl = url;
      return {
        ok: true,
        async json() {
          return { values: [] };
        },
      };
    },
    async () => {
      const client = createBitbucketClient(buildClientOptions({ token: "bb-token" }));
      const result = await client.listClosedPullRequests({
        repositoryFullName: "workspace/repo",
        baseBranch: "main",
      });

      assert.equal(result.length, 0);
      assert.match(requestedUrl, /state=MERGED/);
    },
  );
});

test("bitbucket client throws details when API request fails", async () => {
  await withMockedFetch(
    async () => ({
      ok: false,
      status: 403,
      async text() {
        return "forbidden";
      },
    }),
    async () => {
      const client = createBitbucketClient(buildClientOptions({ token: "bb-token" }));
      await assert.rejects(
        () =>
          client.listOpenPullRequests({
            repositoryFullName: "workspace/repo",
            baseBranch: "main",
          }),
        /Bitbucket API request failed \(403\)/,
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
    apiBaseUrl: "https://api.bitbucket.org/2.0",
    apiMaxPages: 100,
    apiPageSize: 50,
    apiUserAgent: "code-conductor-bot",
    token: "bb-token",
    ...overrides,
  };
}
